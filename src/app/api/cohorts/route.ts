import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { currentMonthMsk } from "@/lib/kpi";

export const dynamic = "force-dynamic";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Когорты по месяцу входа (clients.created_at). Возраст = полные месяцы от входа.
 * revCells — касса когорты в возрасте age (sales_ledger); visitCells — активные
 * по визитам (client_visits). Всё в Europe/Moscow.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const months = clamp(Number(url.searchParams.get("months")) || 12, 1, 60);
  const maxAge = clamp(Number(url.searchParams.get("maxAge")) || 12, 1, 36);
  const current = currentMonthMsk();
  const [cy, cm] = current.split("-").map(Number);
  const cd = new Date(cy, cm - 1 - (months - 1), 1);
  const cutoff = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, "0")}`;

  const cohortsCte = sql`
    cohorts AS (
      SELECT fitbase_id AS client_id,
        date_trunc('month', (created_at AT TIME ZONE 'Europe/Moscow')) AS cstart,
        to_char((created_at AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM') AS cohort
      FROM clients WHERE created_at IS NOT NULL
    )
  `;

  const sizes = await db.execute(sql`
    SELECT to_char((created_at AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM') AS cohort, COUNT(*)::int AS clients
    FROM clients
    WHERE created_at IS NOT NULL
      AND to_char((created_at AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM') >= ${cutoff}
    GROUP BY 1
    ORDER BY 1
  `);

  const rev = await db.execute(sql`
    WITH ${cohortsCte}
    SELECT cohort, age, SUM(revenue) AS revenue FROM (
      SELECT co.cohort AS cohort,
        ((extract(year from p.pd) - extract(year from co.cstart)) * 12
         + (extract(month from p.pd) - extract(month from co.cstart)))::int AS age,
        p.amount AS revenue
      FROM cohorts co
      JOIN (
        SELECT client_id, (pay_date AT TIME ZONE 'Europe/Moscow') AS pd, amount
        FROM sales_ledger WHERE client_id IS NOT NULL AND pay_date IS NOT NULL
      ) p ON p.client_id = co.client_id
      WHERE co.cohort >= ${cutoff}
    ) t
    WHERE age >= 0 AND age <= ${maxAge}
    GROUP BY cohort, age
  `);

  const vis = await db.execute(sql`
    WITH ${cohortsCte}
    SELECT cohort, age, COUNT(DISTINCT client_id) AS active FROM (
      SELECT co.cohort AS cohort, co.client_id AS client_id,
        ((extract(year from v.st) - extract(year from co.cstart)) * 12
         + (extract(month from v.st) - extract(month from co.cstart)))::int AS age
      FROM cohorts co
      JOIN (
        SELECT client_id, (start_at AT TIME ZONE 'Europe/Moscow') AS st
        FROM client_visits WHERE client_id IS NOT NULL AND start_at IS NOT NULL
      ) v ON v.client_id = co.client_id
      WHERE co.cohort >= ${cutoff}
    ) t
    WHERE age >= 0 AND age <= ${maxAge}
    GROUP BY cohort, age
  `);

  // Средний CAC (blended, за всё время) — для маркера окупаемости.
  const cacRow = await db.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(cost),0) FROM daily_metrics) AS cost,
      (SELECT COUNT(*) FROM clients WHERE created_at IS NOT NULL) AS clients
  `);
  const totalCost = Number(cacRow.rows[0]?.cost ?? 0);
  const totalClients = Number(cacRow.rows[0]?.clients ?? 0);
  const cacBlended = totalClients > 0 ? totalCost / totalClients : null;

  return NextResponse.json({
    currentMonth: current,
    maxAge,
    cacBlended,
    sizes: sizes.rows.map((r) => ({ cohort: String(r.cohort), clients: Number(r.clients) })),
    revCells: rev.rows.map((r) => ({ cohort: String(r.cohort), age: Number(r.age), revenue: Number(r.revenue) })),
    visitCells: vis.rows.map((r) => ({ cohort: String(r.cohort), age: Number(r.age), active: Number(r.active) })),
  });
}
