// Saved reports: Relia's own library of chart recipes, per account.
// A report stores the recipe (type, measure, grouping, filters), never numbers, so running it
// always shows current data. Plant data stays read-only: these rows live in Relia's library,
// like chat history.

import { db } from "@/lib/auth";
import { putRecord, readRecords } from "@/lib/ai-service";
import type { Dataset } from "@/lib/domain";
import { chartTypeIn, dimsIn, metricIn, normalizeSpec, parseChartRequest, specKey, type ChartSpec } from "./charts";
import { isReferentialFollowUp } from "./engine";

export const REPORT_KIND = "relia_report";
export const MAX_REPORTS = 100;

export type SavedReport = { id: string; name: string; spec: ChartSpec; key: string; question: string; createdAt: string; updatedAt: string };

export const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) : "");

export async function listReports(owner: string): Promise<SavedReport[]> {
  return (await readRecords(owner, REPORT_KIND)).filter((r) => r && typeof r.id === "string" && r.spec) as SavedReport[];
}

export async function saveReport(owner: string, d: Dataset, name: string, rawSpec: unknown, question: string) {
  const spec = normalizeSpec(rawSpec, d);
  const key = specKey(spec);
  const reports = await listReports(owner);
  const existing = reports.find((r) => r.key === key);
  if (existing) return { report: existing, existing: true };
  if (reports.length >= MAX_REPORTS) throw new Error(`You can keep up to ${MAX_REPORTS} saved reports. Delete one to save another.`);
  const now = new Date().toISOString();
  const report: SavedReport = { id: crypto.randomUUID(), name: cleanName(name) || "Saved report", spec, key, question: cleanName(question), createdAt: now, updatedAt: now };
  await putRecord(owner, REPORT_KIND, report.id, report);
  return { report, existing: false };
}

export async function renameReport(owner: string, id: string, name: string) {
  const report = (await listReports(owner)).find((r) => r.id === id);
  if (!report) return null;
  const updated = { ...report, name: cleanName(name) || report.name, updatedAt: new Date().toISOString() };
  await putRecord(owner, REPORT_KIND, id, updated);
  return updated;
}

export async function deleteReport(owner: string, id: string) {
  const r = await db().prepare("DELETE FROM records WHERE id=? AND owner=? AND kind=?").bind(`${owner}:${REPORT_KIND}:${id}`, owner, REPORT_KIND).run();
  return (r.meta?.changes ?? 0) > 0;
}

// "show", "open", "run", "my", "report"… are ignored when matching a question to a saved report name.
const FILLER = /\b(show|open|run|display|get|give|see|view|pull up|bring up|me|my|the|a|an|please|saved|report|chart|again|can you|could you|i want|i'd like)\b/g;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();

// A question that names a saved report (or repeats the question that created it) runs that report.
export function matchReportByName(question: string, reports: SavedReport[]) {
  const q = norm(question);
  if (!q) return null;
  return reports.find((r) => norm(r.name) === q || (r.question && norm(r.question) === q)) ?? null;
}

type PriorChart = { kind?: string; spec?: ChartSpec };

// The chart recipe for this question: plain English first; for short follow-ups ("make it a donut",
// "show it as a table") the previous chart's recipe with the new type.
export function chartSpecForQuestion(question: string, d: Dataset, previousCharts: PriorChart[]): ChartSpec | null {
  const prior = [...previousCharts].reverse().find((c) => c?.spec)?.spec;
  const t = question.toLowerCase();
  const names = [...new Set(d.assets.map((a) => a.site.toLowerCase()))].some((s) => t.includes(s)) || d.assets.some((a) => t.includes(a.tag.toLowerCase()));
  const typeOnly = !!chartTypeIn(question) && !metricIn(question) && !dimsIn(question).length && !names && question.trim().split(/\s+/).length <= 10;
  if (prior && (typeOnly || isReferentialFollowUp(question, d))) {
    const type = chartTypeIn(question) ?? (/\b(table|tabulat\w*|summary)\b/i.test(question) ? "table" : prior.type);
    let next: Record<string, unknown> = { ...prior, type };
    // A comparison shown as pie/donut/line etc. becomes a grouping by the compared dimension.
    if (prior.type === "compare" && !["compare", "table", "bar", "clustered"].includes(type)) {
      next = { ...prior, type, dimension: prior.compareBy === "period" ? "year" : prior.compareBy, compareBy: null, items: [], metrics: [] };
    }
    if (type === "compare" && prior.type !== "compare") next = { ...prior, type: "bar" };
    try {
      return normalizeSpec(next, d);
    } catch {
      return null;
    }
  }
  return parseChartRequest(question, d);
}
