import test from "node:test";
import assert from "node:assert/strict";
import { ThinkingLevel } from "@google/genai";
import {
  ALLOWED_TEXT_MODELS,
  DEFAULT_VOICE_THRESHOLDS,
  SENECA_VOICE_NAME,
  analyzeVoiceFrame,
  buildGenerateRequestSpec,
  buildSenecaAlfredInstruction,
  clampVoiceThresholds,
  computePitchRangeFromMedian,
  createEmptyVoiceProfile,
  dbToRms,
  detectVoiceCalibrationCommand,
  detectVoiceStateTransition,
  evaluateSpeakerGate,
  extractGroundingSources,
  float32ToInt16Bytes,
  formatSenecaStudyContext,
  int16BytesToFloat32,
  isAllowedImageMimeType,
  parseExtractedQuestion,
  rmsToDb,
  summarizeNoiseCalibration,
  summarizeVoiceCalibration,
  updateVoiceProfile,
} from "./aiLogic.ts";

test("buildGenerateRequestSpec selects correct model and thinkingConfig without forbidden params", () => {
  const quick = buildGenerateRequestSpec({ mode: "quick", prompt: "What is Boyle's law?" });
  assert.equal(quick.model, "gemini-3.1-flash-lite");
  assert.deepEqual(quick.config.thinkingConfig, { thinkingLevel: ThinkingLevel.MINIMAL });
  assert.equal("maxOutputTokens" in quick.config, false);
  assert.equal("temperature" in quick.config, false);

  const deep = buildGenerateRequestSpec({ mode: "deep", prompt: "Derive lens maker formula" });
  assert.equal(deep.model, "gemini-4-hydrogen");
  assert.deepEqual(deep.config.thinkingConfig, { thinkingLevel: ThinkingLevel.HIGH });
  assert.equal("maxOutputTokens" in deep.config, false);

  const search = buildGenerateRequestSpec({ mode: "search", prompt: "Latest NTA NEET 2027 updates" });
  assert.equal(search.model, "gemini-4-hydrogen");
  assert.deepEqual(search.config.tools, [{ googleSearch: {} }]);

  for (const m of Object.values(ALLOWED_TEXT_MODELS)) {
    assert.ok(!m.includes("1.5") && !m.includes("2.0"), `Deprecated model found: ${m}`);
  }
});

test("formatSenecaStudyContext formats partial and full study snapshots cleanly", () => {
  assert.equal(formatSenecaStudyContext(null), "No study snapshot provided.");
  const text = formatSenecaStudyContext({
    dateLabel: "Thursday, 26 Nov",
    overallPct: 6.2,
    donePts: 62,
    totalPts: 1000,
    todayPts: 3.5,
    targetPts: 10,
    pendingPts: 6.5,
    standingText: "Behind by 165 pts",
    dueQuestions: 74,
    dueCards: 193,
    subjects: [{ name: "Botany", pct: 9, done: 22.6, total: 250 }],
    upcomingTests: [{ name: "Major Test 1", days: 10, leftPts: 25 }],
    risks: ["Cell (NCERT) is 38 days overdue"],
  });
  assert.match(text, /Overall Syllabus: 6% \(62 \/ 1000 pts\)/);
  assert.match(text, /Today: 3\.5 \/ 10 pts done/);
  assert.match(text, /Major Test 1 in 10d/);
  assert.match(text, /Due Revision: 74 questions, 193 flashcards/);
});

test("extractGroundingSources filters invalid schemes and deduplicates URLs", () => {
  const chunks = [
    { web: { uri: "https://nta.ac.in/notice", title: "NTA Official Notice" } },
    { web: { uri: "https://nta.ac.in/notice", title: "Duplicate" } },
    { web: { uri: "javascript:alert(1)", title: "XSS attempt" } },
    { web: { uri: "http://example.com/ncert", title: "" } },
    null,
  ];
  const res = extractGroundingSources(chunks);
  assert.deepEqual(res, [
    { uri: "https://nta.ac.in/notice", title: "NTA Official Notice" },
    { uri: "http://example.com/ncert", title: "http://example.com/ncert" },
  ]);
});

test("parseExtractedQuestion handles JSON payloads and numeric options", () => {
  const parsed = parseExtractedQuestion(
    '```json\n{"question":"Unit of dipole moment?","optA":"Debye","optB":"Tesla","optC":"Weber","optD":"Henry","correct":"1","takeaway":"1 D = 3.335e-30 C·m","explanation":"Electric dipole moment p = q*d, commonly expressed in Debye."}\n```'
  );
  assert.equal(parsed.question, "Unit of dipole moment?");
  assert.equal(parsed.optA, "Debye");
  assert.equal(parsed.correct, "A");
  assert.equal(parsed.takeaway, "1 D = 3.335e-30 C·m");
});

test("isAllowedImageMimeType allows safe raster types only", () => {
  assert.equal(isAllowedImageMimeType("image/png"), true);
  assert.equal(isAllowedImageMimeType("image/jpeg"), true);
  assert.equal(isAllowedImageMimeType("image/svg+xml"), false);
  assert.equal(isAllowedImageMimeType("text/html"), false);
});

test("PCM audio conversion round-trips Float32 <-> Int16 little-endian bytes cleanly", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const bytes = float32ToInt16Bytes(samples);
  assert.equal(bytes.byteLength, 10);
  const restored = int16BytesToFloat32(bytes);
  assert.equal(restored.length, 5);
  assert.ok(Math.abs(restored[1] - 0.5) < 0.001);
  assert.ok(Math.abs(restored[2] + 0.5) < 0.001);
  assert.ok(Math.abs(restored[3] - 1) < 0.001);
  assert.ok(Math.abs(restored[4] + 1) < 0.001);
});

test("detectVoiceStateTransition handles quiet, wake, and negated phrases cleanly", () => {
  assert.equal(detectVoiceStateTransition("keep quiet for a bit", false), "quiet");
  assert.equal(detectVoiceStateTransition("Stand down for now", false), "quiet");
  assert.equal(detectVoiceStateTransition("don't go quiet on me", false), null);
  assert.equal(detectVoiceStateTransition("do not mute yourself", false), null);
  assert.equal(detectVoiceStateTransition("What is next on my plan?", false), null);
  assert.equal(detectVoiceStateTransition("keep quiet", true), null);
  assert.equal(detectVoiceStateTransition("random study muttering", true), null);
  assert.equal(detectVoiceStateTransition("Seneca, plan my day", true), "wake");
  assert.equal(detectVoiceStateTransition("you can speak now", true), "wake");
});

test("speaker voice enrollment, onset preservation, and 3-frame wrong-speaker isolation", () => {
  const mkTone = (hz: number, amp: number, len = 2048) => {
    const buf = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      buf[i] = amp * Math.sin((2 * Math.PI * hz * i) / 16000);
    }
    return buf;
  };

  const userFrame = analyzeVoiceFrame(mkTone(125, 0.12), 16000);
  assert.equal(userFrame.isVoiced, true);
  assert.ok(Math.abs(userFrame.estimatedHz - 125) < 5);

  let profile = createEmptyVoiceProfile();
  let enrolledNow = false;
  for (let i = 0; i < 10; i++) {
    const res = updateVoiceProfile(profile, userFrame);
    profile = res.profile;
    if (res.justEnrolled) enrolledNow = true;
  }
  assert.equal(enrolledNow, true);
  assert.equal(profile.enrolled, true);
  assert.ok(profile.meanHz >= 120 && profile.meanHz <= 130);

  // Matching user passes
  let gateState = { hangoverFrames: 0, mismatchStreak: 0 };
  const passRes = evaluateSpeakerGate(gateState, userFrame, profile);
  assert.equal(passRes.allow, true);
  assert.equal(passRes.reason, "matched");
  gateState = passRes.nextState;

  // Unvoiced strong consonant onset passes without dropping word starts
  const onsetRes = evaluateSpeakerGate(
    { hangoverFrames: 0, mismatchStreak: 0 },
    { rms: 0.02, estimatedHz: 0, clarity: 0.2, isVoiced: false },
    profile
  );
  assert.equal(onsetRes.allow, true);
  assert.equal(onsetRes.reason, "onset");

  // Different speaker (high pitch ~260 Hz) rejected after 3 voiced frames
  const otherSpeaker = analyzeVoiceFrame(mkTone(260, 0.12), 16000);
  const rej1 = evaluateSpeakerGate(gateState, otherSpeaker, profile);
  const rej2 = evaluateSpeakerGate(rej1.nextState, otherSpeaker, profile);
  const rej3 = evaluateSpeakerGate(rej2.nextState, otherSpeaker, profile);
  assert.equal(rej3.allow, false);
  assert.equal(rej3.reason, "wrong_speaker");

  // Faint distant voice/background chatter below near-field threshold rejected
  const distantUser = analyzeVoiceFrame(mkTone(125, 0.004), 16000);
  const distRes = evaluateSpeakerGate({ hangoverFrames: 0, mismatchStreak: 0 }, distantUser, profile);
  assert.equal(distRes.allow, false);

  assert.equal(detectVoiceCalibrationCommand("Seneca, reset my voice profile"), "reset_profile");
  assert.equal(detectVoiceCalibrationCommand("Seneca, plan my day"), null);
});

test("buildSenecaAlfredInstruction enforces Seneca-only identity, Conservative RP, and zero autonomous guessing", () => {
  assert.equal(SENECA_VOICE_NAME, "Charon");
  const inst = buildSenecaAlfredInstruction({ todayPts: 2, targetPts: 10 });
  assert.match(inst, /You are Seneca, and ONLY Seneca/);
  assert.match(inst, /claiming to be Alfred, Jarvis/i);
  assert.match(inst, /Traditional British Received Pronunciation \(Conservative RP\)/i);
  assert.match(inst, /non-rhotic pronunciation/i);
  assert.match(inst, /NEVER constantly call the user 'sir'/i);
  assert.match(inst, /ZERO AUTONOMOUS GUESSING/i);
  assert.match(inst, /DO NOT call any action tool and DO NOT guess/i);
  assert.match(inst, /Today: 2\.0 \/ 10 pts done/);
});

test("custom threshold settings filter background noise, volume floor, and out-of-band voices", () => {
  assert.ok(Math.abs(rmsToDb(dbToRms(-36)) + 36) < 0.01);

  const clamped = clampVoiceThresholds({ minVolumeDb: -80, minHz: 200, maxHz: 190, minClarity: 0.99 });
  assert.equal(clamped.minVolumeDb, -60);
  assert.ok(clamped.maxHz >= clamped.minHz + 25);
  assert.equal(clamped.minClarity, 0.85);

  const range = computePitchRangeFromMedian(130, 30);
  assert.ok(range.minHz < 130 && range.maxHz > 130);

  // Noise & voice calibration summaries
  const noiseFrames = Array.from({ length: 12 }, () => ({
    rms: dbToRms(-48),
    estimatedHz: 0,
    clarity: 0.15,
    isVoiced: false,
  }));
  const noiseSum = summarizeNoiseCalibration(noiseFrames);
  assert.equal(noiseSum.noiseFloorDb, -48);
  assert.equal(noiseSum.recommendedMinVolumeDb, -41);

  const voiceFrames = Array.from({ length: 12 }, () => ({
    rms: dbToRms(-22),
    estimatedHz: 132,
    clarity: 0.86,
    isVoiced: true,
  }));
  const voiceSum = summarizeVoiceCalibration(voiceFrames, noiseSum.noiseFloorDb);
  assert.equal(voiceSum.medianHz, 132);
  assert.equal(voiceSum.profile.enrolled, true);
  assert.ok(voiceSum.recommendedMinVolumeDb > noiseSum.noiseFloorDb);

  const customSettings = {
    ...DEFAULT_VOICE_THRESHOLDS,
    speakerLockEnabled: true,
    autoTrackRange: false,
    minVolumeDb: -32,
    minHz: 105,
    maxHz: 165,
    minClarity: 0.55,
  };

  // Frame below custom -32 dBFS floor is rejected as silence
  const softMatch = evaluateSpeakerGate(
    { hangoverFrames: 0, mismatchStreak: 0 },
    { rms: dbToRms(-38), estimatedHz: 132, clarity: 0.9, isVoiced: true },
    voiceSum.profile,
    customSettings
  );
  assert.equal(softMatch.allow, false);
  assert.equal(softMatch.reason, "silence");

  // Sustained loud unvoiced noise passes at most 2 onset frames, then blocked as noise
  const loudNoise = { rms: dbToRms(-24), estimatedHz: 0, clarity: 0.2, isVoiced: false };
  let st = { hangoverFrames: 0, mismatchStreak: 0, onsetStreak: 0 };
  const n1 = evaluateSpeakerGate(st, loudNoise, voiceSum.profile, customSettings);
  assert.equal(n1.reason, "onset");
  st = { hangoverFrames: 0, mismatchStreak: 0, onsetStreak: n1.nextState.onsetStreak ?? 0 };
  const n2 = evaluateSpeakerGate(st, loudNoise, voiceSum.profile, customSettings);
  assert.equal(n2.reason, "onset");
  st = { hangoverFrames: 0, mismatchStreak: 0, onsetStreak: n2.nextState.onsetStreak ?? 0 };
  const n3 = evaluateSpeakerGate(st, loudNoise, voiceSum.profile, customSettings);
  assert.equal(n3.allow, false);
  assert.equal(n3.reason, "noise");

  // Custom frequency range rejects 210 Hz speaker even though profile isn't auto-tracked
  const otherVoice = { rms: dbToRms(-22), estimatedHz: 210, clarity: 0.88, isVoiced: true };
  let sp = { hangoverFrames: 0, mismatchStreak: 0 };
  sp = evaluateSpeakerGate(sp, otherVoice, voiceSum.profile, customSettings).nextState;
  sp = evaluateSpeakerGate(sp, otherVoice, voiceSum.profile, customSettings).nextState;
  const sp3 = evaluateSpeakerGate(sp, otherVoice, voiceSum.profile, customSettings);
  assert.equal(sp3.allow, false);
  assert.equal(sp3.reason, "wrong_speaker");
});

