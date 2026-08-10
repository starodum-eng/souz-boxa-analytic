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

  // Когорта по дате ПЕРВОГО обращения из канала (вариант 3):
  // собираем все обращения клиента (UTM из трекера/Callibri по телефону,
  // UTM и advertising_source из лидов Fitbase), берём самое раннее — оно
  // задаёт и канал, и дату когорты. LTV = сумма абонементов клиента.
  const clientRevBySource = await db.execute(sql`
    WITH touches AS (
      -- обращения из lead_touches (Callibri + формы) с UTM, привязка по телефону
      SELECT c.fitbase_id AS client_id, lt.created_at AS ts,
        CASE
          WHEN coalesce(m.label,'') <> '' THEN m.label
          WHEN lower(lt.utm_source) LIKE '%yandex%' OR lower(lt.utm_source) LIKE '%direct%' THEN 'Яндекс.Директ'
          WHEN lower(lt.utm_source) LIKE '%vk%' THEN 'VK Реклама'
          ELSE lt.utm_source
        END AS source
      FROM lead_touches lt
      JOIN clients c ON right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 10) = lt.phone_norm
      LEFT JOIN source_mappings m ON m.utm_source = lower(lt.utm_source)
      WHERE lt.phone_norm IS NOT NULL AND coalesce(lt.utm_source,'') <> ''

      UNION ALL
      -- лиды Fitbase с UTM
      SELECT fl.client_id, fl.created_at,
        CASE
          WHEN coalesce(m.label,'') <> '' THEN m.label
          WHEN lower(fl.utm_source) LIKE '%yandex%' OR lower(fl.utm_source) LIKE '%direct%' THEN 'Яндекс.Директ'
          WHEN lower(fl.utm_source) LIKE '%vk%' THEN 'VK Реклама'
          ELSE fl.utm_source
        END
      FROM fitbase_leads fl
      LEFT JOIN source_mappings m ON m.utm_source = lower(fl.utm_source)
      WHERE fl.client_id IS NOT NULL AND coalesce(fl.utm_source,'') <> ''

      UNION ALL
      -- лиды Fitbase без UTM → по advertising_source
      SELECT fl.client_id, fl.created_at,
        CASE WHEN lower(fl.advertising_source) LIKE '%вконтакте%' THEN 'VK Реклама' ELSE fl.advertising_source END
      FROM fitbase_leads fl
      WHERE fl.client_id IS NOT NULL AND coalesce(fl.advertising_source,'') <> ''
    ),
    first_touch AS (
      SELECT DISTINCT ON (client_id) client_id, ts, source
      FROM touches
      WHERE coalesce(source,'') <> ''
      ORDER BY client_id, ts ASC NULLS LAST
    ),
    ltv AS (
      SELECT client_id, SUM(amount) AS ltv
      FROM client_contracts WHERE client_id IS NOT NULL GROUP BY client_id
    )
    SELECT
      ft.source,
      COUNT(*)::int AS clients,
      COUNT(*) FILTER (WHERE COALESCE(l.ltv,0) > 0)::int AS paying,
      COALESCE(SUM(l.ltv), 0) AS revenue
    FROM first_touch ft
    LEFT JOIN ltv l ON l.client_id = ft.client_id
    WHERE (ft.ts AT TIME ZONE 'Europe/Moscow')::date >= ${from}
      AND (ft.ts AT TIME ZONE 'Europe/Moscow')::date <= ${to}
    GROUP BY ft.source
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

  // Общая выручка = сумма LTV по каналам (когорта первого обращения).
  const revenueTotal = bySourceMerged.reduce((a, r) => a + Number(r.revenue || 0), 0);

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
