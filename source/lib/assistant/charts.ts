// On-demand chart builder for Relia.
//
// A chart is described by a small "recipe" (ChartSpec): chart type, measure,
// grouping and filters. The AI may choose the recipe; everything else (every
// number, label, table, headline and key fact) is calculated here from the
// database, using the Executive overview chart engine (factsFor), so figures
// match the dashboard exactly. Saved reports store the recipe, never numbers,
// so they always show current data.

import { z } from "zod";
import { factsFor, METRICS, DIMENSIONS, type Fact, type Metric, type Dimension } from "@/lib/visual-analytics";
import { sum, type Dataset } from "@/lib/domain";

export const CHART_TYPES = ["pie", "donut", "bar", "hbar", "line", "area", "stacked", "clustered", "bubble", "table", "compare"] as const;
export type ChartType = (typeof CHART_TYPES)[number];
const METRIC_KEYS = Object.keys(METRICS) as [Metric, ...Metric[]];
const DIM_KEYS = Object.keys(DIMENSIONS) as [Dimension, ...Dimension[]];
const COMPARE_BY = ["site", "category", "asset", "mode", "period"] as const;
export const FIRST_YEAR = 1990;
export const LAST_YEAR = 2026;
const MAX_SERIES = 6;

const nullableEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" || v === "none" ? null : v), z.enum(values).nullable().default(null));

export const chartSpecSchema = z
  .object({
    type: z.enum(CHART_TYPES),
    metric: z.enum(METRIC_KEYS).default("loss"),
    dimension: z.enum(DIM_KEYS).default("site"),
    series: nullableEnum(DIM_KEYS),
    x: nullableEnum(METRIC_KEYS),
    y: nullableEnum(METRIC_KEYS),
    size: nullableEnum(METRIC_KEYS),
    compareBy: nullableEnum(COMPARE_BY as unknown as [string, ...string[]]),
    items: z.array(z.string().max(40)).max(6).default([]),
    metrics: z.array(z.enum(METRIC_KEYS)).max(6).default([]),
    filters: z
      .object({
        asset: z.string().max(40).default(""),
        site: z.string().max(40).default(""),
        category: z.string().max(40).default(""),
        mode: z.string().max(60).default(""),
        stage: z.string().max(20).default(""),
        impact: z.enum(["", "F1", "F2"]).default(""),
        from: z.number().int().min(1900).max(2100).default(FIRST_YEAR),
        to: z.number().int().min(1900).max(2100).default(LAST_YEAR),
      })
      .default({}),
    limit: z.number().int().min(3).max(20).default(10),
  })
  .strict();
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export type BuiltChart = {
  kind: "chart";
  type: ChartType;
  title: string;
  spec: ChartSpec;
  key: string;
  metricLabel: string;
  unit: string;
  categories: string[];
  series: { name: string; values: number[] }[];
  points: { label: string; x: number; y: number; size: number }[];
  axes: { x: string; y: string; size: string } | null;
  table: { columns: string[]; rows: string[][] };
  headline: string;
  facts: string[];
  note: string;
  filters: { site: string; category: string; asset: string; mode: string; from: number; to: number };
};

export class ChartError extends Error {}

// ---------- formatting ----------
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export function fmtValue(n: number, unit: string) {
  if (unit === "USD") return Math.abs(n) >= 1e6 ? `$${compact.format(n)}` : `$${Math.round(n).toLocaleString("en-US")}`;
  // Large non-money figures read better shortened: 19.4M tonnes.
  return Math.abs(n) >= 1e6 ? `${compact.format(n)} ${unit}` : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit}`;
}
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
export function shareWords(p: number) {
  if (p > 50) return `the majority (${p}%)`;
  if (p >= 45) return `nearly half (${p}%)`;
  if (p >= 37) return `over a third (${p}%)`;
  if (p >= 30) return `about a third (${p}%)`;
  if (p >= 20) return `about a quarter (${p}%)`;
  return `${p}%`;
}
const metricLabel = (m: Metric) => METRICS[m].label;
const metricUnit = (m: Metric) => METRICS[m].unit;
const dimLabel = (d: Dimension) => DIMENSIONS[d];
const round = (n: number, unit: string) => (unit === "USD" || unit === "events" || unit === "RIRs" ? Math.round(n) : Math.round(n * 10) / 10);

// ---------- normalisation ----------
function pick(options: string[], value: string, label: string) {
  const v = value.trim().toLowerCase();
  if (!v || v === "all") return "";
  const hit = options.find((o) => o.toLowerCase() === v);
  if (!hit) throw new ChartError(`Unknown ${label} "${value}". Valid values: ${options.slice(0, 12).join(", ")}.`);
  return hit;
}

// Resolves names to their exact spelling, applies per-type defaults and clamps years, so the
// same request always produces the same recipe (and the same saved-report key).
export function normalizeSpec(raw: unknown, d: Dataset): ChartSpec {
  const parsed = chartSpecSchema.safeParse(raw);
  if (!parsed.success) throw new ChartError("Invalid chart request: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "));
  const s = parsed.data;
  const sites = [...new Set(d.assets.map((a) => a.site))];
  const categories = [...new Set(d.assets.map((a) => a.category))];
  const modes = [...new Set(d.incidents.map((e) => e.mode))];
  const assetOf = (v: string) => {
    const t = v.trim().toLowerCase();
    if (!t) return "";
    const a = d.assets.find((x) => x.id.toLowerCase() === t || x.tag.toLowerCase() === t);
    if (!a) throw new ChartError(`Unknown asset "${v}". Use a tag such as ${d.assets[0]?.tag ?? "SC-E-101"}.`);
    return a.tag;
  };
  const filters = {
    asset: assetOf(s.filters.asset),
    site: pick(sites, s.filters.site, "site"),
    category: pick(categories, s.filters.category, "category"),
    mode: pick(modes, s.filters.mode, "failure mode"),
    stage: pick(["M Delta E", "D", "F", "I"], s.filters.stage, "MEDFI stage"),
    impact: s.filters.impact,
    from: Math.max(FIRST_YEAR, Math.min(s.filters.from, s.filters.to)),
    to: Math.min(LAST_YEAR, Math.max(s.filters.from, s.filters.to)),
  };
  if (filters.from > filters.to) throw new ChartError(`Recorded history covers ${FIRST_YEAR}–${LAST_YEAR}.`);
  let { dimension, series, x, y, size, compareBy } = s;
  let items = s.items;
  const type = s.type;
  if ((type === "line" || type === "area") && dimension !== "year" && !series) {
    series = dimension;
    dimension = "year";
  }
  if ((type === "stacked" || type === "clustered") && !series) series = dimension === "year" ? "site" : dimension === "site" ? "category" : "site";
  if (series === dimension) series = null;
  if (!["stacked", "clustered", "line", "area"].includes(type)) series = null;
  if (type === "bubble") {
    x = x ?? "events";
    y = y ?? "loss";
    size = size ?? "exposure";
    if (dimension === "year") dimension = "site";
  } else {
    x = y = size = null;
  }
  let metrics = s.metrics;
  if (type === "compare") {
    compareBy = compareBy ?? (["site", "category", "asset", "mode"].includes(dimension) ? (dimension as ChartSpec["compareBy"]) : "site");
    const all = compareBy === "site" ? sites : compareBy === "category" ? categories : compareBy === "mode" ? modes : [];
    if (compareBy === "period") {
      items = items.map((it) => {
        const m = it.match(/((?:19|20)\d{2})\s*(?:-|–|to)\s*((?:19|20)\d{2})/);
        if (!m) throw new ChartError(`Write periods as "2010-2015", not "${it}".`);
        const a = Math.max(FIRST_YEAR, Math.min(+m[1], +m[2])), b = Math.min(LAST_YEAR, Math.max(+m[1], +m[2]));
        return `${a}–${b}`;
      });
      if (items.length < 2) throw new ChartError("Give at least two periods to compare, e.g. 2010-2015 vs 2020-2025.");
    } else if (compareBy === "asset") {
      items = items.map(assetOf).filter(Boolean);
      if (items.length < 2) throw new ChartError("Name at least two assets to compare, e.g. SC-E-101 vs SC-P-102.");
    } else {
      items = items.length ? items.map((it) => pick(all, it, compareBy as string)) : all.slice(0, 6);
    }
    items = [...new Set(items)];
    metrics = metrics.length ? [...new Set(metrics)] : (["loss", "exposure", "days", "events", "maintenance"] as Metric[]);
    if (!metrics.includes(s.metric)) metrics = [s.metric, ...metrics].slice(0, 6);
    // The compared dimension cannot also be a filter.
    if (compareBy === "site") filters.site = "";
    if (compareBy === "asset") filters.asset = "";
    if (compareBy === "category") filters.category = "";
    if (compareBy === "mode") filters.mode = "";
    dimension = compareBy === "period" ? "year" : (compareBy as Dimension);
  } else {
    compareBy = null;
    items = [];
    metrics = [];
  }
  // A bubble chart is defined by its axes; its main measure is the Y axis (keeps recipes unique).
  return { type, metric: type === "bubble" && y ? y : s.metric, dimension, series, x, y, size, compareBy, items, metrics, filters, limit: s.limit };
}

export const specKey = (s: ChartSpec) => JSON.stringify(s);

// ---------- data ----------
function factsWithin(d: Dataset, f: ChartSpec["filters"], years?: [number, number]) {
  const tagToId = new Map(d.assets.map((a) => [a.tag, a.id]));
  const assets = new Map(d.assets.map((a) => [a.id, a]));
  const [from, to] = years ?? [f.from, f.to];
  const rows = d.incidents.filter((e) => {
    const a = assets.get(e.assetId);
    const yr = +e.date.slice(0, 4);
    return (
      !!a && yr >= from && yr <= to &&
      (!f.asset || e.assetId === tagToId.get(f.asset)) && (!f.site || a.site === f.site) && (!f.category || a.category === f.category) &&
      (!f.mode || e.mode === f.mode) && (!f.stage || e.stage === f.stage) && (!f.impact || e.impact === f.impact)
    );
  });
  return factsFor(d, rows);
}
function totalsBy(facts: Fact[], dim: Dimension, metric: Metric) {
  const m = new Map<string, number>();
  for (const f of facts) m.set(String(f[dim]), (m.get(String(f[dim])) || 0) + f[metric]);
  return m;
}
const yearsOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

function scopeText(s: ChartSpec) {
  const f = s.filters;
  return [f.asset, f.site, f.category, f.mode, f.stage ? `stage ${f.stage}` : "", f.impact].filter(Boolean).join(" · ") || "all sites";
}
function direction(values: number[]) {
  const third = Math.max(1, Math.floor(values.length / 3));
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
  const early = avg(values.slice(0, third)), late = avg(values.slice(-third));
  if (!early) return null;
  const p = Math.round(((late - early) / early) * 100);
  // "remained" works for singular and plural measures ("loss remained…", "events remained…").
  const short = Math.abs(p) < 5 ? "remained broadly flat" : `${p > 0 ? "rose" : "fell"} ${Math.abs(p)}%`;
  return { short, long: `${short} (${p >= 0 ? "+" : ""}${p}% from the first third of the period to the last)` };
}

// ---------- builder ----------
export function buildChart(d: Dataset, raw: unknown): BuiltChart {
  const spec = normalizeSpec(raw, d);
  const f = spec.filters;
  const range = `${f.from}–${f.to}`;
  const unit = metricUnit(spec.metric);
  const label = metricLabel(spec.metric);
  const base = {
    kind: "chart" as const,
    type: spec.type,
    spec,
    key: specKey(spec),
    metricLabel: label,
    unit,
    categories: [] as string[],
    series: [] as { name: string; values: number[] }[],
    points: [] as { label: string; x: number; y: number; size: number }[],
    axes: null as BuiltChart["axes"],
    note: "",
    filters: { site: f.site, category: f.category, asset: f.asset ? d.assets.find((a) => a.tag === f.asset)?.id ?? "" : "", mode: f.mode, from: f.from, to: f.to },
  };
  const v = (n: number, u: string = unit) => fmtValue(round(n, u), u);

  if (spec.type === "compare") return buildCompare(d, spec, base, v);

  const facts = factsWithin(d, f);
  if (!facts.length)
    return { ...base, title: `${label} · ${scopeText(spec)} · ${range}`, table: { columns: [], rows: [] }, headline: `No approved records match these filters (${scopeText(spec)}, ${range}).`, facts: [] };

  if (spec.type === "bubble") {
    const [xm, ym, sm] = [spec.x!, spec.y!, spec.size!];
    const groups = new Map<string, { x: number; y: number; size: number }>();
    for (const fc of facts) {
      const k = String(fc[spec.dimension]);
      const g = groups.get(k) || { x: 0, y: 0, size: 0 };
      g.x += fc[xm]; g.y += fc[ym]; g.size += fc[sm];
      groups.set(k, g);
    }
    let points = [...groups.entries()].map(([lbl, g]) => ({ label: lbl, x: round(g.x, metricUnit(xm)), y: round(g.y, metricUnit(ym)), size: round(g.size, metricUnit(sm)) }));
    points.sort((a, b) => b.size - a.size);
    const shown = Math.min(points.length, Math.max(spec.limit, 12));
    const note = points.length > shown ? `Showing the ${shown} largest of ${points.length} by ${metricLabel(sm).toLowerCase()}.` : "";
    points = points.slice(0, shown);
    const top = (k: "x" | "y" | "size") => points.reduce((a, b) => (b[k] > a[k] ? b : a), points[0]);
    const hy = top("y"), hx = top("x"), hs = top("size");
    return {
      ...base,
      title: `${metricLabel(xm)} vs ${metricLabel(ym)} (bubble: ${metricLabel(sm).toLowerCase()}) by ${dimLabel(spec.dimension).toLowerCase()} · ${scopeText(spec)} · ${range}`,
      points,
      axes: { x: `${metricLabel(xm)} (${metricUnit(xm)})`, y: `${metricLabel(ym)} (${metricUnit(ym)})`, size: `${metricLabel(sm)} (${metricUnit(sm)})` },
      note,
      table: { columns: [dimLabel(spec.dimension), metricLabel(xm), metricLabel(ym), metricLabel(sm)], rows: points.map((p) => [p.label, v(p.x, metricUnit(xm)), v(p.y, metricUnit(ym)), v(p.size, metricUnit(sm))]) },
      headline: `${hy.label} has the highest ${metricLabel(ym).toLowerCase()} (${v(hy.y, metricUnit(ym))}) by ${dimLabel(spec.dimension).toLowerCase()} (${scopeText(spec)}, ${range}).`,
      facts: [
        `Highest ${metricLabel(xm).toLowerCase()}: ${hx.label} (${v(hx.x, metricUnit(xm))}).`,
        `Largest bubble (${metricLabel(sm).toLowerCase()}): ${hs.label} (${v(hs.size, metricUnit(sm))}).`,
      ],
    };
  }

  const isYear = spec.dimension === "year";
  if (spec.series) {
    // Two dimensions: x categories × series (stacked, clustered, multi-line).
    const xTotals = totalsBy(facts, spec.dimension, spec.metric);
    const categories = isYear ? yearsOf(f.from, f.to) : [...xTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, spec.limit).map(([k]) => k);
    const sTotals = [...totalsBy(facts, spec.series, spec.metric).entries()].sort((a, b) => b[1] - a[1]);
    const keep = sTotals.slice(0, MAX_SERIES).map(([k]) => k);
    const withOther = spec.type === "stacked" && sTotals.length > MAX_SERIES;
    const names = withOther ? [...keep, "Other"] : keep;
    const cell = new Map<string, number>();
    for (const fc of facts) {
      const sx = String(fc[spec.dimension]);
      const ss = keep.includes(String(fc[spec.series])) ? String(fc[spec.series]) : withOther ? "Other" : null;
      if (!ss) continue;
      cell.set(`${sx}|${ss}`, (cell.get(`${sx}|${ss}`) || 0) + fc[spec.metric]);
    }
    const series = names.map((n) => ({ name: n, values: categories.map((c) => round(cell.get(`${c}|${n}`) || 0, unit)) }));
    const grand = sum(sTotals.map(([, t]) => t));
    const colTotals = categories.map((_, i) => sum(series.map((s) => s.values[i])));
    const peakIdx = colTotals.indexOf(Math.max(...colTotals));
    const lead = sTotals[0];
    const notes = [!isYear && xTotals.size > categories.length ? `Top ${categories.length} of ${xTotals.size} ${dimLabel(spec.dimension).toLowerCase()} values shown.` : "", !withOther && sTotals.length > MAX_SERIES ? `Top ${MAX_SERIES} of ${sTotals.length} ${dimLabel(spec.series).toLowerCase()} values shown.` : ""].filter(Boolean);
    const dir = isYear ? direction(colTotals) : null;
    return {
      ...base,
      title: `${label} by ${dimLabel(spec.dimension).toLowerCase()} and ${dimLabel(spec.series).toLowerCase()} · ${scopeText(spec)} · ${range}`,
      categories,
      series,
      note: notes.join(" "),
      table: { columns: [dimLabel(spec.dimension), ...names, "Total"], rows: categories.map((c, i) => [c, ...series.map((s) => v(s.values[i])), v(colTotals[i])]) },
      headline: `${lead[0]} contributes ${shareWords(pct(lead[1], grand))} of ${label.toLowerCase()} (${v(lead[1])} of ${v(grand)}), ${scopeText(spec)}, ${range}.`,
      facts: [
        ...sTotals.slice(1, 3).map(([k, t]) => `${k}: ${v(t)} (${pct(t, grand)}%).`),
        `Highest ${dimLabel(spec.dimension).toLowerCase()}: ${categories[peakIdx]} with ${v(colTotals[peakIdx])}.`,
        ...(dir ? [`Overall, ${label.toLowerCase()} ${dir.long}.`] : []),
      ],
    };
  }

  // One dimension.
  const totals = totalsBy(facts, spec.dimension, spec.metric);
  const grand = sum([...totals.values()]);
  let entries = isYear ? yearsOf(f.from, f.to).map((y) => [y, totals.get(y) || 0] as [string, number]) : [...totals.entries()].sort((a, b) => b[1] - a[1]);
  let note = "";
  if (!isYear && entries.length > spec.limit) {
    const rest = entries.slice(spec.limit);
    if (spec.type === "pie" || spec.type === "donut") {
      entries = [...entries.slice(0, spec.limit), [`Other (${rest.length})`, sum(rest.map(([, t]) => t))]];
    } else {
      note = `Top ${spec.limit} of ${entries.length} shown; total and shares cover all ${entries.length}.`;
      entries = entries.slice(0, spec.limit);
    }
  }
  const categories = entries.map(([k]) => k);
  const values = entries.map(([, t]) => round(t, unit));
  const table = {
    columns: [dimLabel(spec.dimension), `${label}`, ...(isYear ? [] : ["Share"])],
    rows: entries.map(([k, t]) => [k, v(t), ...(isYear ? [] : [`${pct(t, grand)}%`])]),
  };
  if (isYear) {
    const peakI = values.indexOf(Math.max(...values));
    const dir = direction(values);
    return {
      ...base,
      title: `${label} per year · ${scopeText(spec)} · ${range}`,
      categories,
      series: [{ name: label, values }],
      note,
      table,
      headline: `${label} in ${scopeText(spec)} totalled ${v(grand)} over ${range}${dir ? ` and ${dir.short}` : ""}, peaking at ${v(values[peakI])} in ${categories[peakI]}.`,
      facts: [`Latest: ${categories.slice(-3).map((c, i) => `${c}: ${v(values[values.length - 3 + i] ?? 0)}`).join("; ")}.`, ...(dir ? [`Direction: ${dir.long}.`] : [])],
    };
  }
  const [a, b] = entries;
  const top3 = pct(sum(entries.slice(0, 3).map(([, t]) => t)), grand);
  return {
    ...base,
    title: `${label} by ${dimLabel(spec.dimension).toLowerCase()} · ${scopeText(spec)} · ${range}`,
    categories,
    series: [{ name: label, values }],
    note,
    table,
    headline: `${a[0]} leads ${label.toLowerCase()} with ${v(a[1])}, ${shareWords(pct(a[1], grand))} of the ${v(grand)} total (${scopeText(spec)}, ${range}).`,
    facts: [
      ...(b ? [`Next: ${b[0]} with ${v(b[1])} (${pct(b[1], grand)}%).`] : []),
      ...(entries.length >= 3 ? [`Top 3 together: ${top3}% of the total.`] : []),
      `${totals.size} ${dimLabel(spec.dimension).toLowerCase()} value${totals.size === 1 ? "" : "s"} in scope.`,
    ],
  };
}

function buildCompare(d: Dataset, spec: ChartSpec, base: Omit<BuiltChart, "title" | "table" | "headline" | "facts">, v: (n: number, u?: string) => string): BuiltChart {
  const f = spec.filters;
  const isPeriod = spec.compareBy === "period";
  const values = new Map<string, Record<string, number>>();
  const lengths = new Map<string, number>();
  for (const item of spec.items) {
    let facts: Fact[];
    if (isPeriod) {
      const [a, b] = item.split("–").map(Number);
      facts = factsWithin(d, f, [a, b]);
      lengths.set(item, b - a + 1);
    } else {
      const scoped = { ...f, [spec.compareBy === "asset" ? "asset" : (spec.compareBy as string)]: item };
      facts = factsWithin(d, scoped);
    }
    values.set(item, Object.fromEntries(spec.metrics.map((m) => [m, sum(facts.map((x) => x[m]))])));
  }
  const unequal = isPeriod && new Set(lengths.values()).size > 1;
  const main = spec.metric;
  const mainVal = (item: string) => values.get(item)![main] / (unequal ? lengths.get(item)! : 1);
  const two = spec.items.length === 2;
  const diff = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "n/a");
  const rows = spec.metrics.map((m) => {
    const u = metricUnit(m);
    const cells = spec.items.map((it) => v(values.get(it)![m], u));
    return [metricLabel(m), ...cells, ...(two ? [diff(values.get(spec.items[0])![m], values.get(spec.items[1])![m])] : [])];
  });
  if (isPeriod) {
    rows.unshift(["Years", ...spec.items.map((it) => String(lengths.get(it))), ...(two ? [""] : [])]);
    if (unequal) rows.push([`${metricLabel(main)} per year`, ...spec.items.map((it) => v(mainVal(it), metricUnit(main))), ...(two ? [diff(mainVal(spec.items[0]), mainVal(spec.items[1]))] : [])]);
  }
  const scope = [f.asset, f.site, f.category, f.mode].filter(Boolean).join(" · ");
  const label = metricLabel(main).toLowerCase();
  const u = metricUnit(main);
  let headline: string;
  const facts: string[] = [];
  if (two) {
    const [a, b] = spec.items, va = mainVal(a), vb = mainVal(b);
    const p = vb ? Math.round(((va - vb) / vb) * 100) : null;
    headline =
      p === null
        ? `${b} has no recorded ${label}; ${a} has ${v(va, u)}.`
        : `${a}'s ${label}${unequal ? " per year" : ""} is ${p >= 100 ? `${(va / vb).toFixed(1)}× ${b}'s` : `${Math.abs(p)}% ${p >= 0 ? "higher" : "lower"} than ${b}'s`} (${v(va, u)} vs ${v(vb, u)})${scope ? `, ${scope}` : ""}${isPeriod ? "" : `, ${f.from}–${f.to}`}.`;
    for (const m of spec.metrics.filter((m) => m !== main).slice(0, 3)) {
      const x = values.get(a)![m], y = values.get(b)![m];
      facts.push(`${metricLabel(m)}: ${v(x, metricUnit(m))} vs ${v(y, metricUnit(m))} (${diff(x, y)}).`);
    }
  } else {
    const ranked = [...spec.items].sort((x, y) => mainVal(y) - mainVal(x));
    const grand = sum(spec.items.map(mainVal));
    headline = `${ranked[0]} leads ${label} among the ${spec.items.length} compared with ${v(mainVal(ranked[0]), u)}, ${shareWords(pct(mainVal(ranked[0]), grand))} of the compared total${isPeriod ? "" : ` (${f.from}–${f.to})`}.`;
    facts.push(`Lowest: ${ranked[ranked.length - 1]} with ${v(mainVal(ranked[ranked.length - 1]), u)}.`);
  }
  if (unequal) facts.push("Periods have different lengths, so the headline compares averages per year.");
  return {
    ...base,
    title: `Comparison by ${isPeriod ? "period" : dimLabel(spec.dimension).toLowerCase()}: ${spec.items.join(" vs ")}${scope ? ` · ${scope}` : ""}${isPeriod ? "" : ` · ${f.from}–${f.to}`}`,
    categories: spec.items,
    series: [{ name: `${metricLabel(main)}${unequal ? " per year" : ""}`, values: spec.items.map((it) => round(mainVal(it), u)) }],
    table: { columns: ["Measure", ...spec.items, ...(two ? ["Difference"] : [])], rows },
    headline,
    facts,
  };
}

// ---------- plain-English request parser (no AI needed) ----------
const TYPE_WORDS: [RegExp, ChartType][] = [
  [/\b(donut|doughnut)\b/, "donut"],
  [/\bpie\b/, "pie"],
  [/\b(bubble|scatter)\b/, "bubble"],
  [/\bstack(ed)?\b/, "stacked"],
  [/\b(cluster(ed)?|grouped)\b/, "clustered"],
  [/\barea (chart|graph)\b/, "area"],
  [/\bline\b/, "line"],
  [/\bhorizontal bar/, "hbar"],
  [/\b(bar|bars|column) ?(chart|graph)?\b/, "bar"],
];
export function chartTypeIn(q: string): ChartType | null {
  const t = q.toLowerCase();
  for (const [re, type] of TYPE_WORDS) if (re.test(t)) return type;
  if (/\b(table|tabulat\w*)\b/.test(t)) return "table";
  return null;
}
export function metricIn(q: string): Metric | null {
  // "failure mode" is a grouping, not the "failures" measure.
  const t = q.toLowerCase().replace(/\bfailure modes?\b/g, " ");
  if (/potential|exposure/.test(t)) return "exposure";
  if (/production|tonne/.test(t)) return "production";
  if (/maintenance/.test(t)) return "maintenance";
  if (/repair/.test(t)) return "repair";
  if (/downtime events|failures?\b|failure (count|history|events)|breakdowns?|events\b/.test(t)) return "events";
  if (/downtime|outage/.test(t)) return "days";
  if (/\bloss|cost|money|usd|\$|financial/.test(t)) return "loss";
  if (/\b(records|rirs?|incidents?|reports)\b/.test(t)) return "records";
  return null;
}
const DIM_PATTERNS: [RegExp, Dimension][] = [
  [/\b(per|by|each|every)\s+years?\b|\byearly\b|\bannual(ly)?\b|\bover time\b|\bover the years\b|\btrend\w*|\btimeline\b/, "year"],
  [/\b(by|per|each|across|between)\s+sites?\b|\bsite[- ]wise\b|\bwhich sites?\b/, "site"],
  [/\b(by|per|each|across)\s+(asset\s+)?categor(y|ies)\b|\bcategory[- ]wise\b|\bwhich categor(y|ies)\b/, "category"],
  [/\b(by|per|each)\s+(process\s+)?units?\b|\bwhich (process\s+)?units?\b/, "unit"],
  [/\b(by|per|each|across)\s+(assets?|equipment)\b|\basset[- ]wise\b/, "asset"],
  [/\b(by|per|each)\s+(failure\s+)?modes?\b|\bfailure modes\b|\bwhich failure modes?\b/, "mode"],
  [/\b(by|per)\s+(medfi\s+)?stages?\b|\bmedfi\b/, "stage"],
  [/\b(by|per)\s+impact\b|\bf1\s+(vs|and|versus)\s+f2\b/, "impact"],
];
export function dimsIn(q: string): Dimension[] {
  const t = q.toLowerCase();
  return DIM_PATTERNS.map(([re, dim]) => ({ dim, at: t.search(re) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.dim);
}
export function yearsIn(q: string): [number, number] {
  const t = q.toLowerCase();
  const ys = (t.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  const lastN = t.match(/\b(?:last|past)\s+(\d{1,2})\s+years?\b/);
  if (lastN) return [LAST_YEAR - Number(lastN[1]) + 1, LAST_YEAR];
  if (ys.length >= 2) return [Math.min(...ys), Math.max(...ys)];
  if (ys.length === 1) {
    if (/\b(since|after|from)\b/.test(t)) return [ys[0], LAST_YEAR];
    if (/\b(before|until|till|up to)\b/.test(t)) return [FIRST_YEAR, ys[0]];
    return [ys[0], ys[0]];
  }
  return [FIRST_YEAR, LAST_YEAR];
}

// Builds a recipe from plain English when the request names a chart type or a comparison.
// Returns null when unsure, so the AI (or another path) handles the question instead.
export function parseChartRequest(question: string, d: Dataset): ChartSpec | null {
  const t = question.toLowerCase();
  const sites = [...new Set(d.assets.map((a) => a.site))].filter((s) => t.includes(s.toLowerCase()));
  const categories = [...new Set(d.assets.map((a) => a.category))].filter((c) => new RegExp(`\\b${c.toLowerCase()}\\b`).test(t));
  const modes = [...new Set(d.incidents.map((e) => e.mode))].filter((m) => t.includes(m.toLowerCase()));
  const assets = d.assets.filter((a) => new RegExp(`(^|[^a-z0-9])${a.tag.toLowerCase().replace(/[-]/g, "\\-")}([^a-z0-9]|$)`).test(t)).map((a) => a.tag);
  const ranges = [...t.matchAll(/((?:19|20)\d{2})\s*(?:-|–|to)\s*((?:19|20)\d{2})/g)].map((m) => `${m[1]}-${m[2]}`);
  const compare = /\b(compar\w*|versus|vs\.?)\b/.test(t) || /comparative/.test(t);
  let type = chartTypeIn(t);
  const dims = dimsIn(t);
  const metric = metricIn(t) ?? "loss";
  let compareBy: ChartSpec["compareBy"] = null;
  let items: string[] = [];
  if (compare && (!type || type === "table" || type === "bar" || type === "clustered")) {
    if (ranges.length >= 2) [compareBy, items] = ["period", ranges];
    else if (assets.length >= 2) [compareBy, items] = ["asset", assets];
    else if (sites.length >= 2) [compareBy, items] = ["site", sites];
    else if (categories.length >= 2) [compareBy, items] = ["category", categories];
    else if (modes.length >= 2) [compareBy, items] = ["mode", modes];
    else if (dims.some((x) => ["site", "category", "mode"].includes(x)) || /\bsites\b|\bcategories\b/.test(t))
      compareBy = (dims.find((x) => ["site", "category", "mode"].includes(x)) as ChartSpec["compareBy"]) ?? (/\bcategories\b/.test(t) ? "category" : "site");
    if (compareBy) type = "compare";
  }
  // "How does X break down by unit?", "split by site", "distribution by failure mode", "share by category".
  if (!type && dims.some((x) => x !== "year") && /\b(break\s?down|broken down|split|distribution|distributed|composition|share|mix|spread)\b/.test(t))
    type = /\b(share|composition|mix)\b/.test(t) ? "donut" : "bar";
  if (!type) return null;
  if (type === "table" && !dims.length) return null; // "make a table" alone is a follow-up, handled elsewhere
  let dimension: Dimension;
  let series: Dimension | null = null;
  if (type === "line" || type === "area" || type === "stacked" || type === "clustered") {
    dimension = dims.includes("year") ? "year" : dims[0] ?? "year";
    series = dims.find((x) => x !== dimension) ?? null;
  } else {
    dimension = dims.find((x) => x !== "year") ?? (type === "bar" && dims.includes("year") ? "year" : "site");
    if (type === "table" && dims[0]) dimension = dims[0];
  }
  const [from, to] = compareBy === "period" ? [FIRST_YEAR, LAST_YEAR] : yearsIn(t);
  const filters = {
    asset: compareBy === "asset" ? "" : assets.length === 1 ? assets[0] : "",
    site: compareBy === "site" || dimension === "site" ? "" : sites.length === 1 ? sites[0] : "",
    category: compareBy === "category" || dimension === "category" ? "" : categories.length === 1 ? categories[0] : "",
    mode: compareBy === "mode" || dimension === "mode" ? "" : modes.length === 1 ? modes[0] : "",
    from,
    to,
  };
  const n = t.match(/\btop\s+(\d{1,2})\b/);
  // Bubble axes from "X vs Y" (and "sized by Z").
  let axes: { x?: Metric; y?: Metric; size?: Metric } = {};
  if (type === "bubble") {
    const [left, right = ""] = t.split(/\b(?:vs\.?|versus|against)\b/);
    const sized = t.match(/\b(?:sized? by|bubble size(?: is)?)\s+(.+)$/);
    axes = {
      x: metricIn(left.split(/\bof\b/).pop() ?? left) ?? undefined,
      y: metricIn(right.split(/\b(?:by|per|sized?)\b/)[0]) ?? undefined,
      size: sized ? metricIn(sized[1]) ?? undefined : undefined,
    };
  }
  try {
    return normalizeSpec({ type, metric, dimension, series, compareBy, items, filters, ...axes, ...(n ? { limit: Math.min(20, Math.max(3, +n[1])) } : {}) }, d);
  } catch {
    return null;
  }
}

// Guard on the AI's chart choice: whatever the question states explicitly (chart type, measure,
// grouping, site, category, failure mode, asset, years) overrides the AI's pick. The AI only
// fills in what the question leaves open.
export function reconcileWithQuestion(raw: Record<string, unknown>, question: string, d: Dataset): Record<string, unknown> {
  const t = question.toLowerCase();
  const out: Record<string, unknown> = { ...raw, filters: { ...((raw.filters as Record<string, unknown>) ?? {}) } };
  if (out.type === "compare") return out;
  const type = chartTypeIn(t);
  if (type && type !== "table") out.type = type;
  const metric = metricIn(t);
  if (metric) out.metric = metric;
  const dims = dimsIn(t);
  const twoWay = ["line", "area", "stacked", "clustered"].includes(String(out.type));
  if (dims.length) {
    const main = twoWay && dims.includes("year") ? "year" : dims.find((x) => x !== "year") ?? dims[0];
    out.dimension = main;
    out.series = dims.find((x) => x !== main) ?? (type && twoWay ? out.series ?? "" : "");
  }
  // A second grouping the user never asked for is dropped.
  if (!type && dims.length < 2 && (out.type === "stacked" || out.type === "clustered")) {
    out.type = "bar";
    out.series = "";
  }
  const f = out.filters as Record<string, unknown>;
  const sites = [...new Set(d.assets.map((a) => a.site))].filter((s) => t.includes(s.toLowerCase()));
  const categories = [...new Set(d.assets.map((a) => a.category))].filter((c) => new RegExp(`\\b${c.toLowerCase()}\\b`).test(t));
  const modes = [...new Set(d.incidents.map((e) => e.mode))].filter((m) => t.includes(m.toLowerCase()));
  const assets = d.assets.filter((a) => t.includes(a.tag.toLowerCase()));
  if (sites.length === 1 && out.dimension !== "site") f.site = sites[0];
  if (categories.length === 1 && out.dimension !== "category") f.category = categories[0];
  if (modes.length === 1 && out.dimension !== "mode") f.mode = modes[0];
  if (assets.length === 1) f.asset = assets[0].tag;
  if (/\b(?:19|20)\d{2}\b|\b(?:last|past)\s+\d{1,2}\s+years?\b/.test(t)) [f.from, f.to] = yearsIn(t);
  return out;
}

// JSON schema for the AI's build_chart tool (the same menu as ChartSpec).
export const BUILD_CHART_PARAMETERS = {
  type: "object",
  properties: {
    type: { type: "string", enum: [...CHART_TYPES], description: "pie/donut = share of total; bar/hbar = ranking or per year; line/area = over time; stacked/clustered = two groupings; bubble = three measures; table; compare = side-by-side." },
    metric: { type: "string", enum: METRIC_KEYS, description: "events = failures (downtime events), days = downtime, loss = actual loss USD, exposure = potential loss USD, production = tonnes lost, maintenance = USD, repair = hours, records = RIR count." },
    dimension: { type: "string", enum: DIM_KEYS, description: "Grouping (x axis / slices). year for time." },
    series: { type: "string", enum: ["", ...DIM_KEYS], description: "Second grouping for stacked/clustered/line, else empty." },
    x: { type: "string", enum: ["", ...METRIC_KEYS], description: "Bubble only." },
    y: { type: "string", enum: ["", ...METRIC_KEYS], description: "Bubble only." },
    size: { type: "string", enum: ["", ...METRIC_KEYS], description: "Bubble only." },
    compareBy: { type: "string", enum: ["", ...COMPARE_BY], description: "Compare only." },
    items: { type: "array", items: { type: "string" }, description: "Compare only: sites, categories, asset tags, failure modes, or periods like 2010-2015." },
    filters: {
      type: "object",
      properties: {
        asset: { type: "string" }, site: { type: "string" }, category: { type: "string" }, mode: { type: "string" },
        from: { type: "integer" }, to: { type: "integer" },
      },
    },
    limit: { type: "integer", description: "3-20, default 10." },
  },
  required: ["type", "metric", "dimension"],
} as const;
