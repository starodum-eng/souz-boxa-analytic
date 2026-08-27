import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { recomputeDailyMetrics } from "@/lib/etl";

export const dynamic = "force-dynamic";

const { manualCosts } = schema;

/**
 * Ручные расходы по каналам с амортизацией по периоду (ТЗ №19).
 * Признанная на сегодня сумма = amount × (прошедшие дни ÷ всего дней периода).
 */
export async function GET() {
  const rows = await db.execute(sql`
    SELECT
      id, channel, amount, period_from, period_to, note, created_at,
      (period_to - period_from) + 1 AS total_days,
      LEAST(CURRENT_DATE, period_to) - period_from + 1 AS elapsed_days_raw
    FROM manual_costs
    ORDER BY created_at DESC
  `);
  const items = (rows.rows as Array<Record<string, unknown>>).map((r) => {
    const amount = Number(r.amount) || 0;
    const totalDays = Math.max(1, Number(r.total_days) || 1);
    // прошедшие дни в пределах [0, totalDays]
    const elapsed = Math.max(0, Math.min(totalDays, Number(r.elapsed_days_raw) || 0));
    const recognizedToDate = Math.round(((amount * elapsed) / totalDays) * 100) / 100;
    const progress = Math.round((elapsed / totalDays) * 100);
    return {
      id: Number(r.id),
      channel: String(r.channel),
      amount,
      periodFrom: r.period_from,
      periodTo: r.period_to,
      note: r.note ?? null,
      createdAt: r.created_at,
      recognizedToDate,
      progress,
    };
  });
  return NextResponse.json({ items });
}

/** Добавить ручной расход. Тело: { channel, amount, periodFrom, periodTo, note }. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const channel = String(body?.channel ?? "").trim();
  const amount = Number(body?.amount);
  const periodFrom = String(body?.periodFrom ?? "").trim();
  const periodTo = String(body?.periodTo ?? "").trim();
  const note = String(body?.note ?? "").trim() || null;

  if (!channel) return NextResponse.json({ error: "Укажите канал" }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ error: "Сумма должна быть больше 0" }, { status: 400 });
  if (!periodFrom || !periodTo) return NextResponse.json({ error: "Укажите период" }, { status: 400 });
  if (periodTo < periodFrom) return NextResponse.json({ error: "Конец периода раньше начала" }, { status: 400 });

  await db.insert(manualCosts).values({
    channel,
    amount: String(amount),
    periodFrom,
    periodTo,
    note: note?.slice(0, 512) ?? null,
  });
  await recomputeDailyMetrics(); // размазать расход по дням в витрину
  return NextResponse.json({ ok: true });
}

/** Удалить ручной расход. Тело: { id }. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.execute(sql`DELETE FROM manual_costs WHERE id = ${id}`);
  await recomputeDailyMetrics();
  return NextResponse.json({ ok: true });
}
