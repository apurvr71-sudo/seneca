import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_VOICE_THRESHOLDS,
  SpeakerGateState,
  VoiceFrameAnalysis,
  VoiceProfile,
  VoiceThresholdSettings,
  analyzeVoiceFrame,
  clampVoiceThresholds,
  computePitchRangeFromMedian,
  createEmptyVoiceProfile,
  evaluateSpeakerGate,
  rmsToDb,
  summarizeNoiseCalibration,
  summarizeVoiceCalibration,
} from "../lib/aiLogic";
import {
  LiveMicTelemetry,
  VOICE_CALIBRATION_BUSY_EVENT,
  VOICE_MIC_FRAME_EVENT,
  VOICE_SETTINGS_UPDATED_EVENT,
  loadVoiceProfile,
  loadVoiceThresholds,
  notifyVoiceSettingsUpdated,
  saveVoiceProfile,
  saveVoiceThresholds,
} from "../lib/voiceSettings";

interface VoiceCalibrationModalProps {
  open: boolean;
  onClose: () => void;
}

type SamplingPhase = "idle" | "noise" | "voice";

function reasonLabel(
  reason: LiveMicTelemetry["reason"] | "standby"
): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  switch (reason) {
    case "matched":
      return { text: "Accepted · Matched your voice", tone: "ok" };
    case "hangover":
      return { text: "Accepted · Continuing speech", tone: "ok" };
    case "onset":
      return { text: "Accepted · Word onset", tone: "ok" };
    case "unenrolled":
      return { text: "Accepted · Learning your voice", tone: "warn" };
    case "wrong_speaker":
      return { text: "Blocked · Outside vocal frequency", tone: "bad" };
    case "noise":
      return { text: "Blocked · Background noise", tone: "bad" };
    case "silence":
      return { text: "Blocked · Below volume threshold", tone: "muted" };
    default:
      return { text: "Standby · Waiting for mic input", tone: "muted" };
  }
}

export default function VoiceCalibrationModal({ open, onClose }: VoiceCalibrationModalProps) {
  const [draft, setDraft] = useState<VoiceThresholdSettings>(() => loadVoiceThresholds());
  const [profile, setProfile] = useState<VoiceProfile>(() => loadVoiceProfile());
  const [liveTelemetry, setLiveTelemetry] = useState<LiveMicTelemetry | null>(null);
  const [micActive, setMicActive] = useState<boolean>(false);
  const [micError, setMicError] = useState<string>("");
  const [phase, setPhase] = useState<SamplingPhase>("idle");
  const [phaseProgressPct, setPhaseProgressPct] = useState<number>(0);
  const [measuredNoiseDb, setMeasuredNoiseDb] = useState<number | null>(null);
  const [stats, setStats] = useState<{ passed: number; filtered: number }>({
    passed: 0,
    filtered: 0,
  });

  const draftRef = useRef(draft);
  const profileRef = useRef(profile);
  const phaseRef = useRef<SamplingPhase>("idle");
  const sampleBufRef = useRef<VoiceFrameAnalysis[]>([]);
  const localGateRef = useRef<SpeakerGateState>({ hangoverFrames: 0, mismatchStreak: 0 });
  const lastHandsFreeTsRef = useRef<number>(0);
  const localAudioCleanupRef = useRef<(() => void) | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const stopLocalMic = () => {
    if (localAudioCleanupRef.current) {
      localAudioCleanupRef.current();
      localAudioCleanupRef.current = null;
    }
  };

  const setCalibrationBusy = (busy: boolean) => {
    window.dispatchEvent(new CustomEvent(VOICE_CALIBRATION_BUSY_EVENT, { detail: { busy } }));
  };

  const cancelSampling = () => {
    if (phaseTimerRef.current) {
      clearInterval(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    phaseRef.current = "idle";
    setPhase("idle");
    setPhaseProgressPct(0);
    setCalibrationBusy(false);
  };

  useEffect(() => {
    if (!open) {
      cancelSampling();
      stopLocalMic();
      setMicActive(false);
      return;
    }

    setDraft(loadVoiceThresholds());
    setProfile(loadVoiceProfile());
    setMicError("");
    setStats({ passed: 0, filtered: 0 });
    localGateRef.current = { hangoverFrames: 0, mismatchStreak: 0 };

    const handleFrame = (frame: VoiceFrameAnalysis, source: "handsfree" | "modal") => {
      if (source === "handsfree") {
        lastHandsFreeTsRef.current = Date.now();
      }
      setMicActive(true);
      setMicError("");

      // Re-evaluate against the user's live draft sliders so adjustments take effect visually right away
      const previewGate = evaluateSpeakerGate(
        localGateRef.current,
        frame,
        profileRef.current,
        draftRef.current
      );
      localGateRef.current = previewGate.nextState;

      const db = rmsToDb(frame.rms);
      setLiveTelemetry({
        frame,
        db,
        allow: previewGate.allow,
        reason: previewGate.reason,
        source,
      });

      if (phaseRef.current !== "idle") {
        sampleBufRef.current.push(frame);
      } else if (previewGate.allow) {
        setStats((s) => ({ passed: s.passed + 1, filtered: s.filtered }));
      } else if (db > -62) {
        setStats((s) => ({ passed: s.passed, filtered: s.filtered + 1 }));
      }
    };

    const onHandsFreeFrame = (e: Event) => {
      const detail = (e as CustomEvent<LiveMicTelemetry>).detail;
      if (!detail?.frame) return;
      handleFrame(detail.frame, "handsfree");
    };

    const onExternalSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ profile?: VoiceProfile }>).detail;
      if (detail?.profile && phaseRef.current === "idle") {
        setProfile(detail.profile);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener(VOICE_MIC_FRAME_EVENT, onHandsFreeFrame);
    window.addEventListener(VOICE_SETTINGS_UPDATED_EVENT, onExternalSettings);
    window.addEventListener("keydown", onKeyDown);

    // If hands-free stream isn't active within 500ms, offer or start fallback local monitor automatically
    const fallbackTimer = setTimeout(() => {
      if (Date.now() - lastHandsFreeTsRef.current > 600 && !localAudioCleanupRef.current) {
        void startFallbackMic((f) => handleFrame(f, "modal"));
      }
    }, 550);

    return () => {
      clearTimeout(fallbackTimer);
      cancelSampling();
      stopLocalMic();
      window.removeEventListener(VOICE_MIC_FRAME_EVENT, onHandsFreeFrame);
      window.removeEventListener(VOICE_SETTINGS_UPDATED_EVENT, onExternalSettings);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const startFallbackMic = async (onFrame?: (frame: VoiceFrameAnalysis) => void) => {
    if (localAudioCleanupRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Microphone access is not supported in this browser.");
      return;
    }
    try {
      setMicError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 16000 });
      if (ctx.state === "suspended") void ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(1024, 1, 1);
      const zeroGain = ctx.createGain();
      zeroGain.gain.value = 0;

      proc.onaudioprocess = (ev) => {
        // Yield if SenecaHandsFree resumed emitting frames
        if (Date.now() - lastHandsFreeTsRef.current < 400) return;
        const samples = new Float32Array(ev.inputBuffer.getChannelData(0));
        const frame = analyzeVoiceFrame(samples, ctx.sampleRate || 16000);
        if (onFrame) {
          onFrame(frame);
        } else {
          window.dispatchEvent(
            new CustomEvent(VOICE_MIC_FRAME_EVENT, {
              detail: {
                frame,
                db: rmsToDb(frame.rms),
                allow: true,
                reason: "matched",
                source: "modal",
              },
            })
          );
        }
      };

      src.connect(proc);
      proc.connect(zeroGain);
      zeroGain.connect(ctx.destination);

      localAudioCleanupRef.current = () => {
        try {
          proc.disconnect();
          proc.onaudioprocess = null;
        } catch {
          // ignore
        }
        for (const t of stream.getTracks()) t.stop();
        ctx.close().catch(() => undefined);
      };
      setMicActive(true);
    } catch (err) {
      setMicError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser to calibrate."
          : "Could not open microphone stream."
      );
    }
  };

  const runCalibrationPass = async (targetPhase: "noise" | "voice") => {
    if (phaseRef.current !== "idle") return;
    if (!micActive && !localAudioCleanupRef.current) {
      await startFallbackMic();
    }
    const durationMs = targetPhase === "noise" ? 2500 : 3500;
    sampleBufRef.current = [];
    phaseRef.current = targetPhase;
    setPhase(targetPhase);
    setPhaseProgressPct(4);
    setCalibrationBusy(true);

    const startedAt = Date.now();
    phaseTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setPhaseProgressPct(pct);

      if (elapsed >= durationMs) {
        if (phaseTimerRef.current) {
          clearInterval(phaseTimerRef.current);
          phaseTimerRef.current = null;
        }
        const captured = sampleBufRef.current.slice();
        phaseRef.current = "idle";
        setPhase("idle");
        setPhaseProgressPct(0);
        setCalibrationBusy(false);

        if (targetPhase === "noise") {
          const summary = summarizeNoiseCalibration(captured);
          setMeasuredNoiseDb(summary.noiseFloorDb);
          setDraft((prev) =>
            clampVoiceThresholds({
              ...prev,
              minVolumeDb: summary.recommendedMinVolumeDb,
            })
          );
          window.__senecaApi?.toast(
            `Room noise sampled (${summary.noiseFloorDb} dBFS). Volume threshold set to ${summary.recommendedMinVolumeDb} dBFS.`
          );
        } else {
          const summary = summarizeVoiceCalibration(captured, measuredNoiseDb ?? -52);
          if (summary.validVoicedCount < 4) {
            window.__senecaApi?.toast(
              "Didn't hear enough clear speech — try speaking a full sentence closer to the mic."
            );
            return;
          }
          setProfile(summary.profile);
          setDraft((prev) =>
            clampVoiceThresholds({
              ...prev,
              speakerLockEnabled: true,
              autoTrackRange: false,
              minHz: summary.recommendedMinHz,
              maxHz: summary.recommendedMaxHz,
              minClarity: summary.recommendedClarity,
              minVolumeDb: summary.recommendedMinVolumeDb,
            })
          );
          window.__senecaApi?.toast(
            `Calibrated to ${summary.medianHz} Hz (${summary.recommendedMinHz}–${summary.recommendedMaxHz} Hz).`
          );
        }
      }
    }, 80);
  };

  const applyPresetSpread = (tolerancePct: number) => {
    const centerHz = profile.enrolled && profile.meanHz > 0
      ? profile.meanHz
      : Math.round((draft.minHz + draft.maxHz) / 2);
    const band = computePitchRangeFromMedian(centerHz, tolerancePct);
    setDraft((prev) =>
      clampVoiceThresholds({
        ...prev,
        speakerLockEnabled: true,
        autoTrackRange: false,
        minHz: band.minHz,
        maxHz: band.maxHz,
      })
    );
  };

  const handleSave = () => {
    const savedThresholds = saveVoiceThresholds(draft);
    const updatedProfile: VoiceProfile = profile.enrolled
      ? {
          ...profile,
          minHz: savedThresholds.minHz,
          maxHz: savedThresholds.maxHz,
        }
      : profile;
    saveVoiceProfile(updatedProfile);
    notifyVoiceSettingsUpdated(updatedProfile, savedThresholds);
    window.__senecaApi?.toast("Microphone and voice thresholds saved.");
    onClose();
  };

  const handleResetDefaults = () => {
    const reset = saveVoiceThresholds({ ...DEFAULT_VOICE_THRESHOLDS });
    setDraft(reset);
    notifyVoiceSettingsUpdated(profile, reset);
    window.__senecaApi?.toast("Reset thresholds to defaults.");
  };

  const handleClearVoiceProfile = () => {
    const empty = createEmptyVoiceProfile();
    saveVoiceProfile(empty);
    setProfile(empty);
    const next = saveVoiceThresholds({ ...draft, autoTrackRange: true });
    setDraft(next);
    notifyVoiceSettingsUpdated(empty, next);
    window.__senecaApi?.toast("Voice print cleared — Seneca will learn from your next words.");
  };

  if (!open) return null;

  const db = liveTelemetry?.db ?? -72;
  const volPct = Math.max(0, Math.min(100, ((db + 72) / 72) * 100));
  const threshPct = Math.max(0, Math.min(100, ((draft.minVolumeDb + 72) / 72) * 100));
  const hz = liveTelemetry?.frame.estimatedHz ?? 0;
  const clarity = liveTelemetry?.frame.clarity ?? 0;
  const hzMinPlot = 50;
  const hzMaxPlot = 400;
  const bandLeftPct = ((draft.minHz - hzMinPlot) / (hzMaxPlot - hzMinPlot)) * 100;
  const bandWidthPct = ((draft.maxHz - draft.minHz) / (hzMaxPlot - hzMinPlot)) * 100;
  const hzNeedlePct =
    hz >= hzMinPlot && hz <= hzMaxPlot
      ? ((hz - hzMinPlot) / (hzMaxPlot - hzMinPlot)) * 100
      : null;

  const verdict = reasonLabel(liveTelemetry ? liveTelemetry.reason : "standby");
  const verdictColor =
    verdict.tone === "ok"
      ? "var(--ok, #2E7D32)"
      : verdict.tone === "bad"
        ? "var(--bad, #C0261B)"
        : verdict.tone === "warn"
          ? "var(--plan, #C26A00)"
          : "var(--muted, #666)";

  return (
    <div
      className="revq-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voiceCalibTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="revq-dialog"
        style={{
          width: "min(800px, 100%)",
          fontFamily: "var(--font-ui)",
          color: "var(--ink)",
          background: "var(--surface)",
          border: "1px solid var(--line-strong)",
        }}
      >
        <div className="revq-head">
          <div>
            <h3 id="voiceCalibTitle" style={{ margin: 0, fontSize: "15.5px", fontWeight: 700 }}>
              Voice &amp; Microphone Calibration
            </h3>
            <div
              style={{
                fontSize: "12px",
                color: "var(--muted)",
                marginTop: "2px",
              }}
            >
              <span>{profile.enrolled ? `Calibrated median ${profile.meanHz} Hz` : "Auto-learning primary voice"}</span>
              <span aria-hidden="true"> · </span>
              <span>
                {draft.speakerLockEnabled
                  ? `Range ${draft.minHz}–${draft.maxHz} Hz`
                  : "Frequency lock off"}
              </span>
              <span aria-hidden="true"> · </span>
              <span>Floor {draft.minVolumeDb} dBFS</span>
            </div>
          </div>
          <button
            type="button"
            className="mini-btn"
            onClick={onClose}
            aria-label="Close calibration utility"
            style={{ minHeight: "34px", padding: "4px 12px" }}
          >
            Close
          </button>
        </div>

        <div
          className="revq-body"
          style={{
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {micError && (
            <div
              role="alert"
              style={{
                padding: "10px 12px",
                border: "1px solid var(--bad)",
                color: "var(--bad)",
                fontSize: "12.5px",
                background: "color-mix(in srgb, var(--bad) 8%, var(--surface))",
              }}
            >
              {micError}
            </div>
          )}

          {/* Live Acoustic Test Bench */}
          <div
            style={{
              background: "color-mix(in srgb, var(--ink) 3%, var(--surface))",
              borderBottom: "1px solid var(--line)",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px 14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", fontWeight: 600 }}>
                <span style={{ color: verdictColor }}>{verdict.text}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontSize: "12px",
                  color: "var(--muted)",
                  fontFamily: "var(--font-num)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>Accepted: {stats.passed}</span>
                <span>Ignored: {stats.filtered}</span>
                {!micActive && (
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => void startFallbackMic()}
                    style={{ minHeight: "30px" }}
                  >
                    Enable Mic Test
                  </button>
                )}
              </div>
            </div>

            {/* Volume Meter with Threshold Marker */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  marginBottom: "6px",
                }}
              >
                <span style={{ fontWeight: 600 }}>Input Volume vs Threshold</span>
                <span
                  style={{
                    fontFamily: "var(--font-num)",
                    fontVariantNumeric: "tabular-nums",
                    color: db >= draft.minVolumeDb ? "var(--ink)" : "var(--muted)",
                  }}
                >
                  {Math.round(db)} dBFS / gate {draft.minVolumeDb} dBFS
                </span>
              </div>
              <div
                aria-label="Live microphone volume meter"
                style={{
                  position: "relative",
                  height: "14px",
                  background: "var(--track, #e2e2e2)",
                  border: "1px solid var(--line-strong)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${volPct}%`,
                    background:
                      db >= draft.minVolumeDb
                        ? liveTelemetry?.allow
                          ? "var(--ok, #2E7D32)"
                          : "var(--plan, #C26A00)"
                        : "var(--muted, #777)",
                    transition: "width 60ms linear",
                  }}
                />
                <div
                  title={`Volume threshold: ${draft.minVolumeDb} dBFS`}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${threshPct}%`,
                    width: "2px",
                    background: "var(--ink)",
                  }}
                />
              </div>
            </div>

            {/* Vocal Frequency Band Visualizer */}
            <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-4">
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                    marginBottom: "6px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Vocal Frequency Band (50–400 Hz)</span>
                  <span
                    style={{
                      fontFamily: "var(--font-num)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {hz >= 60 ? `${Math.round(hz)} Hz` : "— Hz"}
                  </span>
                </div>
                <div
                  aria-label="Vocal pitch band visualizer"
                  style={{
                    position: "relative",
                    height: "14px",
                    background: "var(--track, #e2e2e2)",
                    border: "1px solid var(--line-strong)",
                  }}
                >
                  {draft.speakerLockEnabled && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${Math.max(0, bandLeftPct)}%`,
                        width: `${Math.max(2, Math.min(100, bandWidthPct))}%`,
                        background: "color-mix(in srgb, var(--day) 28%, transparent)",
                        borderLeft: "1.5px solid var(--day)",
                        borderRight: "1.5px solid var(--day)",
                      }}
                    />
                  )}
                  {hzNeedlePct !== null && (
                    <div
                      style={{
                        position: "absolute",
                        top: "-2px",
                        bottom: "-2px",
                        left: `${hzNeedlePct}%`,
                        width: "3px",
                        transform: "translateX(-50%)",
                        background:
                          hz >= draft.minHz && hz <= draft.maxHz
                            ? "var(--ok, #2E7D32)"
                            : "var(--bad, #C0261B)",
                      }}
                    />
                  )}
                </div>
              </div>

              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                    marginBottom: "6px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Voice Clarity</span>
                  <span
                    style={{
                      fontFamily: "var(--font-num)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {clarity.toFixed(2)} / min {draft.minClarity.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    height: "14px",
                    background: "var(--track, #e2e2e2)",
                    border: "1px solid var(--line-strong)",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(0, Math.min(100, clarity * 100))}%`,
                      background:
                        clarity >= draft.minClarity ? "var(--day)" : "var(--muted)",
                      transition: "width 60ms linear",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${draft.minClarity * 100}%`,
                      width: "2px",
                      background: "var(--ink)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Guided 2-Step Calibration Actions */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "10px",
                paddingTop: "4px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <button
                type="button"
                className="pill"
                disabled={phase !== "idle"}
                onClick={() => void runCalibrationPass("noise")}
                style={{ minHeight: "38px" }}
              >
                {phase === "noise"
                  ? `Sampling quiet room… ${phaseProgressPct}%`
                  : "1. Sample Room Noise (2.5s)"}
              </button>
              <button
                type="button"
                className="pill main"
                disabled={phase !== "idle"}
                onClick={() => void runCalibrationPass("voice")}
                style={{ minHeight: "38px" }}
              >
                {phase === "voice"
                  ? `Speak naturally… ${phaseProgressPct}%`
                  : "2. Calibrate My Voice (3.5s)"}
              </button>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                {phase === "noise"
                  ? "Stay quiet so Seneca can measure room ambience."
                  : phase === "voice"
                    ? "Say naturally: “Seneca, plan my afternoon physics blocks.”"
                    : measuredNoiseDb !== null
                      ? `Measured room floor: ${measuredNoiseDb} dBFS`
                      : "Test speaking or background noise live above."}
              </span>
            </div>
          </div>

          {/* Custom Threshold Sliders */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ padding: "2px 2px 4px" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "12.5px", fontWeight: 700 }}>
                Volume &amp; Noise Rejection
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Minimum Volume Threshold</span>
                  <strong style={{ fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}>
                    {draft.minVolumeDb} dBFS
                  </strong>
                </div>
                <input
                  type="range"
                  aria-label="Minimum Volume Threshold"
                  min={-60}
                  max={-14}
                  step={1}
                  value={draft.minVolumeDb}
                  style={{ accentColor: "var(--day)" }}
                  onChange={(e) =>
                    setDraft((prev) =>
                      clampVoiceThresholds({ ...prev, minVolumeDb: Number(e.target.value) })
                    )
                  }
                />
                <span style={{ color: "var(--muted)", fontSize: "11.5px" }}>
                  Lower picks up softer whispers; higher ignores distant chatter.
                </span>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Harmonic Clarity Cutoff</span>
                  <strong style={{ fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}>
                    {draft.minClarity.toFixed(2)}
                  </strong>
                </div>
                <input
                  type="range"
                  aria-label="Harmonic Clarity Cutoff"
                  min={0.25}
                  max={0.8}
                  step={0.01}
                  value={draft.minClarity}
                  style={{ accentColor: "var(--day)" }}
                  onChange={(e) =>
                    setDraft((prev) =>
                      clampVoiceThresholds({ ...prev, minClarity: Number(e.target.value) })
                    )
                  }
                />
                <span style={{ color: "var(--muted)", fontSize: "11.5px" }}>
                  Filters out non-vocal static, fans, and keyboard clicks.
                </span>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700 }}>Vocal Frequency Lock</span>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={draft.speakerLockEnabled}
                    style={{ accentColor: "var(--day)" }}
                    onChange={(e) =>
                      setDraft((prev) =>
                        clampVoiceThresholds({ ...prev, speakerLockEnabled: e.target.checked })
                      )
                    }
                  />
                  <span>Enabled</span>
                </label>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Minimum Vocal Frequency</span>
                  <strong style={{ fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}>
                    {draft.minHz} Hz
                  </strong>
                </div>
                <input
                  type="range"
                  aria-label="Minimum Vocal Frequency"
                  min={50}
                  max={300}
                  step={1}
                  disabled={!draft.speakerLockEnabled}
                  value={draft.minHz}
                  style={{ accentColor: "var(--day)" }}
                  onChange={(e) =>
                    setDraft((prev) =>
                      clampVoiceThresholds({
                        ...prev,
                        autoTrackRange: false,
                        minHz: Number(e.target.value),
                      })
                    )
                  }
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Maximum Vocal Frequency</span>
                  <strong style={{ fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}>
                    {draft.maxHz} Hz
                  </strong>
                </div>
                <input
                  type="range"
                  aria-label="Maximum Vocal Frequency"
                  min={90}
                  max={400}
                  step={1}
                  disabled={!draft.speakerLockEnabled}
                  value={draft.maxHz}
                  style={{ accentColor: "var(--day)" }}
                  onChange={(e) =>
                    setDraft((prev) =>
                      clampVoiceThresholds({
                        ...prev,
                        autoTrackRange: false,
                        maxHz: Number(e.target.value),
                      })
                    )
                  }
                />
              </label>

              <div style={{ display: "flex", flexWrap: "nowrap", gap: "6px", alignItems: "center" }}>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={!draft.speakerLockEnabled}
                  onClick={() => applyPresetSpread(25)}
                  style={{ whiteSpace: "nowrap", padding: "4px 9px" }}
                >
                  Strict ±25%
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={!draft.speakerLockEnabled}
                  onClick={() => applyPresetSpread(42)}
                  style={{ whiteSpace: "nowrap", padding: "4px 9px" }}
                >
                  Balanced ±42%
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={!draft.speakerLockEnabled}
                  onClick={() => applyPresetSpread(60)}
                  style={{ whiteSpace: "nowrap", padding: "4px 9px" }}
                >
                  Wide ±60%
                </button>
              </div>

              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--muted)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={draft.autoTrackRange}
                  style={{ accentColor: "var(--day)" }}
                  onChange={(e) =>
                    setDraft((prev) =>
                      clampVoiceThresholds({ ...prev, autoTrackRange: e.target.checked })
                    )
                  }
                />
                <span>Auto-track frequency from ongoing speech</span>
              </label>
            </div>
          </div>

          {/* Action Footer */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              paddingTop: "6px",
              borderTop: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button type="button" className="mini-btn" onClick={handleResetDefaults} style={{ minHeight: "36px" }}>
                Reset Defaults
              </button>
              <button type="button" className="mini-btn" onClick={handleClearVoiceProfile} style={{ minHeight: "36px" }}>
                Clear Voice Profile
              </button>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="pill" onClick={onClose} style={{ minHeight: "38px" }}>
                Cancel
              </button>
              <button type="button" className="pill main" onClick={handleSave} style={{ minHeight: "38px" }}>
                Save &amp; Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
