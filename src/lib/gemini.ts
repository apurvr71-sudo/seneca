import { GoogleGenAI } from "@google/genai";

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      "GEMINI_API_KEY is not configured. Please select or configure your API key in Settings > Secrets."
    ) as Error & { statusCode?: number };
    err.statusCode = 500;
    throw err;
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return cachedClient;
}

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number })?.status;
      const isTransient =
        status === 429 ||
        status === 500 ||
        status === 503 ||
        /RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|timeout/i.test(msg);
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delay = 400 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function extractErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "object") {
    const obj = err as {
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
    if (obj.error) {
      const nested = extractErrorMessage(obj.error);
      if (nested && nested !== "Unknown error") return nested;
    }
    if (typeof obj.reason === "string" && obj.reason.trim()) return obj.reason;
    try {
      const serialized = JSON.stringify(obj);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(err);
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const rawMsg = extractErrorMessage(err);
  const explicitStatus =
    (err as { statusCode?: number; status?: number })?.statusCode ||
    (err as { status?: number })?.status;

  if (/API_KEY_INVALID|PERMISSION_DENIED|403|401/i.test(rawMsg) || explicitStatus === 403 || explicitStatus === 401) {
    return {
      status: explicitStatus === 401 ? 401 : 403,
      message:
        "Gemini API access was denied or the API key is invalid. Please check your GEMINI_API_KEY in Settings > Secrets.",
    };
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(rawMsg) || explicitStatus === 429) {
    return {
      status: 429,
      message:
        "Gemini rate limit or quota reached. Please wait a moment and try again, or check your key in Settings > Secrets.",
    };
  }
  if (/NOT_FOUND|404/i.test(rawMsg) || explicitStatus === 404) {
    return {
      status: 404,
      message:
        rawMsg && rawMsg.length < 240
          ? rawMsg
          : "The requested Gemini model was not found or is currently unavailable.",
    };
  }
  if (/GEMINI_API_KEY/i.test(rawMsg)) {
    return { status: 500, message: rawMsg };
  }
  return {
    status: typeof explicitStatus === "number" && explicitStatus >= 400 && explicitStatus < 600 ? explicitStatus : 500,
    message: rawMsg || "Failed to process Gemini request.",
  };
}
