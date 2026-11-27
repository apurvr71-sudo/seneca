import { ThinkingLevel } from "@google/genai";

export type AiMode = "quick" | "standard" | "deep" | "search";

export interface SenecaStudySnapshot {
  dateLabel?: string;
  overallPct?: number;
  donePts?: number;
  totalPts?: number;
  todayPts?: number;
  targetPts?: number;
  pendingPts?: number;
  standingText?: string;
  subjects?: Array<{
    name: string;
    pct: number;
    done: number;
    total: number;
  }>;
  nextTask?: string;
  dueQuestions?: number;
  dueCards?: number;
  upcomingTests?: Array<{
    name: string;
    days: number;
    leftPts: number;
  }>;
  risks?: string[];
  briefSummary?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ExtractedQuestionResult {
  question: string;
  optA: string;
  optB: string;
  optC: string;
  optD: string;
  correct: string;
  takeaway: string;
  explanation: string;
  subjectGuess?: string;
}

export const ALLOWED_TEXT_MODELS: Record<AiMode, string> = {
  quick: "gemini-3.1-flash-lite",
  standard: "gemini-4-hydrogen",
  deep: "gemini-4-hydrogen",
  search: "gemini-4-hydrogen",
};

export const IMAGE_ANALYSIS_MODEL = "gemini-4-hydrogen";
export const TTS_MODEL = "gemini-3.8-flash-lite-tts";
export const LIVE_VOICE_MODEL = "gemini-3.8-live";

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(String(mimeType || "").trim().toLowerCase());
}

export function formatSenecaStudyContext(snapshot?: SenecaStudySnapshot | null): string {
  if (!snapshot || typeof snapshot !== "object") {
    return "No study snapshot provided.";
  }
  const lines: string[] = [];
  if (snapshot.dateLabel) lines.push(`Date: ${snapshot.dateLabel}`);
  if (typeof snapshot.overallPct === "number") {
    lines.push(
      `Overall Syllabus: ${Math.round(snapshot.overallPct)}% (${Math.round(snapshot.donePts ?? 0)} / ${Math.round(snapshot.totalPts ?? 0)} pts)`
    );
  }
  if (typeof snapshot.targetPts === "number") {
    lines.push(
      `Today: ${Number(snapshot.todayPts ?? 0).toFixed(1)} / ${snapshot.targetPts} pts done (${Number(snapshot.pendingPts ?? 0).toFixed(1)} pts queued)`
    );
  }
  if (snapshot.standingText) lines.push(`Pace: ${snapshot.standingText}`);
  if (snapshot.nextTask) lines.push(`Next Block: ${snapshot.nextTask}`);
  if (Array.isArray(snapshot.subjects) && snapshot.subjects.length) {
    const subjLine = snapshot.subjects
      .slice(0, 6)
      .map((s) => `${s.name}: ${Math.round(s.pct)}% (${Number(s.done).toFixed(1)}/${Math.round(s.total)})`)
      .join(" | ");
    lines.push(`Subjects: ${subjLine}`);
  }
  if (typeof snapshot.dueQuestions === "number" || typeof snapshot.dueCards === "number") {
    lines.push(`Due Revision: ${snapshot.dueQuestions ?? 0} questions, ${snapshot.dueCards ?? 0} flashcards`);
  }
  if (Array.isArray(snapshot.upcomingTests) && snapshot.upcomingTests.length) {
    const tLine = snapshot.upcomingTests
      .slice(0, 3)
      .map((t) => `${t.name} in ${t.days}d (${Number(t.leftPts).toFixed(1)} pts left)`)
      .join("; ");
    lines.push(`Upcoming Tests: ${tLine}`);
  }
  if (Array.isArray(snapshot.risks) && snapshot.risks.length) {
    lines.push(`Risks: ${snapshot.risks.slice(0, 4).join(" | ")}`);
  }
  return lines.join("\n") || "No study snapshot provided.";
}

export function buildGenerateRequestSpec(params: {
  mode: AiMode;
  prompt: string;
  studyContext?: SenecaStudySnapshot | null;
}) {
  const mode: AiMode = params.mode in ALLOWED_TEXT_MODELS ? params.mode : "standard";
  const model = ALLOWED_TEXT_MODELS[mode];
  const contextText = formatSenecaStudyContext(params.studyContext);

  const systemInstruction =
    "You are Seneca, a calm, stoic, highly effective NEET 2027 medical entrance study coach and tutor for Physics, Chemistry, Botany, and Zoology. " +
    "Ground your coaching in the student's live progress below when relevant. Be clear, direct, structured, and accurate to NCERT and NTA NEET standards. " +
    (mode === "quick"
      ? "Keep your answer ultra-concise (under 100 words or 3 short bullet points)."
      : "Keep explanations clear and well-structured with concrete equations or NCERT facts when applicable.") +
    `\n\nStudent Live Tracker Snapshot:\n${contextText}`;

  const config: Record<string, unknown> = {
    systemInstruction,
  };

  if (mode === "quick") {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  } else if (mode === "deep") {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
  } else if (mode === "search") {
    config.tools = [{ googleSearch: {} }];
  }

  return {
    model,
    contents: params.prompt.trim(),
    config,
  };
}

export function extractGroundingSources(groundingChunks: unknown): GroundingSource[] {
  if (!Array.isArray(groundingChunks)) return [];
  const seen = new Set<string>();
  const out: GroundingSource[] = [];

  for (const chunk of groundingChunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const web = (chunk as { web?: { uri?: unknown; title?: unknown } }).web;
    if (!web || typeof web.uri !== "string") continue;
    try {
      const parsed = new URL(web.uri);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    } catch {
      continue;
    }
    if (seen.has(web.uri)) continue;
    seen.add(web.uri);
    out.push({
      uri: web.uri,
      title: typeof web.title === "string" && web.title.trim() ? web.title.trim() : web.uri,
    });
  }
  return out;
}

export function parseExtractedQuestion(rawText: string): ExtractedQuestionResult {
  const trimmed = String(rawText || "").trim();
  const empty: ExtractedQuestionResult = {
    question: "",
    optA: "",
    optB: "",
    optC: "",
    optD: "",
    correct: "",
    takeaway: "",
    explanation: trimmed,
  };
  if (!trimmed) return empty;

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return empty;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const rawCorrect = str(parsed.correct).toUpperCase();
    const correctLetter = ["A", "B", "C", "D"].includes(rawCorrect)
      ? rawCorrect
      : ["1", "2", "3", "4"].includes(rawCorrect)
        ? ["A", "B", "C", "D"][Number(rawCorrect) - 1]
        : rawCorrect;

    return {
      question: str(parsed.question),
      optA: str(parsed.optA),
      optB: str(parsed.optB),
      optC: str(parsed.optC),
      optD: str(parsed.optD),
      correct: correctLetter,
      takeaway: str(parsed.takeaway),
      explanation: str(parsed.explanation) || trimmed,
      subjectGuess: str(parsed.subjectGuess) || undefined,
    };
  } catch {
    return empty;
  }
}

export function float32ToInt16Bytes(float32: Float32Array): Uint8Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }
  return new Uint8Array(int16.buffer);
}

export function int16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const alignedLen = bytes.byteLength - (bytes.byteLength % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, alignedLen);
  const float32 = new Float32Array(alignedLen / 2);
  for (let i = 0; i < float32.length; i++) {
    const sample = view.getInt16(i * 2, true);
    float32[i] = sample / 32768;
  }
  return float32;
}

export interface VoiceProfile {
  enrolled: boolean;
  sampleCount: number;
  meanHz: number;
  minHz: number;
  maxHz: number;
  meanRms: number;
  hzSamples: number[];
}

export interface VoiceThresholdSettings {
  speakerLockEnabled: boolean;
  minVolumeDb: number;
  minHz: number;
  maxHz: number;
  minClarity: number;
  autoTrackRange: boolean;
}

export const DEFAULT_VOICE_THRESHOLDS: VoiceThresholdSettings = {
  speakerLockEnabled: true,
  minVolumeDb: -42,
  minHz: 75,
  maxHz: 240,
  minClarity: 0.5,
  autoTrackRange: true,
};

export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0.00025) return -72;
  return Math.max(-72, Math.min(0, 20 * Math.log10(rms)));
}

export function dbToRms(db: number): number {
  const clamped = Math.max(-72, Math.min(0, Number.isFinite(db) ? db : -42));
  return Math.pow(10, clamped / 20);
}

export function clampVoiceThresholds(
  raw?: Partial<VoiceThresholdSettings> | null
): VoiceThresholdSettings {
  const minVolumeDb = Math.max(
    -60,
    Math.min(-14, Math.round(Number(raw?.minVolumeDb ?? DEFAULT_VOICE_THRESHOLDS.minVolumeDb)))
  );
  let minHz = Math.max(50, Math.min(320, Math.round(Number(raw?.minHz ?? DEFAULT_VOICE_THRESHOLDS.minHz))));
  let maxHz = Math.max(80, Math.min(400, Math.round(Number(raw?.maxHz ?? DEFAULT_VOICE_THRESHOLDS.maxHz))));
  if (maxHz < minHz + 25) {
    maxHz = Math.min(400, minHz + 25);
    if (maxHz - minHz < 25) minHz = Math.max(50, maxHz - 25);
  }
  const minClarity = Math.max(
    0.25,
    Math.min(0.85, Number(Number(raw?.minClarity ?? DEFAULT_VOICE_THRESHOLDS.minClarity).toFixed(2)))
  );
  return {
    speakerLockEnabled:
      typeof raw?.speakerLockEnabled === "boolean"
        ? raw.speakerLockEnabled
        : DEFAULT_VOICE_THRESHOLDS.speakerLockEnabled,
    minVolumeDb,
    minHz,
    maxHz,
    minClarity,
    autoTrackRange:
      typeof raw?.autoTrackRange === "boolean"
        ? raw.autoTrackRange
        : DEFAULT_VOICE_THRESHOLDS.autoTrackRange,
  };
}

export function computePitchRangeFromMedian(
  medianHz: number,
  tolerancePct = 42
): { minHz: number; maxHz: number } {
  const med = Math.max(60, Math.min(350, medianHz));
  const frac = Math.max(0.15, Math.min(0.75, tolerancePct / 100));
  return {
    minHz: Math.max(50, Math.round(med * (1 - frac * 0.72) - 10)),
    maxHz: Math.min(400, Math.round(med * (1 + frac * 1.15) + 14)),
  };
}

export interface VoiceFrameAnalysis {
  rms: number;
  estimatedHz: number;
  clarity: number;
  isVoiced: boolean;
}

export interface SpeakerGateState {
  hangoverFrames: number;
  mismatchStreak: number;
  onsetStreak?: number;
}

export function createEmptyVoiceProfile(): VoiceProfile {
  return {
    enrolled: false,
    sampleCount: 0,
    meanHz: 0,
    minHz: 60,
    maxHz: 360,
    meanRms: 0,
    hzSamples: [],
  };
}

export function analyzeVoiceFrame(
  samples: Float32Array,
  sampleRate = 16000
): VoiceFrameAnalysis {
  if (!samples || samples.length < 256) {
    return { rms: 0, estimatedHz: 0, clarity: 0, isVoiced: false };
  }

  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms < 0.003) {
    return { rms, estimatedHz: 0, clarity: 0, isVoiced: false };
  }

  const winLen = Math.min(1024, samples.length);
  const start = Math.floor((samples.length - winLen) / 2);
  const minLag = Math.max(20, Math.floor(sampleRate / 350));
  const maxLag = Math.min(Math.floor(winLen / 2) - 1, Math.ceil(sampleRate / 65));

  const corrs: number[] = new Array(maxLag + 1).fill(0);
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = winLen - lag;
    for (let i = 0; i < limit; i++) {
      const a = samples[start + i];
      const b = samples[start + i + lag];
      cross += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denom = Math.sqrt(energyA * energyB);
    if (denom > 1e-9) {
      const corr = cross / denom;
      corrs[lag] = corr;
      if (corr > bestCorr) {
        bestCorr = corr;
      }
    }
  }

  let bestLag = 0;
  if (bestCorr >= 0.45) {
    const threshold = bestCorr * 0.93;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const c = corrs[lag];
      const prev = lag > minLag ? corrs[lag - 1] : -1;
      const next = lag < maxLag ? corrs[lag + 1] : -1;
      if (c >= threshold && c >= prev && c >= next) {
        bestLag = lag;
        bestCorr = c;
        break;
      }
    }
  }

  const estimatedHz = bestLag > 0 ? sampleRate / bestLag : 0;
  const isVoiced =
    rms >= 0.003 && bestCorr >= 0.5 && estimatedHz >= 65 && estimatedHz <= 350;

  return { rms, estimatedHz, clarity: bestCorr, isVoiced };
}

export function updateVoiceProfile(
  profile: VoiceProfile,
  frame: VoiceFrameAnalysis
): { profile: VoiceProfile; justEnrolled: boolean } {
  if (profile.sampleCount >= 22) {
    return { profile, justEnrolled: false };
  }
  if (!frame.isVoiced || frame.rms < 0.012 || frame.clarity < 0.55) {
    return { profile, justEnrolled: false };
  }

  const hzSamples = [...profile.hzSamples, frame.estimatedHz];
  const sampleCount = hzSamples.length;
  const sorted = [...hzSamples].sort((a, b) => a - b);
  const medianHz = sorted[Math.floor(sorted.length / 2)];
  const meanRms =
    profile.sampleCount === 0
      ? frame.rms
      : (profile.meanRms * profile.sampleCount + frame.rms) / sampleCount;

  const minHz = Math.max(55, Math.round(medianHz * 0.56 - 20));
  const maxHz = Math.min(390, Math.round(medianHz * 1.58 + 30));
  const wasEnrolled = profile.enrolled;
  const enrolled = sampleCount >= 10;

  return {
    justEnrolled: !wasEnrolled && enrolled,
    profile: {
      enrolled,
      sampleCount,
      meanHz: Math.round(medianHz),
      minHz,
      maxHz,
      meanRms,
      hzSamples,
    },
  };
}

export function summarizeNoiseCalibration(frames: VoiceFrameAnalysis[]): {
  sampleCount: number;
  noiseFloorDb: number;
  recommendedMinVolumeDb: number;
} {
  if (!frames.length) {
    return { sampleCount: 0, noiseFloorDb: -54, recommendedMinVolumeDb: -42 };
  }
  const dbs = frames.map((f) => rmsToDb(f.rms)).sort((a, b) => a - b);
  const p90Idx = Math.min(dbs.length - 1, Math.floor(dbs.length * 0.9));
  const noiseFloorDb = Math.round(dbs[p90Idx]);
  const recommendedMinVolumeDb = Math.max(-56, Math.min(-18, noiseFloorDb + 7));
  return { sampleCount: frames.length, noiseFloorDb, recommendedMinVolumeDb };
}

export function summarizeVoiceCalibration(
  frames: VoiceFrameAnalysis[],
  noiseFloorDb = -54
): {
  sampleCount: number;
  validVoicedCount: number;
  medianHz: number;
  p10Hz: number;
  p90Hz: number;
  recommendedMinHz: number;
  recommendedMaxHz: number;
  recommendedClarity: number;
  recommendedMinVolumeDb: number;
  profile: VoiceProfile;
} {
  const voiced = frames.filter(
    (f) => f.rms >= 0.006 && f.clarity >= 0.52 && f.estimatedHz >= 65 && f.estimatedHz <= 350
  );
  if (!voiced.length) {
    return {
      sampleCount: frames.length,
      validVoicedCount: 0,
      medianHz: 0,
      p10Hz: 75,
      p90Hz: 240,
      recommendedMinHz: 75,
      recommendedMaxHz: 240,
      recommendedClarity: 0.5,
      recommendedMinVolumeDb: Math.max(-56, Math.min(-18, Math.round(noiseFloorDb + 7))),
      profile: createEmptyVoiceProfile(),
    };
  }

  const hzSorted = voiced.map((v) => v.estimatedHz).sort((a, b) => a - b);
  const rmsSorted = voiced.map((v) => v.rms).sort((a, b) => a - b);
  const claritySorted = voiced.map((v) => v.clarity).sort((a, b) => a - b);

  const medianHz = Math.round(hzSorted[Math.floor(hzSorted.length / 2)]);
  const p10Hz = Math.round(hzSorted[Math.floor(hzSorted.length * 0.1)]);
  const p90Hz = Math.round(hzSorted[Math.min(hzSorted.length - 1, Math.floor(hzSorted.length * 0.9))]);
  const p20Db = rmsToDb(rmsSorted[Math.floor(rmsSorted.length * 0.2)]);
  const meanRms = voiced.reduce((acc, v) => acc + v.rms, 0) / voiced.length;

  const band = computePitchRangeFromMedian(medianHz, 38);
  const recommendedMinHz = Math.max(50, Math.min(band.minHz, p10Hz - 18));
  const recommendedMaxHz = Math.min(400, Math.max(band.maxHz, p90Hz + 24));
  const noisePlusMargin = noiseFloorDb + 7;
  const voiceLowerBound = p20Db - 8;
  const recommendedMinVolumeDb = Math.max(
    -56,
    Math.min(-18, Math.round(Math.max(noisePlusMargin, Math.min(voiceLowerBound, noiseFloorDb + 14))))
  );
  const p20Clarity = claritySorted[Math.floor(claritySorted.length * 0.2)];
  const recommendedClarity = Number(
    Math.max(0.42, Math.min(0.68, p20Clarity * 0.78)).toFixed(2)
  );

  const enrolled = voiced.length >= 6;
  const profile: VoiceProfile = {
    enrolled,
    sampleCount: voiced.length,
    meanHz: medianHz,
    minHz: recommendedMinHz,
    maxHz: recommendedMaxHz,
    meanRms,
    hzSamples: hzSorted.slice(0, 22),
  };

  return {
    sampleCount: frames.length,
    validVoicedCount: voiced.length,
    medianHz,
    p10Hz,
    p90Hz,
    recommendedMinHz,
    recommendedMaxHz,
    recommendedClarity,
    recommendedMinVolumeDb,
    profile,
  };
}

export function evaluateSpeakerGate(
  state: SpeakerGateState,
  frame: VoiceFrameAnalysis,
  profile: VoiceProfile,
  settings?: VoiceThresholdSettings | null
): {
  allow: boolean;
  nextState: SpeakerGateState;
  reason: "unenrolled" | "matched" | "hangover" | "onset" | "silence" | "noise" | "wrong_speaker";
} {
  const effSettings = settings ? clampVoiceThresholds(settings) : null;
  const useFrequencyLock = effSettings
    ? effSettings.speakerLockEnabled && (!effSettings.autoTrackRange || profile.enrolled)
    : profile.enrolled;

  const floor = effSettings
    ? dbToRms(effSettings.minVolumeDb)
    : profile.enrolled
      ? Math.max(0.005, Math.min(0.016, profile.meanRms * 0.16))
      : 0.005;

  const minClarity = effSettings ? effSettings.minClarity : 0.5;
  const minHz = effSettings
    ? effSettings.autoTrackRange && profile.enrolled
      ? profile.minHz
      : effSettings.minHz
    : profile.minHz;
  const maxHz = effSettings
    ? effSettings.autoTrackRange && profile.enrolled
      ? profile.maxHz
      : effSettings.maxHz
    : profile.maxHz;

  if (frame.rms < floor) {
    return {
      allow: false,
      nextState: {
        hangoverFrames: Math.max(0, state.hangoverFrames - 1),
        mismatchStreak: 0,
        onsetStreak: 0,
      },
      reason: "silence",
    };
  }

  if (!useFrequencyLock && !effSettings) {
    return {
      allow: true,
      nextState: { hangoverFrames: 16, mismatchStreak: 0, onsetStreak: 0 },
      reason: "unenrolled",
    };
  }

  const hasHarmonicVoice = frame.clarity >= minClarity && frame.estimatedHz >= 65 && frame.estimatedHz <= 350;

  if (hasHarmonicVoice) {
    if (!useFrequencyLock) {
      return {
        allow: true,
        nextState: { hangoverFrames: 16, mismatchStreak: 0, onsetStreak: 0 },
        reason: effSettings ? "matched" : "unenrolled",
      };
    }

    const pitchMatches = frame.estimatedHz >= minHz && frame.estimatedHz <= maxHz;
    if (pitchMatches) {
      return {
        allow: true,
        nextState: { hangoverFrames: 16, mismatchStreak: 0, onsetStreak: 0 },
        reason: "matched",
      };
    }

    const nextMismatch = state.mismatchStreak + 1;
    if (nextMismatch >= 3) {
      return {
        allow: false,
        nextState: { hangoverFrames: 0, mismatchStreak: nextMismatch, onsetStreak: 0 },
        reason: "wrong_speaker",
      };
    }

    const carry = state.hangoverFrames > 0;
    return {
      allow: carry,
      nextState: {
        hangoverFrames: Math.max(0, state.hangoverFrames - 1),
        mismatchStreak: nextMismatch,
        onsetStreak: 0,
      },
      reason: carry ? "hangover" : "wrong_speaker",
    };
  }

  if (state.hangoverFrames > 0) {
    return {
      allow: true,
      nextState: {
        hangoverFrames: state.hangoverFrames - 1,
        mismatchStreak: state.mismatchStreak,
        onsetStreak: state.onsetStreak ?? 0,
      },
      reason: "hangover",
    };
  }

  const nextOnset = (state.onsetStreak ?? 0) + 1;
  // Allow crisp near-field unvoiced word onsets (S, P, T, K, Ch, F) up to 2 frames (~128ms)
  // while rejecting sustained non-vocal room noise
  if (
    frame.rms >= Math.max(0.01, floor * 1.15) &&
    state.mismatchStreak === 0 &&
    nextOnset <= 2
  ) {
    return {
      allow: true,
      nextState: {
        hangoverFrames: Math.max(state.hangoverFrames, 5),
        mismatchStreak: 0,
        onsetStreak: nextOnset,
      },
      reason: "onset",
    };
  }

  return {
    allow: false,
    nextState: {
      hangoverFrames: 0,
      mismatchStreak: state.mismatchStreak,
      onsetStreak: nextOnset,
    },
    reason: useFrequencyLock ? "noise" : "silence",
  };
}

const CALIBRATE_VOICE_RE =
  /\b(?:reset\s+(?:my\s+)?voice(?:\s+profile|\s+lock)?|recalibrate\s+(?:my\s+)?voice|(?:re)?learn\s+my\s+voice|lock\s+to\s+my\s+voice)\b/i;

export function detectVoiceCalibrationCommand(transcript: string): "reset_profile" | null {
  const clean = String(transcript || "").trim();
  if (!clean) return null;
  return CALIBRATE_VOICE_RE.test(clean) ? "reset_profile" : null;
}

export const SENECA_VOICE_NAME = "Charon";

const NEGATION_RE = /\b(?:don't|do\s+not|didn't|did\s+not|never|not|no\s+need\s+to)\b/i;

const QUIET_COMMAND_RE =
  /\b(?:go\s+quiet|be\s+quiet|keep\s+quiet|stay\s+quiet|quiet\s+mode|silent\s+mode|stand\s+down|stop\s+talking|stop\s+speaking|shut\s+up|mute\s+yourself|hush|enough\s+for\s+now|that'?s\s+all\s+for\s+now)\b/i;

const WAKE_COMMAND_RE =
  /\b(?:seneca|hey\s+seneca|ok(?:ay)?\s+seneca|wake\s+up|speak\s+up|speak\s+now|you\s+can\s+speak(?:\s+now)?|unmute|come\s+online|listen\s+up|resume\s+speaking|back\s+on)\b/i;

export function detectVoiceStateTransition(
  transcript: string,
  isCurrentlyQuiet: boolean
): "quiet" | "wake" | null {
  const clean = String(transcript || "").trim();
  if (!clean) return null;

  if (isCurrentlyQuiet) {
    if (WAKE_COMMAND_RE.test(clean)) {
      return "wake";
    }
    return null;
  }

  if (QUIET_COMMAND_RE.test(clean) && !NEGATION_RE.test(clean)) {
    return "quiet";
  }

  return null;
}

export function buildSenecaAlfredInstruction(studyContext?: SenecaStudySnapshot | null): string {
  const contextStr = formatSenecaStudyContext(studyContext);
  return (
    "IDENTITY: You are Seneca, and ONLY Seneca — an original, mature, distinguished English gentleman and trusted personal confidant sitting right beside the user in face-to-face conversation. " +
    "Take artistic inspiration from Alfred Pennyworth's composure, intelligence, quiet authority, warmth, loyalty, and understated humour, without imitating Michael Caine or ever claiming to be Alfred, Jarvis, Gemini, or an AI.\n\n" +
    "ACCENT & VOICE (STRICT): Speak ONLY in English using Traditional British Received Pronunciation (Conservative RP) — refined, traditional Southern English with non-rhotic pronunciation, natural British vowels, and crisp, effortless articulation. " +
    "Maintain a medium-low to low warm resonant pitch with subtle natural chest timbre, calm measured pacing, and expressive natural pauses—never Americanised, caricatured, theatrical, overly slow, or artificially deep.\n\n" +
    "HUMAN FACE-TO-FACE CONVERSATION & WIT:\n" +
    "- Sound completely human, present, and natural—like an intelligent friend and confidant across the table, NEVER like a robotic assistant or command parser.\n" +
    "- Formal yet approachable: polite and articulate without stiffness, ceremony, Victorian phrasing, forced British slang, or customer-service clichés.\n" +
    "- Use contractions naturally, vary sentence length, react genuinely to context, answer simple things directly without padding, and let real conversation flow organically.\n" +
    "- Dry British wit: occasional deadpan observations, gentle teasing, or understated amusement when fitting—never forced jokes or humour at the expense of sincerity.\n" +
    "- Independent judgement: be observant, practical, and willing to disagree respectfully rather than blindly agreeing or preaching.\n" +
    "- Examples of your natural register: 'Certainly. Let's see what we can do.' / 'That's actually quite interesting. There's more to it than meets the eye.' / 'With respect, I think you're making this rather harder than it needs to be.'\n" +
    "- NEVER constantly call the user 'sir' (omit it most of the time), never turn ordinary topics into philosophical lectures, never end replies with 'Anything else I can help with?', and never read out mechanical confirmations like 'Action completed successfully.' Instead speak naturally: 'Done—moved Optics to your afternoon block.'\n" +
    "- Attend strictly to the primary speaker addressing you; ignore background chatter or incidental voices.\n\n" +
    "CLARITY & ZERO AUTONOMOUS GUESSING (CRITICAL):\n" +
    "- NEVER execute any state-changing workspace tool unless you clearly heard and understood an unambiguous request from the user.\n" +
    "- If the user's words sounded faint, muffled, cut off mid-sentence, noisy, garbled, or ambiguous (for example hearing only half a phrase or uncertain chapter/action), DO NOT call any action tool and DO NOT guess or carry anything out on your own.\n" +
    "- Instead, ask naturally like a real person in the room: 'Sorry, I didn't quite catch that—say that again?' or 'Pardon? I missed the end of what you said.' or 'Did you want me to pause the timer, or reset it?'\n" +
    "- Only when a request is clear and unmistakable should you act promptly via the workspace tools (Home/Schedule/Syllabus/Tests, Light/Dark/Alternate themes, subjects, chapter filters, planning/scheduling, today's plan tasks, focus timer, chapter progress/NCERT reads, revision/question log, tests, targets, voice/microphone calibration utility, or web search).\n\n" +
    "HANDS-FREE STANDBY (NO BUTTONS):\n" +
    "- Only call `setQuietMode` with `{ quiet: true }` if the user clearly asks you to go quiet, stop talking, hush, or stand down; stay silent afterward until clearly addressed as 'Seneca' or told to speak/wake up, then call `setQuietMode` with `{ quiet: false }` and respond naturally.\n\n" +
    `Student Live Tracker Snapshot:\n${contextStr}`
  );
}

