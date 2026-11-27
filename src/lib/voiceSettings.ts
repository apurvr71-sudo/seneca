import {
  DEFAULT_VOICE_THRESHOLDS,
  VoiceFrameAnalysis,
  VoiceProfile,
  VoiceThresholdSettings,
  clampVoiceThresholds,
  createEmptyVoiceProfile,
} from "./aiLogic";

export const VOICE_PROFILE_STORAGE_KEY = "seneca_voice_profile_v1";
export const VOICE_THRESHOLDS_STORAGE_KEY = "seneca_voice_thresholds_v1";

export const VOICE_SETTINGS_UPDATED_EVENT = "seneca-voice-settings-updated";
export const VOICE_MIC_FRAME_EVENT = "seneca-mic-frame";
export const VOICE_CALIBRATION_BUSY_EVENT = "seneca-calibration-busy";
export const VOICE_OPEN_CALIBRATION_EVENT = "seneca-open-calibration";

export interface LiveMicTelemetry {
  frame: VoiceFrameAnalysis;
  db: number;
  allow: boolean;
  reason: "unenrolled" | "matched" | "hangover" | "onset" | "silence" | "noise" | "wrong_speaker";
  source: "handsfree" | "modal";
}

export function loadVoiceProfile(): VoiceProfile {
  try {
    const raw = localStorage.getItem(VOICE_PROFILE_STORAGE_KEY);
    if (!raw) return createEmptyVoiceProfile();
    const parsed = JSON.parse(raw) as Partial<VoiceProfile>;
    if (
      typeof parsed.enrolled === "boolean" &&
      typeof parsed.minHz === "number" &&
      typeof parsed.maxHz === "number" &&
      Array.isArray(parsed.hzSamples)
    ) {
      return {
        enrolled: parsed.enrolled,
        sampleCount: Number(parsed.sampleCount || parsed.hzSamples.length),
        meanHz: Number(parsed.meanHz || 0),
        minHz: parsed.minHz,
        maxHz: parsed.maxHz,
        meanRms: Number(parsed.meanRms || 0.02),
        hzSamples: parsed.hzSamples.filter((n): n is number => typeof n === "number"),
      };
    }
  } catch {
    // ignore storage errors
  }
  return createEmptyVoiceProfile();
}

export function saveVoiceProfile(profile: VoiceProfile): void {
  try {
    localStorage.setItem(VOICE_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage errors
  }
}

export function loadVoiceThresholds(): VoiceThresholdSettings {
  try {
    const raw = localStorage.getItem(VOICE_THRESHOLDS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_THRESHOLDS };
    const parsed = JSON.parse(raw) as Partial<VoiceThresholdSettings>;
    return clampVoiceThresholds(parsed);
  } catch {
    return { ...DEFAULT_VOICE_THRESHOLDS };
  }
}

export function saveVoiceThresholds(settings: VoiceThresholdSettings): VoiceThresholdSettings {
  const clamped = clampVoiceThresholds(settings);
  try {
    localStorage.setItem(VOICE_THRESHOLDS_STORAGE_KEY, JSON.stringify(clamped));
  } catch {
    // ignore storage errors
  }
  return clamped;
}

export function notifyVoiceSettingsUpdated(
  profile: VoiceProfile,
  thresholds: VoiceThresholdSettings
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(VOICE_SETTINGS_UPDATED_EVENT, {
      detail: { profile, thresholds },
    })
  );
}
