import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Данные для дашборда удержания:
 *  - сводка (активные абонементы, заканчиваются, истекли, не ходят);
 *  - структура продаж по статусу (новый / продление / возвращение) за 30 дней;
 *  - «кому звонить» — абонементы, что заканчиваются/истекли и не продлены;
 *  - «не ходят» — активный абонемент, но нет визитов 14+ дней.
 *
 * Абонемент клиента = его последний по дате окончания контракт (latest).
 */
export async function GET() {
  // Последний абонемент каждого клиента + имя/телефон + последний визит.
  const base = sql`
    WITH latest AS (
      SELECT DISTINCT ON (cc.client_id)
        cc.client_id,
        cc.end_date,
        cc.begin_date,
        cc.amount,
        COALESCE(cc.raw->'ticket'->'contract_item'->>'name', cc.raw->>'contract_name') AS tariff
      FROM client_contracts cc
      WHERE cc.client_id IS NOT NULL AND cc.end_date IS NOT NULL
      ORDER BY cc.client_id, cc.end_date DESC
    ),
    lastvisit AS (
      SELECT client_id, MAX(start_at) AS last_visit
      FROM client_visits WHERE client_id IS NOT NULL GROUP BY client_id
    ),
    enriched AS (
      SELECT l.*, cl.name, cl.phone, lv.last_visit,
        (l.end_date AT TIME ZONE 'Europe/Moscow')::date AS end_d,
        (now() AT TIME ZONE 'Europe/Moscow')::date AS today
      FROM latest l
      JOIN clients cl ON cl.fitbase_id = l.client_id
      LEFT JOIN lastvisit lv ON lv.client_id = l.client_id
    )
  `;

  const summary = await db.execute(sql`
    ${base}
    SELECT
      COUNT(*) FILTER (WHERE end_d >= today)                                   AS active,
      COUNT(*) FILTER (WHERE end_d >= today AND end_d <= today + 14)           AS ending_14d,
      COUNT(*) FILTER (WHERE end_d < today AND end_d >= today - 7)             AS expired_7d,
      COUNT(*) FILTER (WHERE end_d >= today
                         AND (last_visit IS NULL
                              OR (last_visit AT TIME ZONE 'Europe/Moscow')::date < today - 14)) AS no_visit_14d
    FROM enriched
  `);

  // Структура продаж за 30 дней по статусу продления (из журнала sales_ledger).
  const salesStructure = await db.execute(sql`
    SELECT
      CASE COALESCE(NULLIF(raw->>'renewal',''), '—')
        WHEN 'Новый' THEN 'Новые'
        WHEN 'Продление' THEN 'Продления'
        WHEN 'Возвращение' THEN 'Возвращения'
        ELSE 'Услуги/прочее'
      END AS status,
      COUNT(*)::int AS cnt,
      COALESCE(SUM(amount),0) AS sum
    FROM sales_ledger
    WHERE pay_date IS NOT NULL
      AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= (now() AT TIME ZONE 'Europe/Moscow')::date - 30
    GROUP BY 1
    ORDER BY sum DESC
  `);

  // «Кому звонить»: абонемент заканчивается в ближайшие 14 дней ИЛИ истёк за последние 7.
  const callList = await db.execute(sql`
    ${base}
    SELECT client_id, name, phone, tariff, end_d,
      (end_d - today) AS days_left,
      (last_visit AT TIME ZONE 'Europe/Moscow')::date AS last_visit_d,
      CASE WHEN end_d < today THEN 'истёк' ELSE 'заканчивается' END AS state
    FROM enriched
    WHERE end_d >= today - 7 AND end_d <= today + 14
    ORDER BY end_d ASC
    LIMIT 300
  `);

  // «Не ходят»: активный абонемент, но нет визитов 14+ дней (или вовсе).
  const atRisk = await db.execute(sql`
    ${base}
    SELECT client_id, name, phone, tariff, end_d,
      (last_visit AT TIME ZONE 'Europe/Moscow')::date AS last_visit_d,
      (today - (last_visit AT TIME ZONE 'Europe/Moscow')::date) AS days_since_visit
    FROM enriched
    WHERE end_d >= today
      AND (last_visit IS NULL OR (last_visit AT TIME ZONE 'Europe/Moscow')::date < today - 14)
    ORDER BY last_visit NULLS FIRST
    LIMIT 300
  `);

  return NextResponse.json({
    summary: summary.rows[0] ?? {},
    salesStructure: salesStructure.rows,
    callList: callList.rows,
    atRisk: atRisk.rows,
  });
}
