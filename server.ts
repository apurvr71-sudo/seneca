import "dotenv/config";
import http from "node:http";
import path from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import {
  EndSensitivity,
  FunctionDeclaration,
  LiveServerMessage,
  Modality,
  StartSensitivity,
  Type,
} from "@google/genai";
import {
  ALLOWED_TEXT_MODELS,
  AiMode,
  IMAGE_ANALYSIS_MODEL,
  LIVE_VOICE_MODEL,
  SENECA_VOICE_NAME,
  SenecaStudySnapshot,
  TTS_MODEL,
  buildGenerateRequestSpec,
  buildSenecaAlfredInstruction,
  detectVoiceStateTransition,
  extractGroundingSources,
  formatSenecaStudyContext,
  isAllowedImageMimeType,
  parseExtractedQuestion,
} from "./src/lib/aiLogic.ts";
import { formatGeminiError, getGeminiClient, withRetry } from "./src/lib/gemini.ts";

const ALLOWED_VOICES = new Set(["Puck", "Charon", "Kore", "Fenrir", "Zephyr"]);
let preferAlphaLive = false;

const SENECA_LIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: "setQuietMode",
    description:
      "Put Seneca into silent standby when the user asks to be quiet, hush, mute, or stand down, or resume speaking when addressed as Seneca or told to speak/wake up.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        quiet: {
          type: Type.BOOLEAN,
          description: "true to go completely silent; false to resume speaking.",
        },
      },
      required: ["quiet"],
    },
  },
  {
    name: "getStudyStatus",
    description:
      "Inspect full live study tracker state: today's plan items, timer status, syllabus progress, overdue revisits, tests, active view, theme, and daily goal.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "navigateView",
    description: "Switch between main views in Seneca: Home ('plan'), Schedule ('schedule'), Syllabus ('tracker'), or Tests ('test').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        view: {
          type: Type.STRING,
          description: "Target view: 'plan' (or 'home'), 'schedule', 'tracker' (or 'syllabus'), or 'test'.",
        },
      },
      required: ["view"],
    },
  },
  {
    name: "setTheme",
    description: "Switch Seneca's visual theme between Light ('light'), Dark ('dark'), and Alternate Stoic ('stoic').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        theme: {
          type: Type.STRING,
          description: "'light', 'dark', or 'stoic' (alternate).",
        },
      },
      required: ["theme"],
    },
  },
  {
    name: "switchSubject",
    description: "Switch active subject tab in Syllabus tracker: botany, zoology, chemistry, or physics.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: { type: Type.STRING, description: "botany, zoology, chemistry, or physics." },
        openTracker: { type: Type.BOOLEAN, description: "Whether to open Syllabus view if not already there (default true)." },
      },
      required: ["subject"],
    },
  },
  {
    name: "searchOrFilterChapters",
    description: "Search chapters by name and/or filter Syllabus chapters by status ('all', 'todo', 'part', 'done', 'due').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: { type: Type.STRING, description: "Optional subject: botany, zoology, chemistry, or physics." },
        filter: { type: Type.STRING, description: "Optional status filter: all, todo, part, done, or due." },
        search: { type: Type.STRING, description: "Chapter search text (empty string clears search)." },
      },
    },
  },
  {
    name: "planAndScheduleDay",
    description: "Plan the user's day using Seneca's proposed routine and place chapters into today's study blocks.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "manageTodayPlan",
    description: "Add a chapter to today's plan, remove one, carry unfinished tasks to tomorrow, or clear today's plan.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'add', 'remove', 'carry_to_tomorrow', or 'clear'." },
        chapterQuery: { type: Type.STRING, description: "Chapter name or partial name (for add/remove)." },
        subject: { type: Type.STRING, description: "Optional subject hint: botany, zoology, chemistry, or physics." },
        source: { type: Type.STRING, description: "Optional resource name (e.g. NCERT, MODULE, RACE, HCV, JM)." },
        scheduleNow: { type: Type.BOOLEAN, description: "When adding, whether to immediately place into a free block." },
      },
      required: ["action"],
    },
  },
  {
    name: "manageSchedule",
    description: "Control Schedule view mode ('blocks' Queue vs 'manual' Calendar), Today vs Tomorrow day view, T1/T2 timetable mode, log Woke Up Now, Auto-fill, or Replan.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "'set_view', 'set_day', 'set_timetable', 'woke_now', 'auto_fill', or 'replan'.",
        },
        scheduleView: { type: Type.STRING, description: "For set_view: 'blocks' (Queue) or 'manual'." },
        day: { type: Type.STRING, description: "For set_day: 'today' or 'tomorrow'." },
        timetable: { type: Type.STRING, description: "For set_timetable: 'home' (T1) or 'class' (Coaching day / T2)." },
      },
      required: ["action"],
    },
  },
  {
    name: "controlFocusTimer",
    description: "Start, pause, reset, or mark complete the active focus block timer (optionally switching focus to a specific chapter).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'start', 'pause', 'reset', or 'complete'." },
        chapterQuery: { type: Type.STRING, description: "Optional chapter name to focus the timer on." },
        subject: { type: Type.STRING, description: "Optional subject hint." },
        source: { type: Type.STRING, description: "Optional source hint." },
      },
      required: ["action"],
    },
  },
  {
    name: "updateChapterProgress",
    description: "Tick/untick a chapter's source or log an NCERT re-read.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'tick', 'untick', 'toggle', 'add_read', or 'remove_read'." },
        chapterQuery: { type: Type.STRING, description: "Chapter name or ID." },
        subject: { type: Type.STRING, description: "Optional subject hint." },
        source: { type: Type.STRING, description: "Source name (NCERT, MODULE, RACE, HCV, etc.)." },
      },
      required: ["action", "chapterQuery"],
    },
  },
  {
    name: "toggleRevision",
    description: "Mark daily revision done/undone, open the Revision Queue modal, open the Question Log modal, or close log modals.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'mark_done', 'undo_done', 'toggle', 'open_queue', 'open_question_log', or 'close_modals'." },
        chapterQuery: { type: Type.STRING, description: "Optional chapter name when opening Question Log." },
        tab: { type: Type.STRING, description: "Optional Question Log tab: 'questions' or 'flashcards'." },
      },
      required: ["action"],
    },
  },
  {
    name: "manageTests",
    description: "List upcoming tests, create a new test, select an existing test, or auto-plan items for the selected test.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'list', 'create', 'select', or 'plan_for_test'." },
        name: { type: Type.STRING, description: "Test name (for create/select)." },
        date: { type: Type.STRING, description: "Test date YYYY-MM-DD (for create)." },
      },
      required: ["action"],
    },
  },
  {
    name: "adjustTargets",
    description: "Set or adjust daily study point target (or reset to deadline pace), and/or change syllabus deadline date.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dailyGoal: { type: Type.NUMBER, description: "Exact daily points target (1-60)." },
        delta: { type: Type.NUMBER, description: "Adjust current target by +N or -N points." },
        resetGoal: { type: Type.BOOLEAN, description: "Reset target to automatic deadline pace." },
        deadline: { type: Type.STRING, description: "New syllabus deadline date YYYY-MM-DD." },
      },
    },
  },
  {
    name: "openVoiceCalibration",
    description:
      "Open or close Seneca's microphone and voice calibration utility so the user can test and adjust volume sensitivity, vocal frequency range, and background noise rejection.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        open: {
          type: Type.BOOLEAN,
          description: "true to open the calibration utility, false to close it.",
        },
      },
      required: ["open"],
    },
  },
  {
    name: "webSearch",
    description: "Search the live web for NTA NEET UG syllabus updates, NCERT facts, exam dates, or scientific references.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Search query." },
      },
      required: ["query"],
    },
  },
];

function normalizeVoice(voice: unknown, fallback = SENECA_VOICE_NAME): string {
  const v = typeof voice === "string" ? voice.trim() : "";
  return ALLOWED_VOICES.has(v) ? v : fallback;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, hasKey: Boolean(process.env.GEMINI_API_KEY?.trim()) });
  });

  app.post("/api/gemini/ask", async (req, res) => {
    try {
      const { prompt, mode, studyContext, history } = req.body as {
        prompt?: unknown;
        mode?: unknown;
        studyContext?: SenecaStudySnapshot | null;
        history?: Array<{ role?: unknown; text?: unknown }>;
      };

      if (typeof prompt !== "string" || !prompt.trim()) {
        res.status(400).json({ error: "Please enter a question or prompt." });
        return;
      }
      if (prompt.length > 12000) {
        res.status(400).json({ error: "Prompt is too long (max 12,000 characters)." });
        return;
      }

      const validMode: AiMode =
        mode === "quick" || mode === "standard" || mode === "deep" || mode === "search"
          ? mode
          : "standard";

      const spec = buildGenerateRequestSpec({
        mode: validMode,
        prompt,
        studyContext: studyContext ?? null,
      });

      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
      if (Array.isArray(history)) {
        for (const turn of history.slice(-10)) {
          if (!turn || typeof turn.text !== "string" || !turn.text.trim()) continue;
          const role = turn.role === "model" ? "model" : "user";
          contents.push({ role, parts: [{ text: turn.text.slice(0, 6000) }] });
        }
      }
      contents.push({ role: "user", parts: [{ text: spec.contents }] });

      const ai = getGeminiClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: spec.model,
          contents,
          config: spec.config,
        })
      );

      const text = (response.text ?? "").trim();
      const sources =
        validMode === "search"
          ? extractGroundingSources(response.candidates?.[0]?.groundingMetadata?.groundingChunks)
          : [];

      res.json({
        text: text || "No response text was returned.",
        model: spec.model,
        mode: validMode,
        sources,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post("/api/gemini/analyze-image", async (req, res) => {
    try {
      const { imageBase64, mimeType, prompt, extractQuestion, studyContext } = req.body as {
        imageBase64?: unknown;
        mimeType?: unknown;
        prompt?: unknown;
        extractQuestion?: unknown;
        studyContext?: SenecaStudySnapshot | null;
      };

      if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
        res.status(400).json({ error: "No image data provided." });
        return;
      }

      let cleanBase64 = imageBase64.trim();
      let cleanMime = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "image/png";

      const dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/i);
      if (dataUrlMatch) {
        cleanMime = dataUrlMatch[1].toLowerCase();
        cleanBase64 = dataUrlMatch[2];
      }

      if (!isAllowedImageMimeType(cleanMime)) {
        res.status(400).json({ error: "Unsupported image format. Use PNG, JPEG, WEBP, or GIF." });
        return;
      }
      if (cleanBase64.length > 14_000_000) {
        res.status(400).json({ error: "Image is too large (max ~10 MB)." });
        return;
      }

      const ai = getGeminiClient();
      const imagePart = {
        inlineData: {
          mimeType: cleanMime,
          data: cleanBase64,
        },
      };

      const wantExtraction = Boolean(extractQuestion);
      const userPrompt =
        typeof prompt === "string" && prompt.trim()
          ? prompt.trim()
          : wantExtraction
            ? "Extract this NEET exam question, its four options (A-D), the correct option, a concise 1-sentence takeaway, and a clear explanation."
            : "Analyze this study image or NEET question in detail: solve it step-by-step, explain the underlying NCERT concept, and point out common traps.";

      if (wantExtraction) {
        const response = await withRetry(() =>
          ai.models.generateContent({
            model: IMAGE_ANALYSIS_MODEL,
            contents: {
              parts: [
                imagePart,
                {
                  text:
                    userPrompt +
                    "\nReturn JSON matching the schema. If options or question parts are missing, leave those strings empty and put your full analysis in explanation.",
                },
              ],
            },
            config: {
              systemInstruction:
                "You are an expert NEET (Physics, Chemistry, Biology) OCR & problem solver. Extract question text and options faithfully, and solve carefully.",
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING, description: "Full question stem." },
                  optA: { type: Type.STRING, description: "Option A / 1 text without prefix." },
                  optB: { type: Type.STRING, description: "Option B / 2 text without prefix." },
                  optC: { type: Type.STRING, description: "Option C / 3 text without prefix." },
                  optD: { type: Type.STRING, description: "Option D / 4 text without prefix." },
                  correct: { type: Type.STRING, description: "Correct letter: A, B, C, or D." },
                  takeaway: { type: Type.STRING, description: "Concise 1-sentence key concept takeaway." },
                  explanation: { type: Type.STRING, description: "Clear step-by-step NCERT-aligned solution." },
                  subjectGuess: {
                    type: Type.STRING,
                    description: "Likely subject: physics, chemistry, botany, or zoology.",
                  },
                },
              },
            },
          })
        );

        const raw = (response.text ?? "").trim();
        const extracted = parseExtractedQuestion(raw);
        res.json({
          model: IMAGE_ANALYSIS_MODEL,
          extracted,
          text: extracted.explanation || raw,
        });
        return;
      }

      const contextText = formatSenecaStudyContext(studyContext);
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: IMAGE_ANALYSIS_MODEL,
          contents: {
            parts: [imagePart, { text: userPrompt }],
          },
          config: {
            systemInstruction:
              "You are Seneca, an expert NEET 2027 tutor. Analyze the uploaded diagram, textbook snippet, or question photo clearly and accurately.\n\nStudent Snapshot:\n" +
              contextText,
          },
        })
      );

      res.json({
        model: IMAGE_ANALYSIS_MODEL,
        text: (response.text ?? "").trim() || "Could not extract an explanation from this image.",
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post("/api/gemini/tts", async (req, res) => {
    try {
      const { text, voiceName, style } = req.body as {
        text?: unknown;
        voiceName?: unknown;
        style?: unknown;
      };

      if (typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "No text provided for speech synthesis." });
        return;
      }

      const cleanText = text.trim().slice(0, 4000);
      const voice = normalizeVoice(voiceName, SENECA_VOICE_NAME);
      const speechStyle =
        typeof style === "string" && style.trim()
          ? style.trim().slice(0, 160)
          : "Mature English gentleman speaking Traditional British Conservative Received Pronunciation, warm medium-low resonant baritone with subtle chest gravel, non-rhotic articulation, calm natural rhythm";

      const ai = getGeminiClient();
      const response = await withRetry(async () => {
        try {
          return await ai.models.generateContent({
            model: TTS_MODEL,
            contents: [{ role: "user", parts: [{ text: `${speechStyle}: ${cleanText}` }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: voice },
                },
              },
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/speechConfig|speechMetadata/i.test(msg)) {
            const { GoogleGenAI } = await import("@google/genai");
            const alphaAi = new GoogleGenAI({
              apiKey: process.env.GEMINI_API_KEY,
              apiVersion: "v1alpha",
              httpOptions: { headers: { "User-Agent": "aistudio-build" } },
            });
            try {
              return await alphaAi.models.generateContent({
                model: TTS_MODEL,
                contents: [
                  {
                    role: "user",
                    parts: [{ text: cleanText, speechMetadata: { style: speechStyle } }],
                  },
                ],
                config: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voice },
                    },
                  },
                },
              });
            } catch {
              return await ai.models.generateContent({
                model: TTS_MODEL,
                contents: [{ role: "user", parts: [{ text: `${speechStyle}: ${cleanText}` }] }],
                config: {
                  responseModalities: ["AUDIO"],
                },
              });
            }
          }
          throw err;
        }
      });

      const audioBase64 =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioBase64) {
        res.status(502).json({ error: "Speech model did not return audio data." });
        return;
      }

      res.json({
        audioBase64,
        mimeType: "audio/wav",
        model: TTS_MODEL,
        voiceName: voice,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Live API WebSocket bridge (/live)
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = (req.url || "").split("?")[0];
    if (pathname === "/live") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (clientWs: WebSocket) => {
    let session: Awaited<ReturnType<ReturnType<typeof getGeminiClient>["live"]["connect"]>> | null = null;
    let closed = false;
    let connecting = false;
    let serverQuietMode = false;
    let inputTranscriptBuf = "";
    const pendingToolIds = new Map<
      string,
      {
        resolve: (res: Record<string, unknown>) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();

    const sendSafe = (payload: Record<string, unknown>) => {
      if (!closed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const resolvePendingTools = (
      responses: Array<{ id?: string; name?: string; response?: Record<string, unknown> }>
    ) => {
      for (const r of responses) {
        if (!r.id) continue;
        const entry = pendingToolIds.get(r.id);
        if (entry) {
          clearTimeout(entry.timer);
          pendingToolIds.delete(r.id);
          entry.resolve(r.response ?? { ok: true });
        }
      }
    };

    const waitClientToolCall = (call: { id?: string; name?: string; args?: Record<string, unknown> }) => {
      const id = call.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      return new Promise<Record<string, unknown>>((resolve) => {
        const timer = setTimeout(() => {
          pendingToolIds.delete(id);
          resolve({ ok: false, error: "Client command timed out." });
        }, 6000);
        pendingToolIds.set(id, { resolve, timer });
        sendSafe({
          toolCalls: [
            {
              id,
              name: call.name || "",
              args: call.args || {},
            },
          ],
        });
      });
    };

    const startLiveSession = async (
      studyContext?: SenecaStudySnapshot | null,
      voiceName?: string
    ) => {
      if (connecting || session || closed) return;
      connecting = true;
      try {
        const ai = getGeminiClient();
        const voice = normalizeVoice(voiceName, SENECA_VOICE_NAME);

        const connectWithClient = (client: ReturnType<typeof getGeminiClient>) =>
          new Promise<Awaited<ReturnType<typeof client.live.connect>>>((resolve, reject) => {
            let opened = false;
            let settled = false;
            let staleAttempt = false;
            let sRef: Awaited<ReturnType<typeof client.live.connect>> | null = null;
            client.live
              .connect({
                model: LIVE_VOICE_MODEL,
                config: {
                  responseModalities: [Modality.AUDIO],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voice },
                    },
                  },
                  inputAudioTranscription: {},
                  outputAudioTranscription: {},
                  realtimeInputConfig: {
                    automaticActivityDetection: {
                      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                      prefixPaddingMs: 220,
                      silenceDurationMs: 460,
                    },
                  },
                  tools: [{ functionDeclarations: SENECA_LIVE_TOOLS }],
                  systemInstruction: buildSenecaAlfredInstruction(studyContext),
                },
                callbacks: {
                  onopen: () => {
                    opened = true;
                    if (sRef && !settled) {
                      settled = true;
                      resolve(sRef);
                    }
                  },
                  onmessage: (message: LiveServerMessage) => {
                    if (staleAttempt) return;
                    const sc = message.serverContent;
                    if (sc?.inputTranscription?.text) {
                      const chunk = sc.inputTranscription.text;
                      inputTranscriptBuf = (inputTranscriptBuf + " " + chunk).slice(-320);
                      const trans = detectVoiceStateTransition(inputTranscriptBuf, serverQuietMode);
                      if (trans === "quiet") {
                        serverQuietMode = true;
                        inputTranscriptBuf = "";
                        sendSafe({ quietMode: true });
                      } else if (trans === "wake") {
                        serverQuietMode = false;
                        inputTranscriptBuf = "";
                        sendSafe({ quietMode: false });
                      }
                      sendSafe({ inputTranscript: chunk });
                    }

                    if (message.toolCall?.functionCalls?.length && session) {
                      const calls = message.toolCall.functionCalls;
                      void (async () => {
                        const functionResponses = await Promise.all(
                          calls.map(async (fc) => {
                            const id = fc.id || `tc_${Date.now()}`;
                            const name = fc.name || "";
                            const args = (fc.args || {}) as Record<string, unknown>;

                            if (name === "setQuietMode") {
                              serverQuietMode = Boolean(args.quiet);
                              sendSafe({ quietMode: serverQuietMode });
                              return {
                                id,
                                name,
                                response: { ok: true, quiet: serverQuietMode },
                              };
                            }

                            if (serverQuietMode) {
                              return {
                                id,
                                name,
                                response: {
                                  blocked: true,
                                  message: "Seneca is in quiet standby until addressed as Seneca or told to speak.",
                                },
                              };
                            }

                            if (name === "webSearch") {
                              try {
                                const query = String(args.query || "").trim();
                                const searchRes = await withRetry(() =>
                                  ai.models.generateContent({
                                    model: ALLOWED_TEXT_MODELS.search,
                                    contents: query || "Latest NEET UG updates",
                                    config: { tools: [{ googleSearch: {} }] },
                                  })
                                );
                                const sources = extractGroundingSources(
                                  searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks
                                );
                                return {
                                  id,
                                  name,
                                  response: {
                                    ok: true,
                                    summary: (searchRes.text ?? "").trim(),
                                    sources: sources.slice(0, 4),
                                  },
                                };
                              } catch (err) {
                                const fmt = formatGeminiError(err);
                                return { id, name, response: { ok: false, error: fmt.message } };
                              }
                            }

                            const clientResult = await waitClientToolCall({ id, name, args });
                            return { id, name, response: clientResult };
                          })
                        );

                        if (!closed && session) {
                          session.sendToolResponse({ functionResponses });
                        }
                      })();
                    }

                    if (sc?.outputTranscription?.text && !serverQuietMode) {
                      sendSafe({ outputTranscript: sc.outputTranscription.text });
                    }
                    for (const part of sc?.modelTurn?.parts ?? []) {
                      if (part.inlineData?.data && !serverQuietMode) {
                        sendSafe({ audio: part.inlineData.data });
                      }
                    }
                    if (sc?.interrupted) {
                      sendSafe({ interrupted: true });
                    }
                    if (sc?.turnComplete) {
                      inputTranscriptBuf = "";
                      sendSafe({ turnComplete: true });
                    }
                  },
                  onerror: (e: unknown) => {
                    console.error("[live] Gemini Live error:", e);
                    if (!opened && !settled) {
                      staleAttempt = true;
                      settled = true;
                      reject(e);
                      return;
                    }
                    if (staleAttempt) return;
                    const formatted = formatGeminiError(e);
                    sendSafe({ error: formatted.message });
                  },
                  onclose: (e: unknown) => {
                    const reason =
                      e && typeof e === "object" && "reason" in e ? String((e as { reason?: unknown }).reason || "") : "";
                    const code =
                      e && typeof e === "object" && "code" in e ? Number((e as { code?: unknown }).code || 0) : 0;
                    if (reason || (code && code !== 1000)) {
                      console.warn("[live] Gemini Live closed:", code, reason);
                    }
                    if (!opened && !settled) {
                      staleAttempt = true;
                      settled = true;
                      reject(new Error(reason || `Live connection closed (${code})`));
                      return;
                    }
                    if (staleAttempt) return;
                    session = null;
                    for (const entry of pendingToolIds.values()) {
                      clearTimeout(entry.timer);
                    }
                    pendingToolIds.clear();
                    sendSafe({ closed: true, code, reason });
                  },
                },
              })
              .then((liveSess) => {
                sRef = liveSess;
                if (opened && !settled) {
                  settled = true;
                  resolve(liveSess);
                }
              })
              .catch((err) => {
                if (!settled) {
                  staleAttempt = true;
                  settled = true;
                  reject(err);
                }
              });
          });

        let liveSession: Awaited<ReturnType<typeof ai.live.connect>>;
        const createAlphaClient = async () => {
          const { GoogleGenAI } = await import("@google/genai");
          return new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            apiVersion: "v1alpha",
            httpOptions: { headers: { "User-Agent": "aistudio-build" } },
          });
        };

        if (preferAlphaLive) {
          liveSession = await connectWithClient(await createAlphaClient());
        } else {
          try {
            liveSession = await connectWithClient(ai);
          } catch (firstErr) {
            const msg = formatGeminiError(firstErr).message;
            if (/404|NOT_FOUND/i.test(msg)) {
              preferAlphaLive = true;
              liveSession = await connectWithClient(await createAlphaClient());
            } else {
              throw firstErr;
            }
          }
        }

        if (closed) {
          liveSession.close();
          return;
        }
        session = liveSession;
        sendSafe({ ready: true, model: LIVE_VOICE_MODEL, voice });
      } catch (err) {
        const formatted = formatGeminiError(err);
        sendSafe({ error: formatted.message });
      } finally {
        connecting = false;
      }
    };

    clientWs.on("message", async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          audio?: string;
          text?: string;
          quiet?: boolean;
          studyContext?: SenecaStudySnapshot | null;
          voiceName?: string;
          functionResponses?: Array<{ id?: string; name?: string; response?: Record<string, unknown> }>;
        };

        if (msg.type === "init") {
          await startLiveSession(msg.studyContext, msg.voiceName);
          return;
        }

        if (msg.type === "quietState" && typeof msg.quiet === "boolean") {
          serverQuietMode = msg.quiet;
          return;
        }

        if (msg.type === "toolResponse" && Array.isArray(msg.functionResponses)) {
          resolvePendingTools(msg.functionResponses);
          return;
        }

        if (!session && !connecting) {
          await startLiveSession(msg.studyContext, msg.voiceName);
        }

        if (msg.audio && session) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (msg.text && session) {
          session.sendRealtimeInput({ text: msg.text });
        }
      } catch (err) {
        const formatted = formatGeminiError(err);
        sendSafe({ error: formatted.message });
      }
    });

    clientWs.on("close", () => {
      closed = true;
      for (const entry of pendingToolIds.values()) {
        clearTimeout(entry.timer);
      }
      pendingToolIds.clear();
      if (session) {
        try {
          session.close();
        } catch {
          // ignore close errors
        }
        session = null;
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`Seneca server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
