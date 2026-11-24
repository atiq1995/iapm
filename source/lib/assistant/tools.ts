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
import { aggregate, approved, sum, type Assumptions, type Asset, type Dataset, type Incident } from "@/lib/domain";
import { assetMTBF } from "@/lib/mtbf";
import { factsFor, METRICS as CHART_METRICS } from "@/lib/visual-analytics";

export type Source = { id: string; label: string; assetId: string; incidentId?: string };
// Chart data goes straight to the browser; the model only receives a compact summary.
export type TrendChart = {
  kind: "trend";
  title: string;
  metric: string;
  unit: string;
  interval: "year" | "month";
  points: { period: string; value: number }[];
  filters: { site: string; category: string; asset: string; mode: string; from: number; to: number };
};
// Ranking/comparison shown as a horizontal bar chart plus a table.
export type RankingChart = {
  kind: "ranking";
  title: string;
  metric: string;
  unit: string;
  groupBy: "asset" | "site" | "category";
  total: number;
  showShare: boolean;
  rows: { label: string; value: number; share: number; id?: string; sub?: string }[];
  filters: { site: string; category: string; asset: string; mode: string; from: number; to: number };
};
export type AssistantVisual = TrendChart | RankingChart;
export type ToolOutcome = { ok: boolean; content: string; sources: Source[]; summary: string; chart?: AssistantVisual };

export const TOOL_NAMES = ["rank_assets", "trend_over_time", "query_reliability", "search_incidents", "get_asset_profile"] as const;

// trend_over_time metric → Executive overview chart-studio metric (same definitions and numbers).
const TREND_METRICS = {
  failures: "events",
  actual_loss: "loss",
  downtime: "days",
  potential_loss: "exposure",
  records: "records",
  maintenance: "maintenance",
} as const;
type TrendMetric = keyof typeof TREND_METRICS;
const DATA_END_YEAR = 2026;

// rank_assets metric → field produced by the Bad actors aggregate (same numbers as that screen).
const RANK_METRICS = {
  actual_loss: { field: "loss", label: "Actual loss (approved F1) · USD" },
  potential_loss: { field: "potential", label: "Potential exposure (F2 estimate) · USD" },
  downtime: { field: "days", label: "Actual downtime (F1) · days" },
  potential_downtime: { field: "potentialDays", label: "Potential downtime (F2 estimate) · days" },
  maintenance: { field: "maintenance", label: "Maintenance cost · USD" },
  events: { field: "events", label: "Approved F1 loss events" },
} as const;
type RankMetric = keyof typeof RANK_METRICS;
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
      name: "rank_assets",
      description:
        "Rank or compare by a metric, shown to the user as a bar chart and table. group_by asset (default; no tag needed), site or category. Use for any 'top', 'worst', 'highest', 'loss driver', 'bad actor' or 'compare sites/categories' question. Metrics: actual_loss (approved F1 USD), potential_loss (estimated F2 exposure USD; never add to actual), downtime, potential_downtime, maintenance (USD), events (F1 count). Optional site, category and years.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", enum: Object.keys(RANK_METRICS) },
          group_by: { type: "string", enum: ["asset", "site", "category"], description: "Default asset." },
          site: { type: "string", description: "Site name, or empty for all sites." },
          category: { type: "string", description: "Equipment, Machinery, Instrumentation or Electrical; empty for all." },
          from: { type: "integer", description: "First incident year, default 1990." },
          to: { type: "integer", description: "Last incident year, default 2026." },
          limit: { type: "integer", description: "Rows to return, 1-20, default 10." },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trend_over_time",
      description:
        "Trend over time, per year (or per month for spans up to 3 years). Use for any 'trend', 'plot', 'chart', 'graph', 'over time', 'per year' or 'history over the years' question. The user automatically sees a chart of every point; you receive a summary. Metrics: failures (downtime events from approved F1 records), actual_loss (USD), downtime (asset-days), potential_loss (F2 exposure USD), records (approved RIRs), maintenance (USD).",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", enum: Object.keys(TREND_METRICS) },
          asset: { type: "string", description: "Optional asset tag such as SC-E-101, or asset ID." },
          site: { type: "string", description: "Site name, or empty for all sites." },
          category: { type: "string", description: "Equipment, Machinery, Instrumentation or Electrical; empty for all." },
          failure_mode: { type: "string", description: "Optional failure mode, e.g. Seal leakage." },
          from: { type: "integer", description: "First year, default 1990." },
          to: { type: "integer", description: "Last year, default 2026." },
          interval: { type: "string", enum: ["year", "month"], description: "Default: year (month only for spans up to 3 years)." },
        },
        required: ["metric"],
      },
    },
  },
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

// Plain-English proportion words, so headlines match the figures ("about a third", not "the majority").
export function shareWords(pct: number) {
  if (pct > 50) return `the majority (${pct}%)`;
  if (pct >= 45) return `nearly half (${pct}%)`;
  if (pct >= 37) return `over a third (${pct}%)`;
  if (pct >= 30) return `about a third (${pct}%)`;
  if (pct >= 20) return `about a quarter (${pct}%)`;
  return `${pct}%`;
}
const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}` : `$${Math.round(n).toLocaleString("en-US")}`);

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
  let chart: RankingChart | undefined;
  if (intent === "mtbf") {
    const rowsWithHours = r.rows
      .map((row) => ({ row, a: d.assets.find((x) => x.id === row.assetId) }))
      .map(({ row, a }) => ({ row, a, h: a ? assetMTBF(a, d.incidents).hours : null }))
      .filter((x): x is { row: typeof x.row; a: Asset; h: number } => !!x.a && x.h !== null)
      .slice(0, 10);
    if (rowsWithHours.length)
      chart = {
        kind: "ranking",
        title: `MTBF · ${plan.ascending ? "lowest" : "highest"} first · ${plan.site || "all sites"}`,
        metric: "MTBF",
        unit: "hours",
        groupBy: "asset",
        total: 0,
        showShare: false,
        rows: rowsWithHours.map(({ a, h }) => ({ label: a.tag, value: Math.round(h), share: 0, id: a.id, sub: `${a.site} · ${a.category}` })),
        filters: { site: plan.site, category: plan.category, asset: "", mode: "", from: plan.from, to: plan.to },
      };
  }
  // Portfolio totals cite assets, not a sample of incidents (which would look like per-row evidence).
  const citable = ["incidents", "modes", "actions", "criticality", "mtbf"].includes(intent) ? r.sources.slice(0, 40).map((s) => s.id) : [];
  const scope = `${intent}${asset ? " · " + asset.tag : ""}${plan.site ? " · " + plan.site : ""}${plan.category ? " · " + plan.category : ""} · ${plan.from}–${plan.to}`;
  const outcome = finish(
    {
      title: r.title,
      result: r.answer,
      basis: r.basis,
      // Each row carries its record ID so the model never has to guess IDs from tags.
      columns: ["ID", ...r.columns],
      rows: r.rows.slice(0, 20).map((row) => [row.incidentId || row.assetId || "", ...row.values]),
      supportingRecords: r.sourceCount,
      citableIds: citable,
    },
    r.sources,
    scope,
  );
  return chart ? { ...outcome, chart } : outcome;
}

function rankFacts(
  top: { name: string; value: number }[],
  total: number,
  label: string,
  unit: string,
  round: (n: number) => number,
  share: (n: number) => number,
  count: number,
  groupBy: string,
) {
  const v = (n: number) => (unit === "USD" ? money(round(n)) : `${round(n).toLocaleString("en-US")} ${unit}`);
  const [a, b] = top;
  if (!a) return [];
  const facts = [`${a.name} leads ${label.toLowerCase()} with ${v(a.value)}, ${shareWords(share(a.value))} of the ${v(total)} total across ${count} ${groupBy === "asset" ? "assets" : groupBy === "site" ? "sites" : "categories"}.`];
  if (b) facts.push(`Next: ${b.name} with ${v(b.value)} (${share(b.value)}%); the leader is ${b.value ? (a.value / b.value).toFixed(1) : "n/a"}× the runner-up.`);
  if (top.length >= 3) facts.push(`Top 3 together: ${Math.round(top.slice(0, 3).reduce((s, r) => s + share(r.value), 0))}% of the total.`);
  return facts;
}

function rankAssets(d: Dataset, args: Record<string, unknown>): ToolOutcome {
  const metric = text(args.metric, 30) as RankMetric;
  if (!(metric in RANK_METRICS)) throw new ToolInputError(`Unsupported metric. Use one of: ${Object.keys(RANK_METRICS).join(", ")}.`);
  const groupBy = (["site", "category"].includes(text(args.group_by, 20)) ? text(args.group_by, 20) : "asset") as "asset" | "site" | "category";
  const site = resolveOption([...new Set(d.assets.map((a) => a.site))], args.site, "site");
  const category = resolveOption([...new Set(d.assets.map((a) => a.category))], args.category, "category");
  const { from, to } = years(args);
  const limit = int(args.limit, 10, 1, 20);
  const ids = new Set(d.assets.filter((a) => (!site || a.site === site) && (!category || a.category === category)).map((a) => a.id));
  const rows = d.incidents.filter((e) => ids.has(e.assetId) && +e.date.slice(0, 4) >= from && +e.date.slice(0, 4) <= to);
  const { field, label } = RANK_METRICS[metric];
  const unit = metric.includes("downtime") ? "days" : metric === "events" ? "events" : "USD";
  const round = (n: number) => (unit === "days" ? Math.round(n * 10) / 10 : Math.round(n));
  const perAsset = aggregate(d, rows).filter((r) => ids.has(r.id));
  // Group per asset (default), or sum the same per-asset figures by site or category.
  type Row = { key: string; name: string; value: number; loss: number; potential: number; events: number; secondary: number; assets: number; site?: string; category?: string; tag?: string };
  const grouped = new Map<string, Row>();
  for (const r of perAsset) {
    const key = groupBy === "asset" ? r.id : groupBy === "site" ? r.site : r.category;
    const g = grouped.get(key) || { key, name: groupBy === "asset" ? r.tag : key, value: 0, loss: 0, potential: 0, events: 0, secondary: 0, assets: 0, ...(groupBy === "asset" ? { site: r.site, category: r.category, tag: r.tag } : {}) };
    g.value += Number((r as Record<string, unknown>)[field]) || 0;
    g.loss += r.loss;
    g.potential += r.potential;
    g.events += r.events;
    g.secondary += r.secondary;
    g.assets += 1;
    grouped.set(key, g);
  }
  const ranked = [...grouped.values()].sort((a, b) => b.value - a.value);
  const total = sum(ranked.map((r) => r.value));
  const top = ranked.slice(0, limit);
  const share = (v: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);
  const scopeText = [site || (groupBy === "site" ? "" : "all sites"), category].filter(Boolean).join(" · ") || "portfolio";
  // Display name without the technical qualifiers: "Actual loss (approved F1) · USD" → "Actual loss".
  const shortLabel = label.replace(/\s*\(.*?\)/g, "").replace(/\s*·.*$/, "");
  const chart: RankingChart = {
    kind: "ranking",
    title: `${shortLabel} by ${groupBy} · ${scopeText} · ${from}–${to}`,
    metric: shortLabel,
    unit,
    groupBy,
    total: round(total),
    showShare: true,
    rows: top.slice(0, 10).map((r) => ({ label: r.name, value: round(r.value), share: share(r.value), ...(groupBy === "asset" ? { id: r.key, sub: `${r.site} · ${r.category}` } : { sub: `${r.assets} assets` }) })),
    filters: { site, category, asset: "", mode: "", from, to },
  };
  return {
    ...finish(
      {
        metric: label,
        groupedBy: groupBy,
        scope: { site: site || "all sites", category: category || "all categories", from, to, itemsRanked: ranked.length },
        portfolioTotal: round(total),
        keyFacts: rankFacts(top, total, shortLabel, unit, round, share, ranked.length, groupBy),
        // Calculated headline (the leader's key fact); the engine shows it instead of the model's own.
        headline: rankFacts(top, total, shortLabel, unit, round, share, ranked.length, groupBy)[0] ?? "",
        leaderSharePct: top[0] ? share(top[0].value) : 0,
        ranking: top.map((r, i) => ({
          rank: i + 1,
          ...(groupBy === "asset" ? { id: r.key, tag: r.tag, site: r.site, category: r.category } : { name: r.name, assets: r.assets }),
          value: round(r.value),
          shareOfTotalPct: share(r.value),
          actualLossUSD: Math.round(r.loss),
          potentialExposureUSD: Math.round(r.potential),
          f1Events: r.events,
          f2Records: r.secondary,
        })),
        notes: [
          "The user already sees a bar chart and table of this ranking. Give the headline insight (leader, concentration, gaps); do not repeat every row.",
          "Uses approved/closed records only, the same calculation as the Bad actors screen.",
          "Potential exposure is an estimate: average loss of earlier matching F1 events (same failure mode, category and service) × 1.3 uncertainty. It is never added to actual loss.",
        ],
      },
      groupBy === "asset" ? top.map((r) => ({ id: r.key, label: `${r.tag} · ${r.site}`, assetId: r.key })) : [],
      `rank ${metric} by ${groupBy}${site ? " · " + site : ""}${category ? " · " + category : ""} · ${from}–${to}`,
    ),
    chart,
  };
}

function trendOverTime(d: Dataset, args: Record<string, unknown>): ToolOutcome {
  const metric = text(args.metric, 30) as TrendMetric;
  if (!(metric in TREND_METRICS)) throw new ToolInputError(`Unsupported metric. Use one of: ${Object.keys(TREND_METRICS).join(", ")}.`);
  const asset = resolveAsset(d, args.asset ?? args.assetId);
  const site = resolveOption([...new Set(d.assets.map((a) => a.site))], args.site, "site");
  const category = resolveOption([...new Set(d.assets.map((a) => a.category))], args.category, "category");
  const mode = resolveOption([...new Set(d.incidents.map((e) => e.mode))], args.failure_mode ?? args.mode, "failure mode");
  const range = years({ from: args.from, to: args.to ?? DATA_END_YEAR });
  // History ends in 2026; future years would only add empty bars.
  const from = range.from, to = Math.min(range.to, DATA_END_YEAR);
  if (from > to) throw new ToolInputError(`Recorded history ends in ${DATA_END_YEAR}. Choose years up to ${DATA_END_YEAR}.`);
  const span = to - from + 1;
  const interval: "year" | "month" = span <= 3 && (args.interval === "month" || (span <= 2 && args.interval !== "year")) ? "month" : "year";

  const assets = new Map(d.assets.map((a) => [a.id, a]));
  const rows = d.incidents.filter((e) => {
    const a = assets.get(e.assetId);
    const y = +e.date.slice(0, 4);
    return !!a && y >= from && y <= to && (!asset || a.id === asset.id) && (!site || a.site === site) && (!category || a.category === category) && (!mode || e.mode === mode);
  });
  const field = TREND_METRICS[metric];
  const meta = CHART_METRICS[field];
  const dates = new Map(rows.map((e) => [e.id, e.date]));
  const totals = new Map<string, number>();
  for (const f of factsFor(d, rows)) {
    const key = interval === "year" ? String(f.year) : (dates.get(f.id) || "").slice(0, 7);
    totals.set(key, (totals.get(key) || 0) + f[field]);
  }
  // Every period appears, including zeros, up to the current month.
  const now = new Date().toISOString().slice(0, 7);
  const periods: string[] = [];
  for (let y = from; y <= to; y++) {
    if (interval === "year") periods.push(String(y));
    else for (let m = 1; m <= 12; m++) {
      const p = `${y}-${String(m).padStart(2, "0")}`;
      if (p <= now) periods.push(p);
    }
  }
  const round = (n: number) => (meta.unit === "USD" ? Math.round(n) : Math.round(n * 10) / 10);
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const show = (n: number) => {
    const v = round(n);
    const exact = `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${meta.unit}`;
    return Math.abs(v) >= 1e6 ? `${exact} (≈ ${compact.format(v)})` : exact;
  };
  const points = periods.map((period) => ({ period, value: round(totals.get(period) || 0) }));
  const values = points.map((p) => p.value);
  const total = round(sum(values));
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
  const third = Math.max(1, Math.floor(points.length / 3));
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
  const early = avg(values.slice(0, third)), late = avg(values.slice(-third));
  const scope = [asset ? asset.tag : site || "all sites", !asset && category ? category : "", mode].filter(Boolean).join(" · ");
  const chart: TrendChart = {
    kind: "trend",
    title: `${meta.label} per ${interval} · ${scope} · ${from}–${to}`,
    metric: meta.label,
    unit: meta.unit,
    interval,
    points,
    filters: { site, category, asset: asset?.id ?? "", mode, from, to },
  };
  // Calculated headline: the engine shows this instead of the model's own first sentence.
  const pct = early > 0 ? Math.round(((late - early) / early) * 100) : null;
  const verb = /events|records/i.test(meta.label) ? "were" : "was";
  const movement = pct === null ? ` ${verb} recorded` : Math.abs(pct) < 5 ? ` ${verb} broadly flat` : ` ${pct > 0 ? "rose" : "fell"} ${Math.abs(pct)}%`;
  const where = asset ? ` for ${asset.tag}` : site ? ` at ${site}` : category ? ` for ${category}` : " across all sites";
  const peakText = peak && peak.value > 0 ? `, peaking at ${meta.unit === "USD" ? money(peak.value) : `${peak.value.toLocaleString("en-US")} ${meta.unit}`} in ${peak.period}` : "";
  const headline = `${meta.label}${where}${mode ? ` (${mode})` : ""}${movement} over ${from}–${to}${peakText}.`;
  return {
    ...finish(
      {
        headline,
        metric: `${meta.label} (${meta.unit})`,
        interval,
        scope: { asset: asset?.tag ?? "all assets", site: site || "all sites", category: category || "all categories", failureMode: mode || "all modes", from, to },
        periods: points.length,
        total,
        averagePerPeriod: round(avg(values)),
        peak: peak ? { period: peak.period, value: peak.value } : null,
        periodsWithZero: values.filter((v) => v === 0).length,
        firstThirdAverage: round(early),
        lastThirdAverage: round(late),
        changeFirstToLastThirdPct: early > 0 ? Math.round(((late - early) / early) * 100) : null,
        direction:
          early > 0
            ? Math.abs((late - early) / early) < 0.05
              ? `broadly flat (${Math.round(((late - early) / early) * 100)}% from the first third of the period to the last)`
              : `${late > early ? "rose" : "fell"} ${Math.abs(Math.round(((late - early) / early) * 100))}% from the first third of the period to the last`
            : "not enough early data to judge direction",
        latest: points.slice(-3),
        // Pre-formatted figures for the answer text, so long numbers are copied, not retyped.
        display: {
          total: show(total),
          averagePerPeriod: show(avg(values)),
          peak: peak ? `${show(peak.value)} in ${peak.period}` : "none",
          latest: points.slice(-3).map((p) => `${p.period}: ${show(p.value)}`).join("; "),
        },
        notes: [
          "Copy figures exactly from `display`. Do not add, multiply or reformat numbers yourself.",
          "The user already sees a chart with every point. Summarize the direction, peak and latest values; do not list every period.",
          "Uses approved records only, the same definitions as the Executive overview chart studio.",
        ],
      },
      asset ? [{ id: asset.id, label: `${asset.tag} · asset register`, assetId: asset.id }] : [],
      `trend ${metric} · ${scope} · ${from}–${to} · per ${interval}`,
    ),
    chart,
  };
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
    if (name === "rank_assets") return rankAssets(d, args);
    if (name === "trend_over_time") return trendOverTime(d, args);
    if (name === "query_reliability") return queryReliability(d, args, assumptions);
    if (name === "search_incidents") return searchIncidents(d, args);
    if (name === "get_asset_profile") return assetProfile(d, args);
    return { ok: false, content: JSON.stringify({ error: `Tool "${clip(name, 40)}" does not exist. This assistant is read-only and has only: ${TOOL_NAMES.join(", ")}.` }), sources: [], summary: `rejected tool ${clip(name, 40)}` };
  } catch (e) {
    const message = e instanceof ToolInputError ? e.message : "Invalid query parameters. Use a registered asset, site, category and year range.";
    return { ok: false, content: JSON.stringify({ error: message }), sources: [], summary: `${name} · ${message}` };
  }
}
