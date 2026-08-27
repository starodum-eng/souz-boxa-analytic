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

  // Предыдущий период той же длины, впритык до from (для сравнения Δ%).
  const parseYmd = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d); // локальная полночь — без TZ-сдвига
  };
  const _f = parseYmd(from);
  const lenDays = Math.round((parseYmd(to).getTime() - _f.getTime()) / 86400000) + 1;
  const prevTo = ymd(new Date(_f.getFullYear(), _f.getMonth(), _f.getDate() - 1));
  const prevFrom = ymd(new Date(_f.getFullYear(), _f.getMonth(), _f.getDate() - lenDays));

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
      COALESCE(SUM(visits), 0)      AS visits,
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
      FROM sales_ledger WHERE client_id IS NOT NULL GROUP BY client_id
    ),
    -- касса за период: выручка из отчёта Fitbase «Отчёт по продажам» (журнал sales_ledger).
    -- Здесь есть онлайн-платежи/продления CloudPayments, которых нет в объектном API.
    cash AS (
      SELECT client_id, SUM(amount) AS cash
      FROM sales_ledger
      WHERE client_id IS NOT NULL AND pay_date IS NOT NULL
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date <= ${to}
      GROUP BY client_id
    ),
    -- канал привлечения клиента. Берём id из клиентов И из журнала продаж —
    -- чтобы касса клиента, которого нет в справочнике clients, тоже попала в итог.
    client_channel AS (
      SELECT ids.client_id, ft.ts, COALESCE(ft.source, 'Не определён') AS source
      FROM (
        SELECT fitbase_id AS client_id FROM clients
        UNION
        SELECT DISTINCT client_id FROM sales_ledger WHERE client_id IS NOT NULL
      ) ids
      LEFT JOIN first_touch ft ON ft.client_id = ids.client_id
    )
    SELECT
      cc.source,
      -- привлечено за период (когорта по первому касанию)
      COUNT(*) FILTER (WHERE (cc.ts AT TIME ZONE 'Europe/Moscow')::date >= ${from}
                         AND (cc.ts AT TIME ZONE 'Europe/Moscow')::date <= ${to})::int AS clients,
      COUNT(*) FILTER (WHERE (cc.ts AT TIME ZONE 'Europe/Moscow')::date >= ${from}
                         AND (cc.ts AT TIME ZONE 'Europe/Moscow')::date <= ${to}
                         AND COALESCE(l.ltv,0) > 0)::int AS paying,
      -- LTV привлечённой за период когорты
      COALESCE(SUM(l.ltv) FILTER (WHERE (cc.ts AT TIME ZONE 'Europe/Moscow')::date >= ${from}
                              AND (cc.ts AT TIME ZONE 'Europe/Moscow')::date <= ${to}), 0) AS cohort_ltv,
      -- касса за период (все оплаты канала в окне, независимо от даты привлечения)
      COALESCE(SUM(ca.cash), 0) AS cash
    FROM client_channel cc
    LEFT JOIN ltv l ON l.client_id = cc.client_id
    LEFT JOIN cash ca ON ca.client_id = cc.client_id
    GROUP BY cc.source
  `);

  // Влияние каналов: клиенты, которые КАСАЛИСЬ канала за период (не обязательно
  // первым касанием), и их LTV. Деньги пересекаются между каналами (multi-touch).
  const channelInfluence = await db.execute(sql`
    WITH touches AS (
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
      SELECT fl.client_id, fl.created_at,
        CASE WHEN lower(fl.advertising_source) LIKE '%вконтакте%' THEN 'VK Реклама' ELSE fl.advertising_source END
      FROM fitbase_leads fl
      WHERE fl.client_id IS NOT NULL AND coalesce(fl.advertising_source,'') <> ''
    ),
    in_period AS (
      SELECT DISTINCT client_id, source
      FROM touches
      WHERE coalesce(source,'') <> ''
        AND (ts AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (ts AT TIME ZONE 'Europe/Moscow')::date <= ${to}
    ),
    ltv AS (
      SELECT client_id, SUM(amount) AS ltv
      FROM sales_ledger WHERE client_id IS NOT NULL GROUP BY client_id
    )
    SELECT
      ip.source,
      COUNT(DISTINCT ip.client_id)::int AS clients,
      COUNT(*) FILTER (WHERE COALESCE(l.ltv,0) > 0)::int AS paying,
      COALESCE(SUM(l.ltv), 0) AS revenue
    FROM in_period ip
    LEFT JOIN ltv l ON l.client_id = ip.client_id
    GROUP BY ip.source
    ORDER BY revenue DESC
  `);

  // Сводка по дням за 5 дней. Левая часть — маркетинг (расход/лиды/клиенты),
  // правая — Fitbase (продажи/выручка по дате платежа + посещения).
  const byDate = await db.execute(sql`
    WITH dm AS (
      SELECT date, SUM(cost) AS cost
      FROM daily_metrics
      WHERE date >= ${from} AND date <= ${to}
      GROUP BY date
    ),
    fl AS (
      SELECT (created_at AT TIME ZONE 'Europe/Moscow')::date AS date, COUNT(*) AS leads
      FROM fitbase_leads
      WHERE created_at IS NOT NULL
        AND (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
      GROUP BY 1
    ),
    cl AS (
      SELECT (created_at AT TIME ZONE 'Europe/Moscow')::date AS date, COUNT(*) AS clients
      FROM clients
      WHERE created_at IS NOT NULL
        AND (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
      GROUP BY 1
    ),
    sales AS (
      SELECT (pay_date AT TIME ZONE 'Europe/Moscow')::date AS date,
        COUNT(*) AS sales_count, SUM(amount) AS revenue
      FROM sales_ledger
      WHERE pay_date IS NOT NULL
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date <= ${to}
      GROUP BY 1
    ),
    vis AS (
      SELECT (start_at AT TIME ZONE 'Europe/Moscow')::date AS date, COUNT(*) AS visits
      FROM client_visits
      WHERE start_at IS NOT NULL
        AND (start_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (start_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
      GROUP BY 1
    ),
    dates AS (
      SELECT date FROM dm
      UNION SELECT date FROM fl
      UNION SELECT date FROM cl
      UNION SELECT date FROM sales
      UNION SELECT date FROM vis
    )
    SELECT
      d.date,
      COALESCE(dm.cost, 0)           AS cost,
      COALESCE(fl.leads, 0)          AS leads,
      CASE WHEN fl.leads > 0 THEN ROUND(dm.cost/fl.leads, 2) END AS cpl,
      COALESCE(cl.clients, 0)        AS clients,
      COALESCE(sales.sales_count, 0) AS sales_count,
      COALESCE(sales.revenue, 0)     AS revenue,
      COALESCE(vis.visits, 0)        AS visits
    FROM dates d
    LEFT JOIN dm    ON dm.date    = d.date
    LEFT JOIN fl    ON fl.date    = d.date
    LEFT JOIN cl    ON cl.date    = d.date
    LEFT JOIN sales ON sales.date = d.date
    LEFT JOIN vis   ON vis.date   = d.date
    ORDER BY d.date DESC
  `);

  // Непрерывный дневной ряд с полным набором полей (для метрик-пикера графика):
  // visits/cost/leads из витрины, revenue из sales_ledger, clients из clients,
  // paying — новые клиенты дня с оплатой. Дни без данных = 0 (generate_series).
  const buildTimeline = (f: string, t2: string) =>
    db.execute(sql`
      WITH days AS (
        SELECT generate_series(${f}::date, ${t2}::date, interval '1 day')::date AS date
      ),
      dm AS (
        SELECT date, SUM(cost) AS cost, SUM(visits) AS visits
        FROM daily_metrics WHERE date >= ${f} AND date <= ${t2} GROUP BY date
      ),
      fl AS (
        SELECT (created_at AT TIME ZONE 'Europe/Moscow')::date AS date, COUNT(*) AS leads
        FROM fitbase_leads
        WHERE created_at IS NOT NULL
          AND (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${f}
          AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${t2}
        GROUP BY 1
      ),
      rev AS (
        SELECT (pay_date AT TIME ZONE 'Europe/Moscow')::date AS date, SUM(amount) AS revenue
        FROM sales_ledger
        WHERE pay_date IS NOT NULL
          AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= ${f}
          AND (pay_date AT TIME ZONE 'Europe/Moscow')::date <= ${t2}
        GROUP BY 1
      ),
      cl AS (
        SELECT (created_at AT TIME ZONE 'Europe/Moscow')::date AS date, COUNT(*) AS clients
        FROM clients
        WHERE created_at IS NOT NULL
          AND (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${f}
          AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${t2}
        GROUP BY 1
      ),
      pay AS (
        SELECT (c.created_at AT TIME ZONE 'Europe/Moscow')::date AS date, COUNT(*) AS paying
        FROM clients c
        WHERE c.created_at IS NOT NULL
          AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${f}
          AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${t2}
          AND EXISTS (SELECT 1 FROM sales_ledger s WHERE s.client_id = c.fitbase_id AND s.amount > 0)
        GROUP BY 1
      )
      SELECT
        d.date,
        COALESCE(dm.visits, 0)   AS visits,
        COALESCE(dm.cost, 0)     AS cost,
        COALESCE(fl.leads, 0)    AS leads,
        COALESCE(rev.revenue, 0) AS revenue,
        COALESCE(cl.clients, 0)  AS clients,
        COALESCE(pay.paying, 0)  AS paying
      FROM days d
      LEFT JOIN dm  ON dm.date  = d.date
      LEFT JOIN fl  ON fl.date  = d.date
      LEFT JOIN rev ON rev.date = d.date
      LEFT JOIN cl  ON cl.date  = d.date
      LEFT JOIN pay ON pay.date = d.date
      ORDER BY d.date
    `);

  const timeline = await buildTimeline(from, to);
  // Сравнение с прошлым периодом той же длины (?compare=1), выровнено по дню 1..N.
  const compare = url.searchParams.get("compare") === "1";
  const timelinePrev = compare ? await buildTimeline(prevFrom, prevTo) : null;

  // Кампании платных источников (для раскрытия строки канала). Funnel по кампании
  // не считаем — только расход/клики/показы (нет атрибуции на уровне кампании).
  const campaignsBySource = await db.execute(sql`
    SELECT
      CASE source
        WHEN 'yandex_direct' THEN 'Яндекс.Директ'
        WHEN 'vk_ads' THEN 'VK Реклама'
        ELSE source::text
      END AS source,
      COALESCE(campaign_name, '—') AS campaign_name,
      COALESCE(SUM(cost), 0)        AS cost,
      COALESCE(SUM(clicks), 0)      AS clicks,
      COALESCE(SUM(impressions), 0) AS impressions
    FROM ad_spend
    WHERE date >= ${from} AND date <= ${to}
    GROUP BY 1, 2
    HAVING SUM(cost) > 0 OR SUM(clicks) > 0 OR SUM(impressions) > 0
    ORDER BY 1, cost DESC
  `);

  // Новые клиенты Fitbase за период (CRM-конверсия, нижняя ступень воронки).
  const clientsAgg = await db.execute(sql`
    SELECT COUNT(*)::int AS new_clients
    FROM clients
    WHERE (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
      AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
  `);

  // Нижняя ступень воронки: новые клиенты периода, сделавшие хотя бы одну оплату
  // (подмножество new_clients → конверсия Клиент→Оплата всегда ≤ 100%).
  const paidNewAgg = await db.execute(sql`
    SELECT COUNT(*)::int AS paid_new
    FROM clients c
    WHERE (c.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
      AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
      AND EXISTS (
        SELECT 1 FROM sales_ledger s
        WHERE s.client_id = c.fitbase_id AND s.amount > 0
      )
  `);

  // ЛИДЫ = заявки Fitbase (воронка «Новые лиды», в таблице только она) по дате
  // создания, с разбивкой по каналу (utm/advertising_source → человекочитаемый канал).
  const leadsByChannelRows = await db.execute(sql`
    SELECT
      CASE
        WHEN coalesce(m.label,'') <> '' THEN m.label
        WHEN lower(coalesce(fl.utm_source,'')) LIKE '%yandex%' OR lower(coalesce(fl.utm_source,'')) LIKE '%direct%' THEN 'Яндекс.Директ'
        WHEN lower(coalesce(fl.utm_source,'')) LIKE '%vk%' THEN 'VK Реклама'
        WHEN lower(coalesce(fl.advertising_source,'')) LIKE '%вконтакте%' THEN 'VK Реклама'
        -- строку-источник "null"/пусто не считаем источником → «Не определён»
        WHEN lower(trim(coalesce(fl.advertising_source,''))) NOT IN ('', 'null') THEN fl.advertising_source
        ELSE 'Не определён'
      END AS source,
      COUNT(*)::int AS leads,
      -- id источника для ссылки: только если канал собран ровно из одного источника
      CASE WHEN COUNT(DISTINCT fl.advertising_source_id) = 1 THEN MAX(fl.advertising_source_id) END AS source_id
    FROM fitbase_leads fl
    LEFT JOIN source_mappings m ON coalesce(fl.utm_source,'') <> '' AND m.utm_source = lower(fl.utm_source)
    WHERE fl.created_at IS NOT NULL
      AND (fl.created_at AT TIME ZONE 'Europe/Moscow')::date >= ${from}
      AND (fl.created_at AT TIME ZONE 'Europe/Moscow')::date <= ${to}
    GROUP BY 1
  `);
  const leadsByChannel = new Map<string, number>(
    leadsByChannelRows.rows.map((r) => [String(r.source), Number(r.leads)]),
  );
  const leadsSourceId = new Map<string, string | null>(
    leadsByChannelRows.rows.map((r) => [String(r.source), r.source_id != null ? String(r.source_id) : null]),
  );
  const leadsTotal = [...leadsByChannel.values()].reduce((a, b) => a + b, 0);

  const leadsPrevRow = await db.execute(sql`
    SELECT COUNT(*)::int AS leads FROM fitbase_leads
    WHERE created_at IS NOT NULL
      AND (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${prevFrom}
      AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${prevTo}
  `);
  const leadsPrev = Number(leadsPrevRow.rows[0]?.leads ?? 0);

  // Предыдущий период — те же источники, что и текущие KPI (для Δ% «яблоки к яблокам»).
  const prevAd = await db.execute(sql`
    SELECT COALESCE(SUM(cost),0) AS cost
    FROM daily_metrics WHERE date >= ${prevFrom} AND date <= ${prevTo}
  `);
  const prevClients = await db.execute(sql`
    SELECT COUNT(*)::int AS new_clients FROM clients
    WHERE (created_at AT TIME ZONE 'Europe/Moscow')::date >= ${prevFrom}
      AND (created_at AT TIME ZONE 'Europe/Moscow')::date <= ${prevTo}
  `);
  const prevRevenue = await db.execute(sql`
    SELECT COALESCE(SUM(amount),0) AS revenue FROM sales_ledger
    WHERE pay_date IS NOT NULL
      AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= ${prevFrom}
      AND (pay_date AT TIME ZONE 'Europe/Moscow')::date <= ${prevTo}
  `);

  // LTV по каналам ПРИВЛЕЧЕНИЯ за ВСЁ время (не зависит от периода): какой канал
  // приводит самых денежных клиентов. Канал — по первому касанию, LTV — все оплаты.
  const lifetimeByChannel = await db.execute(sql`
    WITH touches AS (
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
      SELECT fl.client_id, fl.created_at,
        CASE
          WHEN coalesce(m.label,'') <> '' THEN m.label
          WHEN lower(fl.utm_source) LIKE '%yandex%' OR lower(fl.utm_source) LIKE '%direct%' THEN 'Яндекс.Директ'
          WHEN lower(fl.utm_source) LIKE '%vk%' THEN 'VK Реклама'
          ELSE fl.utm_source
        END
      FROM fitbase_leads fl LEFT JOIN source_mappings m ON m.utm_source = lower(fl.utm_source)
      WHERE fl.client_id IS NOT NULL AND coalesce(fl.utm_source,'') <> ''
      UNION ALL
      SELECT fl.client_id, fl.created_at,
        CASE WHEN lower(fl.advertising_source) LIKE '%вконтакте%' THEN 'VK Реклама' ELSE fl.advertising_source END
      FROM fitbase_leads fl WHERE fl.client_id IS NOT NULL AND coalesce(fl.advertising_source,'') <> ''
    ),
    first_touch AS (
      SELECT DISTINCT ON (client_id) client_id, source
      FROM touches WHERE coalesce(source,'') <> '' ORDER BY client_id, ts ASC NULLS LAST
    ),
    ltv AS (
      SELECT client_id, SUM(amount) AS ltv FROM sales_ledger WHERE client_id IS NOT NULL GROUP BY client_id
    ),
    channel AS (
      SELECT COALESCE(NULLIF(ft.source,'null'), 'Не определён') AS source, ids.client_id
      FROM (
        SELECT fitbase_id AS client_id FROM clients
        UNION
        SELECT DISTINCT client_id FROM sales_ledger WHERE client_id IS NOT NULL
      ) ids
      LEFT JOIN first_touch ft ON ft.client_id = ids.client_id
    )
    SELECT
      ch.source,
      COUNT(*)::int AS clients,
      COUNT(*) FILTER (WHERE COALESCE(l.ltv,0) > 0)::int AS paying,
      COALESCE(SUM(l.ltv), 0) AS ltv,
      CASE WHEN COUNT(*) FILTER (WHERE COALESCE(l.ltv,0) > 0) > 0
           THEN ROUND(SUM(l.ltv)::numeric / COUNT(*) FILTER (WHERE COALESCE(l.ltv,0) > 0), 0) END AS avg_ltv
    FROM channel ch
    LEFT JOIN ltv l ON l.client_id = ch.client_id
    GROUP BY 1
    ORDER BY ltv DESC
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
  const crMap = new Map<string, { clients: number; paying: number; cohortLtv: number; cash: number }>(
    clientRevBySource.rows.map((r: Record<string, unknown>) => [
      String(r.source),
      {
        clients: Number(r.clients),
        paying: Number(r.paying),
        cohortLtv: Number(r.cohort_ltv),
        cash: Number(r.cash),
      },
    ]),
  );
  const adMap = new Map<string, Record<string, unknown>>(
    bySource.rows.map((r: Record<string, unknown>) => [String(r.source), r]),
  );
  const allSources = new Set<string>([...adMap.keys(), ...crMap.keys(), ...leadsByChannel.keys()]);

  const bySourceMerged = [...allSources].map((source) => {
    const ad = adMap.get(source);
    const cr = crMap.get(source) ?? { clients: 0, paying: 0, cohortLtv: 0, cash: 0 };
    const cost = Number(ad?.cost ?? 0);
    // Лиды = заявки Fitbase по каналу (не цели Метрики).
    const leads = leadsByChannel.get(source) ?? 0;
    // Основная выручка канала — касса за период (сходится с Fitbase). ROMI от неё.
    const revenue = cr.cash;
    return {
      source,
      cost,
      clicks: Number(ad?.clicks ?? 0),
      visits: Number(ad?.visits ?? 0),
      leads,
      // id источника Fitbase (если канал = один источник) — для ссылки на список лидов
      sourceId: leadsSourceId.get(source) ?? null,
      clients: cr.clients,
      paying: cr.paying,
      revenue, // касса за период
      cohortLtv: cr.cohortLtv, // LTV привлечённой за период когорты
      cpl: leads > 0 ? Math.round((cost / leads) * 100) / 100 : null,
      cac: cost > 0 && cr.clients > 0 ? Math.round((cost / cr.clients) * 100) / 100 : null,
      // ROMI по кассе (все оплаты канала за период, включая продления старых клиентов)
      romi: cost > 0 ? Math.round(((revenue - cost) / cost) * 10000) / 10000 : null,
      // ROMI когорты: LTV привлечённых за период клиентов против расхода на их привлечение
      romiCohort: cost > 0 ? Math.round(((cr.cohortLtv - cost) / cost) * 10000) / 10000 : null,
    };
  });
  // Полная касса за период из журнала продаж — источник правды (сходится с Fitbase),
  // включая строки без привязки к клиенту (товары / анонимные продажи).
  const revenueTotalRow = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0) AS revenue
    FROM sales_ledger
    WHERE pay_date IS NOT NULL
      AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= ${from}
      AND (pay_date AT TIME ZONE 'Europe/Moscow')::date <= ${to}
  `);
  const revenueTotal = Number(revenueTotalRow.rows[0]?.revenue ?? 0);

  // Разница между полной кассой и привязанной к каналам — неатрибутированные продажи
  // (без ID клиента). Кладём в «Не определён», чтобы разбивка сходилась с итогом.
  const attributed = bySourceMerged.reduce((a, r) => a + Number(r.revenue || 0), 0);
  const unattributed = Math.round((revenueTotal - attributed) * 100) / 100;
  if (unattributed > 0.5) {
    const nd = bySourceMerged.find((r) => r.source === "Не определён");
    if (nd) nd.revenue += unattributed;
    else
      bySourceMerged.push({
        source: "Не определён",
        sourceId: null,
        cost: 0,
        clicks: 0,
        visits: 0,
        leads: 0,
        clients: 0,
        paying: 0,
        revenue: unattributed,
        cohortLtv: 0,
        cpl: null,
        cac: null,
        romi: null,
        romiCohort: null,
      });
  }
  bySourceMerged.sort((a, b) => b.revenue - a.revenue || b.cost - a.cost);

  // ── Укрупнение каналов (ТЗ №18): группируем per-channel строки под родителями.
  // Родитель = channel_groups[channel] ?? channel. Родитель = СУММА детей по базовым
  // метрикам, производные ПЕРЕСЧИТЫВАЕМ из суммы (не усредняем проценты).
  const groupsRows = await db.execute(sql`SELECT channel, parent FROM channel_groups`);
  const parentOf = new Map<string, string>();
  for (const g of groupsRows.rows) {
    const p = String(g.parent ?? "").trim();
    if (p) parentOf.set(String(g.channel), p);
  }
  const campByChild = new Map<string, Array<Record<string, unknown>>>();
  for (const c of campaignsBySource.rows as Array<Record<string, unknown>>) {
    const key = String(c.source);
    (campByChild.get(key) ?? campByChild.set(key, []).get(key)!).push(c);
  }
  const parentGroups = new Map<string, typeof bySourceMerged>();
  for (const child of bySourceMerged) {
    const parent = parentOf.get(child.source) ?? child.source;
    (parentGroups.get(parent) ?? parentGroups.set(parent, []).get(parent)!).push(child);
  }
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const report = [...parentGroups.entries()].map(([parent, kids]) => {
    const sum = (f: keyof (typeof kids)[number]) => kids.reduce((a, r) => a + Number(r[f] || 0), 0);
    const cost = sum("cost"), leads = sum("leads"), visits = sum("visits"), clicks = sum("clicks");
    const clients = sum("clients"), paying = sum("paying"), revenue = sum("revenue"), cohortLtv = sum("cohortLtv");
    // Дети скрыты, если единственный ребёнок и он сам == родитель (нечего раскрывать).
    const children = kids.length === 1 && kids[0].source === parent ? [] : kids;
    const campaigns = kids.flatMap((k) => campByChild.get(k.source) ?? []);
    return {
      source: parent,
      sourceId: children.length === 0 && kids.length === 1 ? (kids[0].sourceId ?? null) : null,
      cost, clicks, visits, leads, clients, paying, revenue, cohortLtv,
      cpl: leads > 0 ? r2(cost / leads) : null,
      cac: cost > 0 && clients > 0 ? r2(cost / clients) : null,
      romi: cost > 0 ? r4((revenue - cost) / cost) : null,
      romiCohort: cost > 0 ? r4((cohortLtv - cost) / cost) : null,
      children,
      campaigns,
    };
  });
  report.sort((a, b) => b.revenue - a.revenue || b.cost - a.cost);

  const cashTotal = revenueTotal;
  const cohortLtvTotal = bySourceMerged.reduce((a, r) => a + Number(r.cohortLtv || 0), 0);

  // Когортный ROMI итого: считаем только по платным каналам (где есть расход),
  // иначе органика с нулевым расходом раздувала бы окупаемость.
  const paidRows = bySourceMerged.filter((r) => Number(r.cost) > 0);
  const paidCost = paidRows.reduce((a, r) => a + Number(r.cost), 0);
  const paidCohortLtv = paidRows.reduce((a, r) => a + Number(r.cohortLtv || 0), 0);
  const romiCohortTotal = paidCost > 0 ? Math.round(((paidCohortLtv - paidCost) / paidCost) * 10000) / 10000 : null;

  // Средний LTV клиента за всё время = вся выручка ÷ число платящих клиентов.
  const lifeRows = lifetimeByChannel.rows as Array<Record<string, unknown>>;
  const totalLtvAll = lifeRows.reduce((a, r) => a + Number(r.ltv || 0), 0);
  const payingAll = lifeRows.reduce((a, r) => a + Number(r.paying || 0), 0);
  const avgLtv = payingAll > 0 ? Math.round(totalLtvAll / payingAll) : null;

  return NextResponse.json({
    totals: {
      ...(totals.rows[0] ?? {}),
      leads: leadsTotal, // заявки Fitbase (Новые лиды), не цели Метрики
      new_clients: clientsAgg.rows[0]?.new_clients ?? 0,
      paid_new: paidNewAgg.rows[0]?.paid_new ?? 0, // новые клиенты периода с оплатой
      revenue: cashTotal, // касса за период (сходится с Fitbase)
      cohort_ltv: cohortLtvTotal, // LTV привлечённой когорты
      romi_cohort: romiCohortTotal, // когортный ROMI по платным каналам
      avg_ltv: avgLtv, // средний LTV клиента за всё время
    },
    prevTotals: {
      cost: Number(prevAd.rows[0]?.cost ?? 0),
      leads: leadsPrev,
      new_clients: Number(prevClients.rows[0]?.new_clients ?? 0),
      revenue: Number(prevRevenue.rows[0]?.revenue ?? 0),
    },
    bySource: bySourceMerged,
    report, // укрупнённые строки-родители с детьми/кампаниями (ТЗ №18)
    campaignsBySource: campaignsBySource.rows,
    channelInfluence: channelInfluence.rows,
    lifetimeByChannel: lifetimeByChannel.rows,
    byDate: byDate.rows,
    timeline: timeline.rows,
    timelinePrev: timelinePrev?.rows ?? null,
    lastSync: lastSync.rows,
  });
}
