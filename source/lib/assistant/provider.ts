// Minimal OpenAI-compatible Chat Completions client.
// Usage is written to the existing `ai_usage` ledger so the AI Tokens Usage
// screen shows assistant traffic next to the other AI operations.

import { putRecord } from "@/lib/ai-service";
import type { AssistantConfig } from "./config";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type Completion = { content: string; toolCalls: ToolCall[]; model: string };

type RawToolCall = { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
type ProviderResponse = {
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  choices?: { message?: { content?: unknown; tool_calls?: unknown } }[];
};

export class AssistantError extends Error {
  constructor(message: string, public status = 503, public providerStatus?: number) {
    super(message);
  }
}

// Models differ in which request settings they accept. Newer OpenAI reasoning
// models, for example, reject `max_tokens` and custom `temperature`. When an
// endpoint reports an unsupported setting, the request is adjusted, retried and
// the adjustment remembered for that model.
type Quirks = { completionTokens: boolean; temperature: boolean; reasoning: boolean };
const DEFAULT_QUIRKS: Quirks = { completionTokens: false, temperature: true, reasoning: true };
const learned = new Map<string, Quirks>();

async function unsupportedParam(response: Response): Promise<string | null> {
  try {
    const j = (await response.json()) as { error?: { param?: unknown; code?: unknown; message?: unknown } };
    const e = j?.error;
    if (!e) return null;
    if (typeof e.param === "string" && /unsupported/.test(String(e.code ?? e.message))) return e.param;
    const m = String(e.message ?? "");
    for (const p of ["max_tokens", "temperature", "reasoning_effort"]) if (m.includes(`'${p}'`) && /unsupported|not supported/i.test(m)) return p;
  } catch {
    /* not JSON */
  }
  return null;
}

export async function complete(
  cfg: AssistantConfig,
  owner: string,
  messages: ChatMessage[],
  tools?: readonly unknown[],
): Promise<Completion> {
  const id = crypto.randomUUID();
  const started = Date.now();
  const ledger = (body: Record<string, unknown>) =>
    putRecord(owner, "ai_usage", id, { id, operation: "Assistant chat", model: cfg.modelLabel, at: new Date().toISOString(), ...body }).catch(() => {});
  const key = `${cfg.baseUrl}|${cfg.model}`;
  const quirks = learned.get(key) || { ...DEFAULT_QUIRKS };
  let response: Response | undefined;
  // Up to 3 extra attempts, each fixing one setting the model reported as unsupported.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(cfg.timeoutMs),
        body: JSON.stringify({
          model: cfg.model,
          messages,
          ...(quirks.temperature ? { temperature: cfg.temperature } : {}),
          ...(quirks.completionTokens ? { max_completion_tokens: cfg.maxTokens } : { max_tokens: cfg.maxTokens }),
          ...(cfg.reasoningEffort && quirks.reasoning ? { reasoning_effort: cfg.reasoningEffort } : {}),
          // Only widely supported fields, so the same request works on hosted and self-hosted servers.
          ...(tools ? { tools, tool_choice: "auto" } : {}),
        }),
      });
    } catch {
      await ledger({ status: "failed / usage unknown", input: 0, output: 0, total: 0, ms: Date.now() - started });
      throw new AssistantError("The AI model did not respond in time or could not be reached.");
    }
    if (response.status !== 400) break;
    const param = await unsupportedParam(response.clone());
    if (param === "max_tokens" && !quirks.completionTokens) quirks.completionTokens = true;
    else if (param === "temperature" && quirks.temperature) quirks.temperature = false;
    else if (param === "reasoning_effort" && quirks.reasoning) quirks.reasoning = false;
    else break;
    learned.set(key, quirks);
  }
  if (!response) throw new AssistantError("The AI model could not be reached.");
  if (!response.ok) {
    await ledger({ status: "failed / usage unknown", input: 0, output: 0, total: 0, ms: Date.now() - started });
    const s = response.status;
    throw new AssistantError(
      s === 401 || s === 403
        ? "The AI model rejected the API key. Check OPENAI_API_KEY (or AI_API_KEY)."
        : s === 404
          ? "The AI model or endpoint was not found. Check AI_BASE_URL and AI_MODEL."
          : s === 429
            ? "The AI model is rate limited or out of quota. Retry shortly."
            : "The AI model could not process this request.",
      s === 429 ? 429 : 502,
      s,
    );
  }
  let j: ProviderResponse;
  try {
    j = (await response.json()) as ProviderResponse;
  } catch {
    await ledger({ status: "failed / usage unknown", input: 0, output: 0, total: 0, ms: Date.now() - started });
    throw new AssistantError("The AI model returned an unreadable response.", 502);
  }
  const u = j?.usage;
  await ledger({
    model: typeof j?.model === "string" ? j.model.slice(0, 80) : cfg.modelLabel,
    status: u ? "reported" : "usage unavailable",
    input: Number(u?.prompt_tokens) || 0,
    output: Number(u?.completion_tokens) || 0,
    total: Number(u?.total_tokens) || (Number(u?.prompt_tokens) || 0) + (Number(u?.completion_tokens) || 0),
    ms: Date.now() - started,
  });
  const message = j?.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = Array.isArray(message.tool_calls)
    ? (message.tool_calls as RawToolCall[])
        .filter((c): c is RawToolCall & { function: { name: unknown } } => !!c?.function?.name)
        .map((c, i) => ({
          id: String(c.id || `call_${i}`),
          type: "function" as const,
          function: {
            name: String(c.function.name),
            arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}),
          },
        }))
    : [];
  return { content: typeof message.content === "string" ? message.content : "", toolCalls, model: String(j?.model || cfg.model) };
}
