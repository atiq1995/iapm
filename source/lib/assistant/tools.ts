// Read-only tools the assistant may call.
//
// Read-only guarantee, by construction:
//   1. Tools receive a deep-frozen in-memory Dataset. They never receive a
//      database handle, so they have no way to write.
//   2. Only the three tools below exist. Any other tool name is rejected.
//   3. Every argument is re-validated here; the model's arguments are untrusted.
//   4. All numbers come from the shared iAPM engines (answerQuery, assetMTBF),
//      the same code the dashboards use.

import { answerQuery, intents, validatePlan, type QueryPlan } from "@/lib/reliability-agent";
import { approved, sum, type Assumptions, type Asset, type Dataset, type Incident } from "@/lib/domain";
import { assetMTBF } from "@/lib/mtbf";

export type Source = { id: string; label: string; assetId: string; incidentId?: string };
export type ToolOutcome = { ok: boolean; content: string; sources: Source[]; summary: string };

export const TOOL_NAMES = ["query_reliability", "search_incidents", "get_asset_profile"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const QUERY_INTENTS: string[] = intents.filter((i) => i !== "help");
const MAX_TOOL_CONTENT = 12000;
const STOP_WORDS = new Set(
  "a an and are as at be by did do does for from has have in is it its me of on or show tell the to was were what when where which who why with about any all our".split(" "),
);

export const TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "query_reliability",
      description:
        "Run an authoritative iAPM calculation. Intents: overview (asset summary), loss (actual-loss bad actors), downtime, mtbf, criticality, incidents (latest RIRs), medfi (lifecycle stage counts), modes (failure modes and causes), sites, categories (comparisons), actions, economics (one asset: replacement NPV/IRR/payback), forecast (one asset: expected failures). Leave asset/site/category empty for all.",
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string", enum: QUERY_INTENTS },
          asset: { type: "string", description: "Asset tag such as SC-E-101, or asset ID such as AST-1. Empty for all assets." },
          site: { type: "string", description: "Site name, or empty for all sites." },
          category: { type: "string", description: "Equipment, Machinery, Instrumentation or Electrical; empty for all." },
          from: { type: "integer", description: "First incident year, default 1990." },
          to: { type: "integer", description: "Last incident year, default 2026." },
          limit: { type: "integer", description: "Rows to return, 1-20, default 10." },
          ascending: { type: "boolean", description: "true = lowest first. For MTBF, true means worst first." },
        },
        required: ["intent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_incidents",
      description:
        "Search saved Reliability Incident Reports (RIRs) by keywords, RIR ID, reference, asset tag, failure mode or cause. Returns narratives, causes and corrective actions. Use for 'why', 'what happened' and history questions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords, e.g. 'seal leakage' or 'RIR-SC-1990-017'. Empty returns the latest records." },
          asset: { type: "string", description: "Optional asset tag or ID." },
          from: { type: "integer", description: "First year, default 1990." },
          to: { type: "integer", description: "Last year, default 2026." },
          limit: { type: "integer", description: "1-15, default 8." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_asset_profile",
      description:
        "Full profile of one asset: register data, criticality, MTBF, actual loss, downtime, lifecycle-stage counts, top failure modes, latest incidents and open actions.",
      parameters: {
        type: "object",
        properties: { asset: { type: "string", description: "Asset tag such as SC-E-101, or asset ID such as AST-1." } },
        required: ["asset"],
      },
    },
  },
] as const;

export class ToolInputError extends Error {}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const clip = (v: string | undefined, max: number) => (v && v.length > max ? v.slice(0, max - 1) + "…" : v || "");
const usd = (n: number) => Math.round(n);

export function resolveAsset(d: Dataset, value: unknown): Asset | null {
  const key = text(value, 100).toLowerCase();
  if (!key) return null;
  const asset = d.assets.find((a) => a.id.toLowerCase() === key || a.tag.toLowerCase() === key);
  if (!asset) throw new ToolInputError(`Unknown asset "${text(value, 100)}". Use an exact tag such as ${d.assets[0]?.tag ?? "SC-E-101"}.`);
  return asset;
}

function resolveOption(options: string[], value: unknown, label: string) {
  const key = text(value, 100).toLowerCase();
  if (!key || key === "all") return "";
  const match = options.find((o) => o.toLowerCase() === key);
  if (!match) throw new ToolInputError(`Unknown ${label} "${text(value, 100)}". Valid values: ${options.join(", ")}.`);
  return match;
}

function years(args: Record<string, unknown>) {
  const from = int(args.from, 1990, 1900, 2100), to = int(args.to, 2026, 1900, 2100);
  if (from > to) throw new ToolInputError("The start year must not be after the end year.");
  return { from, to };
}

const tagOf = (d: Dataset, id: string) => d.assets.find((a) => a.id === id)?.tag ?? id;
const incidentSource = (d: Dataset, e: Incident): Source => ({
  id: e.id,
  assetId: e.assetId,
  incidentId: e.id,
  label: `${e.id} · ${tagOf(d, e.assetId)} · ${e.date.slice(0, 10)} · ${e.status}`,
});

function finish(payload: unknown, sources: Source[], summary: string): ToolOutcome {
  let content = JSON.stringify(payload);
  if (content.length > MAX_TOOL_CONTENT) content = content.slice(0, MAX_TOOL_CONTENT) + '…"(truncated)"';
  return { ok: true, content, sources, summary };
}

function queryReliability(d: Dataset, args: Record<string, unknown>, assumptions: Assumptions): ToolOutcome {
  const intent = text(args.intent, 30) as QueryPlan["intent"];
  if (!QUERY_INTENTS.includes(intent)) throw new ToolInputError(`Unsupported intent. Use one of: ${QUERY_INTENTS.join(", ")}.`);
  const asset = resolveAsset(d, args.asset ?? args.assetId);
  const plan = validatePlan(
    {
      intent,
      assetId: asset?.id ?? "",
      site: resolveOption([...new Set(d.assets.map((a) => a.site))], args.site, "site"),
      category: resolveOption([...new Set(d.assets.map((a) => a.category))], args.category, "category"),
      ...years(args),
      limit: int(args.limit, 10, 1, 20),
      ascending: args.ascending === true || args.ascending === "true",
    },
    d,
  );
  const r = answerQuery(d, plan, assumptions);
  const scope = `${intent}${asset ? " · " + asset.tag : ""}${plan.site ? " · " + plan.site : ""}${plan.category ? " · " + plan.category : ""} · ${plan.from}–${plan.to}`;
  return finish(
    {
      title: r.title,
      result: r.answer,
      basis: r.basis,
      columns: r.columns,
      rows: r.rows.slice(0, 20).map((row) => row.values),
      supportingRecords: r.sourceCount,
      citableIds: r.sources.slice(0, 40).map((s) => s.id),
    },
    r.sources,
    scope,
  );
}

function searchIncidents(d: Dataset, args: Record<string, unknown>): ToolOutcome {
  const asset = resolveAsset(d, args.asset ?? args.assetId);
  const { from, to } = years(args);
  const limit = int(args.limit, 8, 1, 15);
  const words = text(args.query, 200)
    .toLowerCase()
    .split(/[^a-z0-9.\-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const pool = d.incidents.filter(
    (e) => (!asset || e.assetId === asset.id) && +e.date.slice(0, 4) >= from && +e.date.slice(0, 4) <= to,
  );
  const scored = pool
    .map((e) => {
      const hay = [e.id, e.reference, e.narrative, e.mode, e.mechanism, e.cause, e.rootCause, e.correctiveAction, tagOf(d, e.assetId)]
        .join(" ")
        .toLowerCase();
      return { e, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => !words.length || x.score > 0);
  const full = scored.filter((x) => x.score === words.length);
  const matches = (full.length ? full : scored).sort((a, b) => b.score - a.score || b.e.date.localeCompare(a.e.date));
  const selected = matches.slice(0, limit).map((x) => x.e);
  const partial = words.length > 0 && !full.length && scored.length > 0;
  return finish(
    {
      totalMatches: matches.length,
      returned: selected.length,
      matchType: !words.length ? "latest records" : partial ? "partial keyword match" : "all keywords matched",
      scope: { asset: asset?.tag ?? "all assets", from, to },
      records: selected.map((e) => ({
        id: e.id,
        asset: tagOf(d, e.assetId),
        date: e.date.slice(0, 10),
        stage: e.stage,
        impact: e.impact,
        status: e.status,
        failureMode: e.mode,
        mechanism: e.mechanism,
        narrative: clip(e.narrative, 320),
        cause: clip(e.rootCause || e.cause, 200),
        correctiveAction: clip(e.correctiveAction, 240),
        actualLossUSD: e.impact === "F1" ? usd(e.loss) : 0,
        downtimeDays: Math.round(e.downtime * 100) / 100,
        reference: e.reference,
      })),
    },
    selected.map((e) => incidentSource(d, e)),
    `search "${text(args.query, 60)}"${asset ? " · " + asset.tag : ""} · ${from}–${to}`,
  );
}

function assetProfile(d: Dataset, args: Record<string, unknown>): ToolOutcome {
  const asset = resolveAsset(d, args.asset ?? args.assetId);
  if (!asset) throw new ToolInputError("Provide one asset tag or ID.");
  const rows = d.incidents.filter((e) => e.assetId === asset.id);
  const actual = rows.filter((e) => approved(e) && e.impact === "F1");
  const m = assetMTBF(asset, d.incidents);
  const modes = new Map<string, number>();
  for (const e of rows) modes.set(e.mode, (modes.get(e.mode) || 0) + 1);
  const latest = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const actions = d.actions.filter((a) => a.assetId === asset.id && a.status !== "Verified complete");
  return finish(
    {
      asset: {
        id: asset.id, tag: asset.tag, description: asset.description, site: asset.site, unit: asset.unit,
        system: asset.system, category: asset.category, service: asset.service, status: asset.status,
        commissioned: asset.commissioned, designLifeYears: asset.designLife, owner: asset.owner,
        conditionScore1to5: asset.condition, criticality1to5: asset.criticality,
        criticalityBasis: asset.aca?.current ? "Reviewed asset criticality assessment" : "Provisional register value",
      },
      mtbf: { hours: m.hours === null ? "Not estimable" : Math.round(m.hours), distinctFailures: m.failures, basis: m.reason },
      history: {
        rirRecords: rows.length,
        approvedActualLossRecords: actual.length,
        actualLossUSD: usd(sum(actual.map((e) => e.loss))),
        actualDowntimeDays: Math.round(sum(actual.map((e) => e.downtime)) * 10) / 10,
        byStage: Object.fromEntries(["M Delta E", "D", "F", "I"].map((s) => [s, rows.filter((e) => e.stage === s).length])),
        topFailureModes: [...modes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([mode, count]) => ({ mode, count })),
      },
      latestIncidents: latest.map((e) => ({ id: e.id, date: e.date.slice(0, 10), stage: e.stage, impact: e.impact, status: e.status, failureMode: e.mode })),
      openActions: actions.slice(0, 8).map((a) => ({ id: a.id, title: a.title, owner: a.owner, due: a.due, status: a.status })),
      notes: ["Actual loss counts approved/closed F1 records only. Potential (F2) exposure is not added."],
    },
    [{ id: asset.id, label: `${asset.tag} · asset register`, assetId: asset.id }, ...latest.map((e) => incidentSource(d, e))],
    `profile · ${asset.tag}`,
  );
}

export function runTool(name: string, rawArgs: unknown, d: Dataset, assumptions: Assumptions): ToolOutcome {
  let args: Record<string, unknown> = {};
  try {
    const parsed = typeof rawArgs === "string" ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : rawArgs;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, content: JSON.stringify({ error: "Arguments were not valid JSON." }), sources: [], summary: `${name} · invalid arguments` };
  }
  try {
    if (name === "query_reliability") return queryReliability(d, args, assumptions);
    if (name === "search_incidents") return searchIncidents(d, args);
    if (name === "get_asset_profile") return assetProfile(d, args);
    return { ok: false, content: JSON.stringify({ error: `Tool "${clip(name, 40)}" does not exist. This assistant is read-only and has only: ${TOOL_NAMES.join(", ")}.` }), sources: [], summary: `rejected tool ${clip(name, 40)}` };
  } catch (e) {
    const message = e instanceof ToolInputError ? e.message : "Invalid query parameters. Use a registered asset, site, category and year range.";
    return { ok: false, content: JSON.stringify({ error: message }), sources: [], summary: `${name} · ${message}` };
  }
}
