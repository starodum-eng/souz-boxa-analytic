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

  // Двойная ловушка UTM + деньги: канал клиента определяется по приоритету
  //   1) UTM из лида Fitbase  2) UTM из нашего трекера форм (по телефону)
  //   3) advertising_source Fitbase  4) «Не определён».
  // LTV = сумма абонементов. Когорта — по дате регистрации клиента в периоде.
  const clientRevBySource = await db.execute(sql`
    WITH fb_utm AS (
      SELECT DISTINCT ON (client_id) client_id, lower(utm_source) AS utm_source
      FROM fitbase_leads
      WHERE client_id IS NOT NULL AND coalesce(utm_source,'') <> ''
      ORDER BY client_id, created_at ASC NULLS LAST
    ),
    fb_adv AS (
      SELECT DISTINCT ON (client_id) client_id, advertising_source
      FROM fitbase_leads
      WHERE client_id IS NOT NULL
      ORDER BY client_id, created_at ASC NULLS LAST
    ),
    tracker AS (
      SELECT DISTINCT ON (phone_norm) phone_norm, lower(utm_source) AS utm_source
      FROM lead_touches
      WHERE phone_norm IS NOT NULL AND coalesce(utm_source,'') <> ''
      ORDER BY phone_norm, created_at ASC
    ),
    ltv AS (
      SELECT client_id, SUM(amount) AS ltv
      FROM client_contracts WHERE client_id IS NOT NULL GROUP BY client_id
    ),
    resolved AS (
      SELECT
        c.fitbase_id AS client_id,
        (c.created_at AT TIME ZONE 'Europe/Moscow')::date AS reg_date,
        COALESCE(l.ltv, 0) AS ltv,
        COALESCE(fu.utm_source, tr.utm_source) AS utm_source,
        fa.advertising_source
      FROM clients c
      LEFT JOIN ltv l ON l.client_id = c.fitbase_id
      LEFT JOIN fb_utm fu ON fu.client_id = c.fitbase_id
      LEFT JOIN tracker tr ON tr.phone_norm = right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 10)
      LEFT JOIN fb_adv fa ON fa.client_id = c.fitbase_id
    ),
    channeled AS (
      SELECT
        r.reg_date, r.ltv,
        CASE
          WHEN coalesce(m.label,'') <> '' THEN m.label
          WHEN r.utm_source LIKE '%yandex%' OR r.utm_source LIKE '%direct%' THEN 'Яндекс.Директ'
          WHEN r.utm_source LIKE '%vk%' THEN 'VK Реклама'
          WHEN coalesce(r.utm_source,'') <> '' THEN r.utm_source
          WHEN lower(coalesce(r.advertising_source,'')) LIKE '%вконтакте%' THEN 'VK Реклама'
          WHEN coalesce(r.advertising_source,'') <> '' THEN r.advertising_source
          ELSE 'Не определён'
        END AS source
      FROM resolved r
      LEFT JOIN source_mappings m ON coalesce(r.utm_source,'') <> '' AND m.utm_source = r.utm_source
    )
    SELECT
      source,
      COUNT(*)::int AS clients,
      COUNT(*) FILTER (WHERE ltv > 0)::int AS paying,
      COALESCE(SUM(ltv), 0) AS revenue
    FROM channeled
    WHERE reg_date >= ${from} AND reg_date <= ${to}
    GROUP BY source
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

  // Единая разбивка по источникам: реклама (расход/лиды) + клиенты/выручка (LTV)
  // на одном ключе-канале → настоящий ROMI по каналу, где есть и расход, и деньги.
  const crMap = new Map<string, { clients: number; paying: number; revenue: number }>(
    clientRevBySource.rows.map((r: Record<string, unknown>) => [
      String(r.source),
      { clients: Number(r.clients), paying: Number(r.paying), revenue: Number(r.revenue) },
    ]),
  );
  const adMap = new Map<string, Record<string, unknown>>(
    bySource.rows.map((r: Record<string, unknown>) => [String(r.source), r]),
  );
  const allSources = new Set<string>([...adMap.keys(), ...crMap.keys()]);

  const bySourceMerged = [...allSources].map((source) => {
    const ad = adMap.get(source);
    const cr = crMap.get(source) ?? { clients: 0, paying: 0, revenue: 0 };
    const cost = Number(ad?.cost ?? 0);
    const leads = Number(ad?.leads ?? 0);
    const revenue = cr.revenue;
    return {
      source,
      cost,
      clicks: Number(ad?.clicks ?? 0),
      leads,
      clients: cr.clients,
      paying: cr.paying,
      revenue,
      cpl: leads > 0 ? Math.round((cost / leads) * 100) / 100 : null,
      cac: cost > 0 && cr.clients > 0 ? Math.round((cost / cr.clients) * 100) / 100 : null,
      romi: cost > 0 ? Math.round(((revenue - cost) / cost) * 10000) / 10000 : null,
    };
  });
  bySourceMerged.sort((a, b) => b.revenue - a.revenue || b.cost - a.cost);

  const revenueTotal = Number(revenueTotalRes.rows[0]?.revenue ?? 0);

  return NextResponse.json({
    totals: {
      ...(totals.rows[0] ?? {}),
      new_clients: clientsAgg.rows[0]?.new_clients ?? 0,
      // выручка = LTV клиентов, привлечённых за период (когорта)
      revenue: revenueTotal,
    },
    bySource: bySourceMerged,
    byDate: byDate.rows,
    timeline: timeline.rows,
    lastSync: lastSync.rows,
  });
}
