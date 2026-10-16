import { db } from "./auth";
import { runtime as appRuntime } from "./runtime";

export const MODELS = [
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
  { id: "gpt-6-sol", label: "GPT-6 Sol" },
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "gpt-5.4", label: "GPT-5.4" },
];

export const runtime = appRuntime;

export class AIError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}

export async function putRecord(owner: string, kind: string, id: string, body: unknown) {
  return db()
    .prepare(
      "INSERT INTO records(id,owner,kind,body,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated=excluded.updated",
    )
    .bind(`${owner}:${kind}:${id}`, owner, kind, JSON.stringify(body), Date.now())
    .run();
}

export async function readRecords(owner: string, kind: string) {
  const r = await db()
    .prepare(
      "SELECT body FROM records WHERE owner=? AND kind=? ORDER BY updated DESC LIMIT 2000",
    )
    .bind(owner, kind)
    .all<{ body: string }>();
  return r.results.map((x) => JSON.parse(x.body));
}

export async function modelStatus() {
  if (!runtime().OPENAI_API_KEY)
    return {
      connected: false,
      models: MODELS.map((m) => ({ ...m, available: false })),
      message:
        "OpenAI API connection required. No live tokens have been consumed.",
    };
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${runtime().OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error();
    const j: any = await r.json();
    const ids = new Set(j.data?.map((m: any) => m.id));
    return {
      connected: true,
      models: MODELS.map((m) => ({ ...m, available: ids.has(m.id) })),
      message:
        "Models verified against the connected API project. Request-specific permissions still apply.",
    };
  } catch {
    return {
      connected: false,
      models: MODELS.map((m) => ({ ...m, available: false })),
      message:
        "Unable to verify the API connection. Check project permissions and billing.",
    };
  }
}

export async function aiResponse(
  owner: string,
  operation: string,
  model: string,
  body: Record<string, unknown>,
) {
  if (!runtime().OPENAI_API_KEY)
    throw new AIError(
      "Live AI requires the OpenAI API connection. Use the explicitly labeled reference demonstration meanwhile.",
    );
  if (!MODELS.some((m) => m.id === model))
    throw new AIError("Unsupported model selection.", 400);
  const id = crypto.randomUUID(),
    started = Date.now();
  await putRecord(owner, "ai_usage", id, {
    id,
    operation,
    model,
    at: new Date().toISOString(),
    status: "pending",
    input: 0,
    output: 0,
    total: 0,
  });
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime().OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(110000),
      body: JSON.stringify({ ...body, model, store: false }),
    });
    if (!r.ok)
      throw new AIError(
        r.status === 429
          ? "OpenAI quota or rate limit reached. Check API billing or retry later."
          : r.status === 401 || r.status === 403
            ? "OpenAI access denied. Verify the API project and model permissions."
            : "OpenAI could not process this request.",
        r.status === 429 ? 429 : 502,
      );
    const j: any = await r.json();
    const u = j.usage;
    await putRecord(owner, "ai_usage", id, {
      id,
      operation,
      model: j.model || model,
      responseId: j.id,
      at: new Date().toISOString(),
      status: u ? "reported" : "usage unavailable",
      input: u?.input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      cached: u?.input_tokens_details?.cached_tokens ?? 0,
      reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0,
      total: u?.total_tokens ?? 0,
      ms: Date.now() - started,
    });
    if (j.status === "incomplete")
      throw new AIError(
        "The model reached its response limit. Try a shorter document or question.",
        422,
      );
    return j;
  } catch (e) {
    if (!(e instanceof AIError && e.status === 422))
      await putRecord(owner, "ai_usage", id, {
        id,
        operation,
        model,
        at: new Date().toISOString(),
        status: "failed / usage unknown",
        input: 0,
        output: 0,
        total: 0,
        ms: Date.now() - started,
      });
    throw e instanceof AIError
      ? e
      : new AIError(
          "AI request timed out or the connection failed. Provider usage may exist even though no response was received.",
        );
  }
}

export function responseText(j: any) {
  return (
    j.output
      ?.flatMap((x: any) => x.content || [])
      .filter((x: any) => x.type === "output_text")
      .map((x: any) => x.text)
      .join("\n") || ""
  );
}
