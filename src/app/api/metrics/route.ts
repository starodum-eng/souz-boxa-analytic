import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Данные для дашборда, читаются из витрины daily_metrics.
 * ?days=30 — окно; по умолчанию 30 дней.
 * Возвращаем: итоги, разбивку по источникам и дневную динамику.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);

  const totals = await db.execute(sql`
    SELECT
      COALESCE(SUM(cost), 0)        AS cost,
      COALESCE(SUM(clicks), 0)      AS clicks,
      COALESCE(SUM(visits), 0)      AS visits,
      COALESCE(SUM(leads), 0)       AS leads,
      COALESCE(SUM(sales_count), 0) AS sales_count,
      COALESCE(SUM(revenue), 0)     AS revenue
    FROM daily_metrics
    WHERE date >= CURRENT_DATE - ${days}::int
  `);

  const bySource = await db.execute(sql`
    SELECT
      source,
      COALESCE(SUM(cost), 0)        AS cost,
      COALESCE(SUM(leads), 0)       AS leads,
      COALESCE(SUM(sales_count), 0) AS sales_count,
      COALESCE(SUM(revenue), 0)     AS revenue,
      CASE WHEN SUM(leads) > 0 THEN ROUND(SUM(cost)/SUM(leads), 2) END AS cpl,
      CASE WHEN SUM(sales_count) > 0 THEN ROUND(SUM(cost)/SUM(sales_count), 2) END AS cac,
      CASE WHEN SUM(cost) > 0 THEN ROUND((SUM(revenue)-SUM(cost))/SUM(cost), 4) END AS romi
    FROM daily_metrics
    WHERE date >= CURRENT_DATE - ${days}::int
    GROUP BY source
    ORDER BY cost DESC
  `);

  // Клиенты, привязанные к каналу по телефону (склейка Fitbase ↔ касания форм/Callibri).
  // Берём первое касание по номеру телефона, из него — источник.
  const clientsBySource = await db.execute(sql`
    WITH ft AS (
      SELECT DISTINCT ON (phone_norm)
        phone_norm, lower(utm_source) AS utm_source
      FROM lead_touches
      WHERE phone_norm IS NOT NULL AND coalesce(utm_source,'') <> ''
      ORDER BY phone_norm, created_at ASC
    ),
    matched AS (
      SELECT
        CASE
          WHEN coalesce(m.label,'') <> '' THEN m.label
          WHEN ft.utm_source LIKE '%yandex%' OR ft.utm_source LIKE '%direct%' THEN 'Яндекс.Директ'
          WHEN ft.utm_source LIKE '%vk%' THEN 'VK Реклама'
          ELSE 'Сайт (прочее)'
        END AS source
      FROM clients c
      JOIN ft ON ft.phone_norm = right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 10)
      LEFT JOIN source_mappings m ON m.utm_source = ft.utm_source
      WHERE c.created_at >= CURRENT_DATE - ${days}::int
    )
    SELECT source, COUNT(*)::int AS clients
    FROM matched GROUP BY source
  `);

  // Сводка по дням за последние 5 дней (те же метрики, что и по источникам,
  // плюс новые клиенты Fitbase по дате регистрации).
  const byDate = await db.execute(sql`
    WITH dm AS (
      SELECT date,
        SUM(cost) AS cost, SUM(leads) AS leads,
        SUM(sales_count) AS sales_count, SUM(revenue) AS revenue
      FROM daily_metrics GROUP BY date
    ),
    cl AS (
      SELECT created_at::date AS date, COUNT(*) AS clients
      FROM clients WHERE created_at IS NOT NULL GROUP BY 1
    ),
    dates AS (
      SELECT date FROM dm UNION SELECT date FROM cl
    )
    SELECT
      d.date,
      COALESCE(dm.cost, 0)        AS cost,
      COALESCE(dm.leads, 0)       AS leads,
      COALESCE(dm.sales_count, 0) AS sales_count,
      COALESCE(dm.revenue, 0)     AS revenue,
      COALESCE(cl.clients, 0)     AS clients,
      CASE WHEN dm.leads > 0 THEN ROUND(dm.cost/dm.leads, 2) END AS cpl,
      CASE WHEN dm.sales_count > 0 THEN ROUND(dm.cost/dm.sales_count, 2) END AS cac,
      CASE WHEN dm.cost > 0 THEN ROUND((dm.revenue-dm.cost)/dm.cost, 4) END AS romi
    FROM dates d
    LEFT JOIN dm ON dm.date = d.date
    LEFT JOIN cl ON cl.date = d.date
    ORDER BY d.date DESC
    LIMIT 5
  `);

  const timeline = await db.execute(sql`
    SELECT
      date,
      COALESCE(SUM(cost), 0)    AS cost,
      COALESCE(SUM(leads), 0)   AS leads,
      COALESCE(SUM(revenue), 0) AS revenue
    FROM daily_metrics
    WHERE date >= CURRENT_DATE - ${days}::int
    GROUP BY date
    ORDER BY date
  `);

  // Новые клиенты Fitbase за период (CRM-конверсия, нижняя ступень воронки).
  const clientsAgg = await db.execute(sql`
    SELECT COUNT(*)::int AS new_clients
    FROM clients
    WHERE created_at >= CURRENT_DATE - ${days}::int
  `);

  // Последний статус по каждому источнику (по одной строке на источник).
  const lastSync = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (source)
        source, status, rows_upserted, message, finished_at
      FROM sync_log
      ORDER BY source, finished_at DESC NULLS LAST
    ) t
    ORDER BY finished_at DESC NULLS LAST
  `);

  // Слияние привязанных клиентов в разбивку по источникам.
  const clientMap = new Map<string, number>(
    clientsBySource.rows.map((r: Record<string, unknown>) => [String(r.source), Number(r.clients)]),
  );
  const bySourceMerged: Record<string, unknown>[] = bySource.rows.map((r: Record<string, unknown>) => ({
    ...r,
    clients: clientMap.get(String(r.source)) ?? 0,
  }));
  // Каналы, у которых есть привязанные клиенты, но нет строки в витрине — добавляем.
  const seen = new Set(bySourceMerged.map((r) => String(r.source)));
  for (const [source, clients] of clientMap) {
    if (!seen.has(source)) {
      bySourceMerged.push({
        source,
        cost: 0,
        leads: 0,
        sales_count: 0,
        revenue: 0,
        cpl: null,
        cac: null,
        romi: null,
        clients,
      });
    }
  }

  return NextResponse.json({
    totals: { ...(totals.rows[0] ?? {}), new_clients: clientsAgg.rows[0]?.new_clients ?? 0 },
    bySource: bySourceMerged,
    byDate: byDate.rows,
    timeline: timeline.rows,
    lastSync: lastSync.rows,
  });
}
