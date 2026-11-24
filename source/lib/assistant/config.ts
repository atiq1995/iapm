// Assistant identity and model connection.
//
// The assistant talks to any endpoint that implements the OpenAI-compatible
// Chat Completions API (`POST {AI_BASE_URL}/chat/completions`). That covers
// OpenAI, Azure-style gateways, vLLM, Ollama, LM Studio, llama.cpp server,
// Groq, Together, OpenRouter and the OpenAI-compatible endpoints offered by
// Google and Anthropic. Everything is configured with server-side environment
// variables; nothing here is ever sent to the browser except the public status.

export const DEFAULT_ASSISTANT_NAME = "Relia";

export type ToolMode = "native" | "json" | "auto";

export type AssistantConfig = {
  name: string;
  connected: boolean;
  baseUrl: string;
  model: string;
  modelLabel: string;
  apiKey?: string;
  toolMode: ToolMode;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  answerWords: number;
  reasoningEffort?: string;
};

export type AssistantStatus = {
  name: string;
  connected: boolean;
  modelLabel: string | null;
  endpointHost: string | null;
  readOnly: true;
  engine: "model" | "guided";
  message: string;
};

function clamp(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!value || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanName(value: string | undefined) {
  const name = (value || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
  return name || DEFAULT_ASSISTANT_NAME;
}

function validBaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null; // credentials belong in AI_API_KEY
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function assistantConfig(env: Record<string, string | undefined> = process.env): AssistantConfig {
  const name = cleanName(env.AI_ASSISTANT_NAME);
  // Preferred: AI_BASE_URL + AI_MODEL (+ AI_API_KEY when the endpoint needs one).
  // Fallback: an existing OPENAI_API_KEY + OPENAI_MODEL pair keeps working.
  let baseUrl = env.AI_BASE_URL?.trim() || "";
  let model = env.AI_MODEL?.trim() || "";
  let apiKey = env.AI_API_KEY?.trim() || undefined;
  if (!model && env.OPENAI_API_KEY && env.OPENAI_MODEL) {
    baseUrl = baseUrl || "https://api.openai.com/v1";
    model = env.OPENAI_MODEL.trim();
    apiKey = apiKey || env.OPENAI_API_KEY.trim();
  }
  if (model && !baseUrl) baseUrl = "https://api.openai.com/v1";
  const url = baseUrl ? validBaseUrl(baseUrl) : null;
  // One key location for OpenAI: reuse OPENAI_API_KEY when the endpoint is OpenAI.
  if (!apiKey && url && new URL(url).host === "api.openai.com") apiKey = env.OPENAI_API_KEY?.trim() || undefined;
  const effort = env.AI_REASONING_EFFORT?.trim().toLowerCase();
  const mode = env.AI_TOOL_MODE?.trim().toLowerCase();
  return {
    name,
    connected: !!(url && model),
    baseUrl: url || "",
    model,
    modelLabel: (env.AI_MODEL_LABEL || "").trim().slice(0, 60) || model,
    apiKey,
    toolMode: mode === "native" || mode === "json" ? mode : "auto",
    temperature: clamp(env.AI_TEMPERATURE, 0.1, 0, 1),
    maxTokens: Math.round(clamp(env.AI_MAX_TOKENS, 1200, 200, 4000)),
    // Per model call. The API route itself is capped at 60 s (maxDuration).
    timeoutMs: Math.round(clamp(env.AI_TIMEOUT_MS, 30000, 5000, 55000)),
    // Target answer length in words (instruction to the model).
    answerWords: Math.round(clamp(env.AI_ANSWER_WORDS, 120, 40, 400)),
    // Optional, for reasoning models (e.g. minimal | low). Dropped automatically if unsupported.
    reasoningEffort: effort && /^[a-z]{2,12}$/.test(effort) ? effort : undefined,
  };
}

export function publicStatus(cfg: AssistantConfig): AssistantStatus {
  let host: string | null = null;
  if (cfg.connected) {
    try {
      host = new URL(cfg.baseUrl).host;
    } catch {
      host = null;
    }
  }
  return {
    name: cfg.name,
    connected: cfg.connected,
    modelLabel: cfg.connected ? cfg.modelLabel : null,
    endpointHost: host,
    readOnly: true,
    engine: cfg.connected ? "model" : "guided",
    message: cfg.connected
      ? `${cfg.name} is connected to ${cfg.modelLabel}. Answers use read-only database tools and the iAPM calculation engine.`
      : `No language model is attached. ${cfg.name} answers with the guided query engine: same read-only data and calculations, fewer question types.`,
  };
}
