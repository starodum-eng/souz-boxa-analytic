import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Качество атрибуции: какая доля выручки и платящих клиентов имеет известный
 * ПЕРВЫЙ источник (first-touch), а какая уходит в «Не определён». Диагностика —
 * ничего не «подкручиваем», показываем как есть. Логика источника — та же, что в
 * lifetimeByChannel/clientRevBySource: самое раннее касание (lead_touches по
 * телефону + fitbase_leads по utm/advertising_source).
 */

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const today = new Date();
  const defFrom = new Date(today);
  defFrom.setDate(defFrom.getDate() - 29);
  const from = url.searchParams.get("from") || ymd(defFrom);
  const to = url.searchParams.get("to") || ymd(today);

  // Общий фрагмент: все касания клиента → самый ранний известный источник.
  // Известный = source не пуст и ≠ «Не определён».
  const firstTouch = sql`
    touches AS (
      SELECT c.fitbase_id AS client_id, lt.created_at AS ts,
        CASE
          WHEN coalesce(m.label,'') <> '' THEN m.label
          WHEN lower(lt.utm_source) LIKE '%yandex%' OR lower(lt.utm_source) LIKE '%direct%' THEN 'Яндекс.Директ'
          WHEN lower(lt.utm_source) LIKE '%vk%' THEN 'VK Реклама'
          ELSE lt.utm_source
        END AS source
      FROM lead_touches lt
      JOIN clients c ON right(regexp_replace(coalesce(c.phone,''), '\\D', '', 'g'), 10) = lt.phone_norm
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
    first_touch AS (
      SELECT DISTINCT ON (client_id) client_id, source
      FROM touches
      WHERE coalesce(source,'') <> '' AND source <> 'Не определён'
      ORDER BY client_id, ts ASC NULLS LAST
    )
  `;

  // Период: выручка всего/размечено + платящие клиенты всего/размечено (за всё время).
  const periodRow = await db.execute(sql`
    WITH ${firstTouch},
    period_sales AS (
      SELECT client_id, amount
      FROM sales_ledger
      WHERE pay_date IS NOT NULL
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date >= ${from}
        AND (pay_date AT TIME ZONE 'Europe/Moscow')::date <= ${to}
    ),
    ltv AS (
      SELECT client_id, SUM(amount) AS ltv
      FROM sales_ledger WHERE client_id IS NOT NULL GROUP BY client_id
    )
    SELECT
      (SELECT COALESCE(SUM(amount),0) FROM period_sales) AS rev_total,
      (SELECT COALESCE(SUM(ps.amount),0) FROM period_sales ps
         JOIN first_touch ft ON ft.client_id = ps.client_id) AS rev_attributed,
      (SELECT COUNT(*) FROM ltv l WHERE l.ltv > 0)::int AS paying_total,
      (SELECT COUNT(*) FROM ltv l JOIN first_touch ft ON ft.client_id = l.client_id WHERE l.ltv > 0)::int AS paying_known
  `);

  // Помесячно (последние 12 мес по pay_date): total, attributed.
  const monthsRows = await db.execute(sql`
    WITH ${firstTouch},
    m AS (
      SELECT to_char((s.pay_date AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM') AS month,
        COALESCE(SUM(s.amount), 0) AS total,
        COALESCE(SUM(s.amount) FILTER (WHERE ft.client_id IS NOT NULL), 0) AS attributed
      FROM sales_ledger s
      LEFT JOIN first_touch ft ON ft.client_id = s.client_id
      WHERE s.pay_date IS NOT NULL
      GROUP BY 1
    )
    SELECT month, total, attributed FROM m ORDER BY month DESC LIMIT 12
  `);

  const r = periodRow.rows[0] ?? {};
  const revTotal = Number(r.rev_total ?? 0);
  const revAttributed = Number(r.rev_attributed ?? 0);
  const payingTotal = Number(r.paying_total ?? 0);
  const payingKnown = Number(r.paying_known ?? 0);

  const byMonth = (monthsRows.rows as Array<Record<string, unknown>>)
    .map((x) => {
      const total = Number(x.total ?? 0);
      const attributed = Number(x.attributed ?? 0);
      return { month: String(x.month), total, attributed, coverage: total > 0 ? attributed / total : 0 };
    })
    .reverse(); // хронологически (старые → новые) для графика

  return NextResponse.json({
    period: {
      revTotal,
      revAttributed,
      revCoverage: revTotal > 0 ? revAttributed / revTotal : 0,
      payingTotal,
      payingKnown,
      clientCoverage: payingTotal > 0 ? payingKnown / payingTotal : 0,
    },
    byMonth,
  });
}
