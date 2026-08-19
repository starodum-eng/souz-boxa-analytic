import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { KPI_KEYS, currentMonthMsk } from "@/lib/kpi";

export const dynamic = "force-dynamic";

const { kpiTargets } = schema;
const validMonth = (s: string | null) => (s && /^\d{4}-\d{2}$/.test(s) ? s : null);

// GET ?month=YYYY-MM → { month, targets: { metric: number } }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = validMonth(url.searchParams.get("month")) ?? currentMonthMsk();
  const rows = await db.select().from(kpiTargets).where(eq(kpiTargets.month, month));
  const targets: Record<string, number> = {};
  for (const r of rows) targets[r.metric] = Number(r.target);
  return NextResponse.json({ month, targets });
}

// POST { month, metric, target } → upsert; пустой/невалидный target → удалить цель.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { month?: string; metric?: string; target?: unknown };
  const month = validMonth(body.month ?? null);
  const metric = body.metric ?? "";
  if (!month || !KPI_KEYS.has(metric)) {
    return NextResponse.json({ error: "Некорректный month или metric" }, { status: 400 });
  }

  const raw = body.target;
  const numVal = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(",", "."));
  const isEmpty = raw === "" || raw == null || !Number.isFinite(numVal);

  if (isEmpty) {
    await db.delete(kpiTargets).where(and(eq(kpiTargets.month, month), eq(kpiTargets.metric, metric)));
    return NextResponse.json({ ok: true, removed: true, month, metric });
  }

  await db
    .insert(kpiTargets)
    .values({ month, metric, target: String(numVal), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [kpiTargets.month, kpiTargets.metric],
      set: { target: String(numVal), updatedAt: new Date() },
    });
  return NextResponse.json({ ok: true, month, metric, target: numVal });
}
