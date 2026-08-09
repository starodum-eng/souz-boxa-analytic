import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Данные для дашборда, читаются из витрины daily_metrics.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD — диапазон дат (по умолчанию последние 30 дней).
 * Возвращаем: итоги, разбивку по источникам и дневную динамику.
 */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const valid = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const now = new Date();
  const to = valid(url.searchParams.get("to")) ?? ymd(now);
  const from =
    valid(url.searchParams.get("from")) ??
    ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));

  const totals = await db.execute(sql`
    SELECT
      COALESCE(SUM(cost), 0)        AS cost,
      COALESCE(SUM(clicks), 0)      AS clicks,
      COALESCE(SUM(visits), 0)      AS visits,
      COALESCE(SUM(leads), 0)       AS leads,
      COALESCE(SUM(sales_count), 0) AS sales_count,
      COALESCE(SUM(revenue), 0)     AS revenue
    FROM daily_metrics
    WHERE date >= ${from} AND date <= ${to}
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
    WHERE date >= ${from} AND date <= ${to}
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
      WHERE (c.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
    )
    SELECT source, COUNT(*)::int AS clients
    FROM matched GROUP BY source
  `);

  // Выручка и клиенты по источникам Fitbase (advertising_source лида) — когорта
  // по дате регистрации клиента. LTV = сумма абонементов клиента.
  const revenueBySource = await db.execute(sql`
    WITH lead_src AS (
      SELECT DISTINCT ON (client_id) client_id, advertising_source
      FROM fitbase_leads
      WHERE client_id IS NOT NULL
      ORDER BY client_id, created_at ASC NULLS LAST
    ),
    ltv AS (
      SELECT client_id, SUM(amount) AS ltv
      FROM client_contracts WHERE client_id IS NOT NULL GROUP BY client_id
    ),
    cohort AS (
      SELECT
        c.fitbase_id AS client_id,
        COALESCE(NULLIF(ls.advertising_source, ''), 'Не определён') AS source,
        COALESCE(l.ltv, 0) AS ltv
      FROM clients c
      LEFT JOIN lead_src ls ON ls.client_id = c.fitbase_id
      LEFT JOIN ltv l ON l.client_id = c.fitbase_id
      WHERE (c.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
    )
    SELECT
      source,
      COUNT(*)::int AS clients,
      COUNT(*) FILTER (WHERE ltv > 0)::int AS paying,
      COALESCE(SUM(ltv), 0) AS revenue,
      CASE WHEN COUNT(*) FILTER (WHERE ltv > 0) > 0
        THEN ROUND(SUM(ltv) / COUNT(*) FILTER (WHERE ltv > 0), 0) END AS avg_check
    FROM cohort
    GROUP BY source
    ORDER BY revenue DESC
  `);

  // Общая выручка (LTV) когорты за период — для KPI и общего ROMI.
  const revenueTotalRes = await db.execute(sql`
    WITH ltv AS (
      SELECT client_id, SUM(amount) AS ltv
      FROM client_contracts WHERE client_id IS NOT NULL GROUP BY client_id
    )
    SELECT COALESCE(SUM(l.ltv), 0) AS revenue
    FROM clients c
    JOIN ltv l ON l.client_id = c.fitbase_id
    WHERE (c.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
      AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
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
      SELECT (created_at AT TIME ZONE 'Europe/Moscow')::date AS date, COUNT(*) AS clients
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
    WHERE date >= ${from} AND date <= ${to}
    GROUP BY date
    ORDER BY date
  `);

  // Новые клиенты Fitbase за период (CRM-конверсия, нижняя ступень воронки).
  const clientsAgg = await db.execute(sql`
    SELECT COUNT(*)::int AS new_clients
    FROM clients
    WHERE (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
      AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
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

  const revenueTotal = Number(revenueTotalRes.rows[0]?.revenue ?? 0);

  return NextResponse.json({
    totals: {
      ...(totals.rows[0] ?? {}),
      new_clients: clientsAgg.rows[0]?.new_clients ?? 0,
      // выручка = LTV клиентов, привлечённых за период (когорта)
      revenue: revenueTotal,
    },
    bySource: bySourceMerged,
    revenueBySource: revenueBySource.rows,
    byDate: byDate.rows,
    timeline: timeline.rows,
    lastSync: lastSync.rows,
  });
}
