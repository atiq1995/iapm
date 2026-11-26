// Saved reports for Relia (per account): list, save, rename, delete.
// A report is a chart recipe; it is validated against the owner's data before saving.
// Running a report goes through POST /api/assistant with { reportId }.

import { z } from "zod";
import { identity, sameOrigin } from "@/lib/auth";
import { ownerData } from "@/lib/owner-data";
import { ChartError } from "@/lib/assistant/charts";
import { cleanName, deleteReport, listReports, renameReport, saveReport } from "@/lib/assistant/reports";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const summary = (r: { id: string; name: string; spec: { type: string }; updatedAt: string }) => ({ id: r.id, name: r.name, type: r.spec.type, updatedAt: r.updatedAt });

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), name: z.string().max(200), spec: z.record(z.unknown()), question: z.string().max(2000).optional() }).strict(),
  z.object({ action: z.literal("rename"), id: z.string().max(100), name: z.string().max(200) }).strict(),
  z.object({ action: z.literal("delete"), id: z.string().max(100) }).strict(),
]);

export async function GET() {
  try {
    const user = await identity();
    if (!user) return fail("Session expired", 401);
    return Response.json({ reports: (await listReports(user.userId)).map(summary) }, { headers });
  } catch {
    return fail("Saved reports unavailable", 503);
  }
}

export async function POST(req: Request) {
  try {
    const user = await identity();
    if (!user) return fail("Session expired", 401);
    if (!sameOrigin(req)) return fail("Request rejected", 403);
    const raw = await req.text();
    if (raw.length > 20000) return fail("Request too large.", 413);
    let parsed;
    try {
      parsed = body.safeParse(JSON.parse(raw));
    } catch {
      return fail("Invalid request.", 400);
    }
    if (!parsed.success) return fail("Invalid report request.", 400);
    const b = parsed.data;
    if (b.action === "save") {
      if (!cleanName(b.name)) return fail("Give the report a name.", 400);
      const data = await ownerData(user.userId);
      const { report, existing } = await saveReport(user.userId, data, b.name, b.spec, b.question ?? "");
      return Response.json({ report: summary(report), existing }, { headers });
    }
    if (b.action === "rename") {
      if (!cleanName(b.name)) return fail("Give the report a name.", 400);
      const report = await renameReport(user.userId, b.id, b.name);
      return report ? Response.json({ report: summary(report) }, { headers }) : fail("Saved report not found.", 404);
    }
    const deleted = await deleteReport(user.userId, b.id);
    return deleted ? Response.json({ ok: true }, { headers }) : fail("Saved report not found.", 404);
  } catch (e) {
    if (e instanceof ChartError) return fail(e.message, 400);
    if (e instanceof Error && /saved reports/.test(e.message)) return fail(e.message, 409);
    return fail("Unable to update saved reports. Please retry.", 503);
  }
}
