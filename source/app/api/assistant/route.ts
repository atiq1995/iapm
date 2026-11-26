// Read-only reliability assistant API.
//
// GET  → assistant status (name, model attached or not) + saved conversations + saved reports
// POST → { question | reportId, conversationId?, assumptions? } → updated conversation
//
// Order of answering: saved report (clicked, or named in the question) → plain-English chart
// request → automatic look-up / AI with read-only tools. Chart answers are calculated by code.
//
// The only rows this route writes are the owner's own conversation history
// (kind "assistant_chat") and the AI usage ledger (kind "ai_usage"). Assets,
// incidents, actions and assessments are loaded into a frozen copy and are
// never written.

import { z } from "zod";
import { identity, sameOrigin } from "@/lib/auth";
import { ownerData } from "@/lib/owner-data";
import { putRecord, readRecords } from "@/lib/ai-service";
import { assumptionsSchema } from "@/lib/validation";
import { defaultAssumptions } from "@/lib/domain";
import { assistantConfig, publicStatus } from "@/lib/assistant/config";
import { chartAnswer, guidedReply, readOnlyReply, runAssistant, unavailableReply, type AssistantReply, type HistoryMessage } from "@/lib/assistant/engine";
import { AssistantError } from "@/lib/assistant/provider";
import { deepFreeze, runTool } from "@/lib/assistant/tools";
import { specKey, type ChartSpec } from "@/lib/assistant/charts";
import { chartSpecForQuestion, listReports, matchReportByName, type SavedReport } from "@/lib/assistant/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store" };
const KIND = "assistant_chat";
const body = z
  .object({
    question: z.string().trim().min(2).max(2000).optional(),
    reportId: z.string().max(100).optional(),
    conversationId: z.string().max(100).optional(),
    assumptions: assumptionsSchema.optional(),
  })
  .strict()
  .refine((b) => !!b.question || !!b.reportId);

type Data = Parameters<typeof runTool>[2];
// Runs a chart recipe and returns a calculated answer (or a plain explanation if it cannot run).
function chartReply(data: Data, spec: ChartSpec, designedBy: "rules" | "saved", report: SavedReport | null): AssistantReply {
  const outcome = runTool("build_chart", spec, data, defaultAssumptions);
  const reply = chartAnswer(outcome, "build_chart", { designedBy, report: report ? { id: report.id, name: report.name } : null });
  if (reply) return reply;
  let reason = "The chart could not be built.";
  try {
    reason = JSON.parse(outcome.content).error || reason;
  } catch {
    /* keep default */
  }
  return { answer: reason, sources: [], steps: [{ tool: "build_chart", summary: outcome.summary, ok: false }], warnings: [], engine: "calculated" };
}

// Per-instance burst protection. Serverless instances do not share memory, so
// production should add a shared limiter at the gateway (see docs/ai-assistant.md).
const recent = new Map<string, number[]>();
const inFlight = new Set<string>();
function rateLimited(owner: string) {
  const now = Date.now();
  const list = (recent.get(owner) || []).filter((t) => now - t < 60000);
  const limit = Math.min(1000, Math.max(1, Number(process.env.AI_RATE_PER_MINUTE) || 15));
  if (list.length >= limit) return true;
  list.push(now);
  recent.set(owner, list);
  return false;
}

const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET() {
  try {
    const user = await identity();
    if (!user) return fail("Session expired", 401);
    const conversations = (await readRecords(user.userId, KIND)).slice(0, 30);
    const reports = (await listReports(user.userId)).map((r) => ({ id: r.id, name: r.name, type: r.spec.type, updatedAt: r.updatedAt }));
    return Response.json({ assistant: publicStatus(assistantConfig()), conversations, reports }, { headers });
  } catch {
    return fail("Assistant unavailable", 503);
  }
}

export async function POST(req: Request) {
  let owner = "";
  let locked = false;
  try {
    const user = await identity();
    if (!user) return fail("Session expired", 401);
    if (!sameOrigin(req)) return fail("Request rejected", 403);
    owner = user.userId;
    const raw = await req.text();
    if (raw.length > 20000) return fail("Question payload too large.", 413);
    let parsed;
    try {
      parsed = body.safeParse(JSON.parse(raw));
    } catch {
      return fail("Invalid request.", 400);
    }
    if (!parsed.success) return fail("Enter a question of 2–2,000 characters.", 400);
    if (inFlight.has(owner)) return fail("The previous question is still being answered.", 429);
    if (rateLimited(owner)) return fail("Too many questions in a short time. Wait a minute and retry.", 429);
    inFlight.add(owner);
    locked = true;

    const { conversationId, reportId } = parsed.data;
    let question = parsed.data.question ?? "";
    const assumptions = parsed.data.assumptions || defaultAssumptions;
    const previous = conversationId ? (await readRecords(owner, KIND)).find((c) => c.id === conversationId) : null;
    if (conversationId && !previous) return fail("Conversation not found.", 404);

    const cfg = assistantConfig();
    const data = deepFreeze(await ownerData(owner));
    const stored: { role?: unknown; content?: unknown }[] = previous?.messages || [];
    const history = stored.filter(
      (m): m is HistoryMessage => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    ).map((m) => ({ role: m.role, content: m.content }));

    const reports = await listReports(owner);
    const priorCharts = stored.flatMap((m) => ((m as { charts?: { kind?: string; spec?: ChartSpec }[] }).charts ?? []));
    let reply: AssistantReply | null = null;
    if (reportId) {
      // A saved report was clicked: show it straight away, with current data.
      const report = reports.find((r) => r.id === reportId);
      if (!report) return fail("Saved report not found.", 404);
      question = report.name;
      reply = chartReply(data, report.spec, "saved", report);
    } else {
      reply = readOnlyReply(question, cfg.name) ?? unavailableReply(question, cfg.name);
      if (!reply) {
        // A question naming a saved report, or asking for a chart a saved report already covers,
        // shows that report directly.
        const named = matchReportByName(question, reports);
        const spec = named ? named.spec : chartSpecForQuestion(question, data, priorCharts);
        if (spec) {
          const saved = named ?? reports.find((r) => r.key === specKey(spec)) ?? null;
          reply = chartReply(data, spec, saved ? "saved" : "rules", saved);
        }
      }
    }
    if (reply) {
      /* answered without the AI */
    } else if (cfg.connected) {
      try {
        reply = await runAssistant({ cfg, owner, data, assumptions, question, history });
      } catch (e) {
        const reason = e instanceof AssistantError ? e.message : "The AI model step failed.";
        reply = guidedReply(data, question, assumptions, `${reason} This answer comes from the guided query engine instead.`);
      }
    } else {
      reply = guidedReply(data, question, assumptions, "No language model is attached, so this answer comes from the guided query engine.");
    }

    // A chart the AI designed may match a saved report too.
    const built = reply.charts?.find((c) => c.kind === "chart");
    if (built && built.kind === "chart" && !reply.report) {
      const saved = reports.find((r) => r.key === built.key);
      if (saved) reply = { ...reply, report: { id: saved.id, name: saved.name } };
    }
    const now = new Date().toISOString();
    const id = previous?.id || crypto.randomUUID();
    const conversation = {
      id,
      title: previous?.title || question.slice(0, 70),
      updatedAt: now,
      messages: [
        ...(previous?.messages || []),
        { role: "user", content: question, at: now },
        {
          role: "assistant",
          content: reply.answer,
          sources: reply.sources.slice(0, 40),
          charts: reply.charts?.slice(0, 2),
          steps: reply.steps,
          warnings: reply.warnings,
          engine: reply.engine,
          designedBy: reply.designedBy,
          report: reply.report ?? undefined,
          model: reply.engine === "model" || reply.designedBy === "model" ? cfg.modelLabel : undefined,
          notice: reply.notice,
          at: now,
        },
      ].slice(-30),
    };
    await putRecord(owner, KIND, id, conversation);
    return Response.json({ conversation, assistant: publicStatus(cfg) }, { headers });
  } catch {
    return fail("The assistant could not complete this request. Please retry.", 503);
  } finally {
    if (locked) inFlight.delete(owner);
  }
}
