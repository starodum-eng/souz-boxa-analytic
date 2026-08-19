import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { KPI_METRICS, currentMonthMsk } from "@/lib/kpi";

export const dynamic = "force-dynamic";

const { kpiTargets } = schema;
const validMonth = (s: string | null) => (s && /^\d{4}-\d{2}$/.test(s) ? s : null);

/** Сегодняшняя дата 'YYYY-MM-DD' в Europe/Moscow. */
function todayMsk(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = validMonth(url.searchParams.get("month")) ?? currentMonthMsk();
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const today = todayMsk();
  // Границы факта: [первое число … min(сегодня, конец месяца)]; будущий месяц → пусто.
  const factTo = today < monthStart ? null : today > monthEnd ? monthEnd : today;
  const daysElapsed = factTo ? Number(factTo.slice(8, 10)) : 0;

  const zero = { cost: 0, leads: 0, visits: 0, revenue: 0, new_clients: 0, paid_new: 0 };
  let f = zero;
  if (factTo) {
    const ad = await db.execute(sql`
      SELECT COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(leads),0) AS leads, COALESCE(SUM(visits),0) AS visits
      FROM daily_metrics WHERE date >= ${monthStart} AND date <= ${factTo}
    `);
    const rev = await db.execute(sql`
      SELECT COALESCE(SUM(amount),0) AS revenue FROM sales_ledger
      WHERE pay_date IS NOT NULL
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= ${monthStart}
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date <= ${factTo}
    `);
    const cl = await db.execute(sql`
      SELECT COUNT(*)::int AS new_clients FROM clients
      WHERE (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${monthStart}
        AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${factTo}
    `);
    const pay = await db.execute(sql`
      SELECT COUNT(*)::int AS paid_new FROM clients c
      WHERE (c.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${monthStart}
        AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${factTo}
        AND EXISTS (SELECT 1 FROM sales_ledger s WHERE s.client_id = c.fitbase_id AND s.amount > 0)
    `);
    f = {
      cost: Number(ad.rows[0]?.cost ?? 0),
      leads: Number(ad.rows[0]?.leads ?? 0),
      visits: Number(ad.rows[0]?.visits ?? 0),
      revenue: Number(rev.rows[0]?.revenue ?? 0),
      new_clients: Number(cl.rows[0]?.new_clients ?? 0),
      paid_new: Number(pay.rows[0]?.paid_new ?? 0),
    };
  }

  const tRows = await db.select().from(kpiTargets).where(eq(kpiTargets.month, month));
  const targets: Record<string, number> = {};
  for (const r of tRows) targets[r.metric] = Number(r.target);

  // Факт по метрике (проценты приводим к тем же единицам, что цели: доля × 100).
  const fact: Record<string, number | null> = {
    leads: f.leads,
    new_clients: f.new_clients,
    revenue: f.revenue,
    cost: f.cost,
    cpl: f.leads > 0 ? f.cost / f.leads : null,
    cac: f.new_clients > 0 ? f.cost / f.new_clients : null,
    drr: f.revenue > 0 ? (f.cost / f.revenue) * 100 : null,
    romi: f.cost > 0 ? ((f.revenue - f.cost) / f.cost) * 100 : null,
    conv_lead: f.visits > 0 ? (f.leads / f.visits) * 100 : null,
    conv_sale: f.new_clients > 0 ? (f.paid_new / f.new_clients) * 100 : null,
  };

  const rows = KPI_METRICS.map((mt) => {
    const factVal = fact[mt.key] ?? null;
    const target = targets[mt.key] ?? null;
    const forecast =
      mt.type === "flow" && factVal != null
        ? daysElapsed > 0
          ? (factVal / daysElapsed) * daysInMonth
          : factVal
        : null;
    const compareVal = mt.type === "flow" ? forecast : factVal;

    let status: "green" | "yellow" | "red" | "none" = "none";
    if (target != null && compareVal != null) {
      if (mt.dir === "up") {
        status = compareVal >= target ? "green" : compareVal >= 0.9 * target ? "yellow" : "red";
      } else {
        status = compareVal <= target ? "green" : compareVal <= 1.1 * target ? "yellow" : "red";
      }
    }
    const pct = target != null && target !== 0 && factVal != null ? factVal / target : null;

    return {
      key: mt.key,
      label: mt.label,
      unit: mt.unit,
      dir: mt.dir,
      type: mt.type,
      fact: factVal,
      target,
      forecast,
      pct,
      status,
    };
  });

  return NextResponse.json({ month, daysElapsed, daysInMonth, rows });
}
