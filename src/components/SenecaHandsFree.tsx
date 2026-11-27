import { useEffect, useRef } from "react";
import {
  SENECA_VOICE_NAME,
  SenecaStudySnapshot,
  SpeakerGateState,
  VoiceProfile,
  VoiceThresholdSettings,
  analyzeVoiceFrame,
  createEmptyVoiceProfile,
  detectVoiceCalibrationCommand,
  detectVoiceStateTransition,
  evaluateSpeakerGate,
  float32ToInt16Bytes,
  int16BytesToFloat32,
  rmsToDb,
  updateVoiceProfile,
} from "../lib/aiLogic";
import {
  VOICE_CALIBRATION_BUSY_EVENT,
  VOICE_MIC_FRAME_EVENT,
  VOICE_OPEN_CALIBRATION_EVENT,
  VOICE_SETTINGS_UPDATED_EVENT,
  loadVoiceProfile,
  loadVoiceThresholds,
  notifyVoiceSettingsUpdated,
  saveVoiceProfile,
  saveVoiceThresholds,
} from "../lib/voiceSettings";

declare global {
  interface Window {
    __senecaApi?: {
      getStudySnapshot: () => SenecaStudySnapshot;
      getStateOverview?: () => Record<string, unknown>;
      getChapters: () => Array<{ id: string; name: string; subject: string; label: string }>;
      executeAppCommand?: (
        name: string,
        args?: Record<string, unknown>
      ) => Record<string, unknown>;
      saveQuestionToLog: (entry: {
        chapterId: string;
        source?: string;
        question?: string;
        optA?: string;
        optB?: string;
        optC?: string;
        optD?: string;
        correct?: string;
        takeaway?: string;
        imageBase64?: string;
      }) => Promise<string>;
      toast: (msg: string) => void;
    };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const SILENCE_PCM_B64 = bytesToBase64(new Uint8Array(1024 * 2));

export default function SenecaHandsFree() {
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const quietModeRef = useRef<boolean>(false);
  const inputBufRef = useRef<string>("");
  const startedRef = useRef<boolean>(false);
  const startingRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);
  const micDeniedRef = useRef<boolean>(false);
  const cleaningRef = useRef<boolean>(false);
  const fatalErrorRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const voiceProfileRef = useRef<VoiceProfile>(loadVoiceProfile());
  const thresholdsRef = useRef<VoiceThresholdSettings>(loadVoiceThresholds());
  const calibrationBusyRef = useRef<boolean>(false);
  const gateStateRef = useRef<SpeakerGateState>({ hangoverFrames: 0, mismatchStreak: 0 });
  const trailingSilenceRef = useRef<number>(0);
  const preRollRef = useRef<Float32Array[]>([]);
  const wasForwardingRef = useRef<boolean>(false);

  useEffect(() => {
    mountedRef.current = true;

    const stopPlayback = () => {
      for (const src of activeSourcesRef.current) {
        try {
          src.stop();
        } catch {
          // ignore
        }
      }
      activeSourcesRef.current.clear();
      nextStartTimeRef.current = 0;
    };

    const cleanupWsOnly = () => {
      stopPlayback();
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      startedRef.current = false;
      wasForwardingRef.current = false;
      trailingSilenceRef.current = 0;
      preRollRef.current = [];
    };

    const cleanupSession = () => {
      if (cleaningRef.current) return;
      cleaningRef.current = true;
      try {
        cleanupWsOnly();
        if (processorRef.current) {
          try {
            processorRef.current.disconnect();
          } catch {
            // ignore
          }
          processorRef.current.onaudioprocess = null;
          processorRef.current = null;
        }
        if (mediaStreamRef.current) {
          for (const t of mediaStreamRef.current.getTracks()) {
            t.onended = null;
            t.stop();
          }
          mediaStreamRef.current = null;
        }
        if (inputCtxRef.current) {
          inputCtxRef.current.close().catch(() => undefined);
          inputCtxRef.current = null;
        }
        if (outputCtxRef.current) {
          outputCtxRef.current.close().catch(() => undefined);
          outputCtxRef.current = null;
        }
      } finally {
        cleaningRef.current = false;
      }
    };

    const setQuiet = (nextQuiet: boolean, announce = true) => {
      if (quietModeRef.current === nextQuiet) return;
      quietModeRef.current = nextQuiet;
      if (nextQuiet) {
        stopPlayback();
        if (announce) {
          window.__senecaApi?.toast("Seneca standing by quietly — say 'Seneca' or 'speak' anytime.");
        }
      } else if (announce) {
        window.__senecaApi?.toast("Seneca listening.");
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "quietState", quiet: nextQuiet }));
      }
    };

    const schedulePcmAudio = (base64Pcm: string) => {
      if (quietModeRef.current) return;
      const outCtx = outputCtxRef.current;
      if (!outCtx) return;
      if (outCtx.state === "suspended") {
        void outCtx.resume();
      }
      const bytes = base64ToBytes(base64Pcm);
      const float32 = int16BytesToFloat32(bytes);
      if (!float32.length) return;

      const buffer = outCtx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = outCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(outCtx.destination);

      const startAt = Math.max(outCtx.currentTime, nextStartTimeRef.current);
      source.start(startAt);
      nextStartTimeRef.current = startAt + buffer.duration;

      activeSourcesRef.current.add(source);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };
    };

    const scheduleReconnect = (minDelayMs = 1200) => {
      if (!mountedRef.current || micDeniedRef.current || fatalErrorRef.current) return;
      reconnectAttemptsRef.current += 1;
      const delay = Math.min(
        15000,
        Math.max(minDelayMs, Math.round(1400 * Math.pow(1.6, Math.min(reconnectAttemptsRef.current - 1, 5))))
      );
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void startHandsFree();
      }, delay);
    };

    const ensureAudioPipeline = async (): Promise<{ stream: MediaStream; inCtx: AudioContext }> => {
      let stream = mediaStreamRef.current;
      const hasLiveTrack =
        Boolean(stream) &&
        stream!.getAudioTracks().some((t) => t.readyState === "live" && t.enabled);

      if (!hasLiveTrack) {
        if (stream) {
          for (const t of stream.getTracks()) {
            t.onended = null;
            t.stop();
          }
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!mountedRef.current) {
          for (const t of stream.getTracks()) t.stop();
          throw new Error("Unmounted");
        }
        mediaStreamRef.current = stream;
        for (const t of stream.getAudioTracks()) {
          t.onended = () => {
            if (!mountedRef.current) return;
            cleanupSession();
            scheduleReconnect(1000);
          };
        }
      }

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!inputCtxRef.current || inputCtxRef.current.state === "closed") {
        inputCtxRef.current = new AudioCtx({ sampleRate: 16000 });
        processorRef.current = null;
      }
      if (!outputCtxRef.current || outputCtxRef.current.state === "closed") {
        outputCtxRef.current = new AudioCtx({ sampleRate: 24000 });
        nextStartTimeRef.current = 0;
      }

      const inCtx = inputCtxRef.current;
      const outCtx = outputCtxRef.current;
      if (inCtx.state === "suspended") {
        inCtx.resume().catch(() => undefined);
      }
      if (outCtx.state === "suspended") {
        outCtx.resume().catch(() => undefined);
      }

      if (!processorRef.current) {
        const micSource = inCtx.createMediaStreamSource(stream!);
        const processor = inCtx.createScriptProcessor(1024, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (audioEvent) => {
          const samples = audioEvent.inputBuffer.getChannelData(0);
          const frameCopy = new Float32Array(samples);
          const analysis = analyzeVoiceFrame(frameCopy, inCtx.sampleRate || 16000);

          if (
            activeSourcesRef.current.size === 0 &&
            !calibrationBusyRef.current &&
            thresholdsRef.current.autoTrackRange
          ) {
            const updated = updateVoiceProfile(voiceProfileRef.current, analysis);
            if (updated.profile !== voiceProfileRef.current) {
              voiceProfileRef.current = updated.profile;
              saveVoiceProfile(updated.profile);
              if (updated.profile.enrolled) {
                thresholdsRef.current = saveVoiceThresholds({
                  ...thresholdsRef.current,
                  minHz: updated.profile.minHz,
                  maxHz: updated.profile.maxHz,
                });
              }
              notifyVoiceSettingsUpdated(voiceProfileRef.current, thresholdsRef.current);
              if (updated.justEnrolled) {
                window.__senecaApi?.toast("Seneca calibrated to your voice.");
              }
            }
          }

          const gate = evaluateSpeakerGate(
            gateStateRef.current,
            analysis,
            voiceProfileRef.current,
            thresholdsRef.current
          );
          gateStateRef.current = gate.nextState;

          window.dispatchEvent(
            new CustomEvent(VOICE_MIC_FRAME_EVENT, {
              detail: {
                frame: analysis,
                db: rmsToDb(analysis.rms),
                allow: gate.allow,
                reason: gate.reason,
                source: "handsfree",
              },
            })
          );

          const activeWs = wsRef.current;
          if (!activeWs || activeWs.readyState !== WebSocket.OPEN || !startedRef.current) {
            return;
          }

          if (calibrationBusyRef.current) {
            wasForwardingRef.current = false;
            preRollRef.current = [];
            return;
          }

          if (gate.allow) {
            if (!wasForwardingRef.current) {
              for (const preFrame of preRollRef.current) {
                const preBytes = float32ToInt16Bytes(preFrame);
                activeWs.send(JSON.stringify({ audio: bytesToBase64(preBytes) }));
              }
              preRollRef.current = [];
              wasForwardingRef.current = true;
            }
            trailingSilenceRef.current = 10;
            const pcmBytes = float32ToInt16Bytes(frameCopy);
            activeWs.send(JSON.stringify({ audio: bytesToBase64(pcmBytes) }));
          } else {
            wasForwardingRef.current = false;
            if (trailingSilenceRef.current > 0) {
              trailingSilenceRef.current -= 1;
              activeWs.send(JSON.stringify({ audio: SILENCE_PCM_B64 }));
            }
            if (gate.reason === "wrong_speaker" || gate.reason === "noise") {
              preRollRef.current = [];
            } else {
              preRollRef.current.push(frameCopy);
              if (preRollRef.current.length > 4) {
                preRollRef.current.shift();
              }
            }
          }
        };

        micSource.connect(processor);
        const zeroGain = inCtx.createGain();
        zeroGain.gain.value = 0;
        processor.connect(zeroGain);
        zeroGain.connect(inCtx.destination);
      }

      return { stream: stream!, inCtx };
    };

    const startHandsFree = async () => {
      if (
        !mountedRef.current ||
        startedRef.current ||
        startingRef.current ||
        micDeniedRef.current ||
        fatalErrorRef.current
      ) {
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      startingRef.current = true;

      try {
        await ensureAudioPipeline();
        if (!mountedRef.current) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${window.location.host}/live`);
        wsRef.current = ws;

        ws.onopen = () => {
          const snap = window.__senecaApi?.getStudySnapshot() ?? null;
          ws.send(
            JSON.stringify({
              type: "init",
              studyContext: snap,
              voiceName: SENECA_VOICE_NAME,
            })
          );
          if (quietModeRef.current) {
            ws.send(JSON.stringify({ type: "quietState", quiet: true }));
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data || "{}")) as {
              ready?: boolean;
              audio?: string;
              inputTranscript?: string;
              outputTranscript?: string;
              interrupted?: boolean;
              turnComplete?: boolean;
              quietMode?: boolean;
              closed?: boolean;
              error?: string;
              toolCalls?: Array<{
                id?: string;
                name?: string;
                args?: Record<string, unknown>;
              }>;
            };

            if (msg.error) {
              if (/API_KEY|PERMISSION_DENIED|404|NOT_FOUND/i.test(msg.error)) {
                fatalErrorRef.current = true;
              }
              window.__senecaApi?.toast(msg.error);
              if (!startedRef.current && !fatalErrorRef.current) {
                cleanupWsOnly();
                scheduleReconnect(/429|quota/i.test(msg.error) ? 8000 : 2500);
              }
              return;
            }

            if (msg.closed) {
              cleanupWsOnly();
              scheduleReconnect(1000);
              return;
            }

            if (typeof msg.quietMode === "boolean") {
              setQuiet(msg.quietMode, true);
            }

            if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
              const functionResponses = msg.toolCalls.map((call) => {
                const name = call.name || "";
                const args = call.args || {};
                let response: Record<string, unknown>;
                try {
                  if (name === "openVoiceCalibration") {
                    const open = args.open !== false;
                    window.dispatchEvent(
                      new CustomEvent(VOICE_OPEN_CALIBRATION_EVENT, { detail: { open } })
                    );
                    response = { ok: true, open };
                  } else if (window.__senecaApi?.executeAppCommand) {
                    response = window.__senecaApi.executeAppCommand(name, args);
                  } else {
                    response = { ok: false, error: "Seneca engine not initialized yet." };
                  }
                } catch (err) {
                  response = {
                    ok: false,
                    error: err instanceof Error ? err.message : "Command failed.",
                  };
                }
                return { id: call.id, name, response };
              });
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "toolResponse", functionResponses }));
              }
              return;
            }

            if (msg.ready) {
              startedRef.current = true;
              reconnectAttemptsRef.current = 0;
              return;
            }

            if (msg.interrupted) {
              stopPlayback();
            }

            if (msg.inputTranscript) {
              inputBufRef.current = (inputBufRef.current + " " + msg.inputTranscript).slice(-320);

              if (detectVoiceCalibrationCommand(inputBufRef.current) === "reset_profile") {
                inputBufRef.current = "";
                voiceProfileRef.current = createEmptyVoiceProfile();
                gateStateRef.current = { hangoverFrames: 0, mismatchStreak: 0 };
                saveVoiceProfile(voiceProfileRef.current);
                notifyVoiceSettingsUpdated(voiceProfileRef.current, thresholdsRef.current);
                window.__senecaApi?.toast("Voice lock reset — speak normally to recalibrate.");
              }

              const trans = detectVoiceStateTransition(
                inputBufRef.current,
                quietModeRef.current
              );
              if (trans === "quiet") {
                inputBufRef.current = "";
                setQuiet(true, true);
              } else if (trans === "wake") {
                inputBufRef.current = "";
                setQuiet(false, true);
              }
            }

            if (msg.turnComplete) {
              inputBufRef.current = "";
            }

            if (msg.audio && !quietModeRef.current) {
              schedulePcmAudio(msg.audio);
            }
          } catch {
            // ignore malformed payload
          }
        };

        ws.onclose = () => {
          cleanupWsOnly();
          scheduleReconnect(1500);
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          micDeniedRef.current = true;
        }
        cleanupSession();
        if (!micDeniedRef.current && !fatalErrorRef.current) {
          scheduleReconnect(3000);
        }
      } finally {
        startingRef.current = false;
      }
    };

    const onUserGesture = () => {
      if (inputCtxRef.current?.state === "suspended") {
        void inputCtxRef.current.resume();
      }
      if (outputCtxRef.current?.state === "suspended") {
        void outputCtxRef.current.resume();
      }
      if (
        !startedRef.current &&
        !startingRef.current &&
        !wsRef.current &&
        !micDeniedRef.current &&
        !fatalErrorRef.current
      ) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        void startHandsFree();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onUserGesture();
      }
    };

    const onSettingsUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ profile?: VoiceProfile; thresholds?: VoiceThresholdSettings }>).detail;
      if (detail?.profile) voiceProfileRef.current = detail.profile;
      else voiceProfileRef.current = loadVoiceProfile();
      if (detail?.thresholds) thresholdsRef.current = detail.thresholds;
      else thresholdsRef.current = loadVoiceThresholds();
      gateStateRef.current = { hangoverFrames: 0, mismatchStreak: 0, onsetStreak: 0 };
    };

    const onCalibrationBusy = (e: Event) => {
      const detail = (e as CustomEvent<{ busy?: boolean }>).detail;
      calibrationBusyRef.current = Boolean(detail?.busy);
    };

    const bootTimer = setTimeout(() => {
      void startHandsFree();
    }, 350);

    window.addEventListener("pointerdown", onUserGesture, { capture: true, passive: true });
    window.addEventListener("keydown", onUserGesture, { capture: true, passive: true });
    window.addEventListener("touchstart", onUserGesture, { capture: true, passive: true });
    window.addEventListener(VOICE_SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    window.addEventListener(VOICE_CALIBRATION_BUSY_EVENT, onCalibrationBusy);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      clearTimeout(bootTimer);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      window.removeEventListener("pointerdown", onUserGesture, { capture: true });
      window.removeEventListener("keydown", onUserGesture, { capture: true });
      window.removeEventListener("touchstart", onUserGesture, { capture: true });
      window.removeEventListener(VOICE_SETTINGS_UPDATED_EVENT, onSettingsUpdated);
      window.removeEventListener(VOICE_CALIBRATION_BUSY_EVENT, onCalibrationBusy);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cleanupSession();
    };
  }, []);

  return null;
}
