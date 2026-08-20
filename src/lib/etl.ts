import { sql, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { lastNDays, type SourceKey } from "@/integrations/types";
import { fetchYandexDirectSpend } from "@/integrations/yandex-direct";
import { fetchYandexMetrika } from "@/integrations/yandex-metrika";
import { fetchVkAdsSpend } from "@/integrations/vk-ads";
import {
  fetchFitbaseClients,
  fetchFitbaseLeads,
  fetchFitbaseContracts,
  fetchFitbaseVisits,
  fetchFitbasePayments,
} from "@/integrations/fitbase";
import { fetchCallibri } from "@/integrations/callibri";
import { normalizePhone } from "@/lib/phone";

const { adSpend, webSessions, clients, fitbaseLeads, clientContracts, clientPayments, clientVisits, leadTouches, dailyMetrics, syncLog, syncState } = schema;

/** Водяной знак (unix-сек) последнего успешного синка эндпоинта. */
async function getWatermark(key: string): Promise<number | null> {
  const rows = await db.select().from(syncState).where(eq(syncState.key, key)).limit(1);
  return rows[0]?.lastUpdatedAt ?? null;
}
async function setWatermark(key: string, unix: number): Promise<void> {
  await db
    .insert(syncState)
    .values({ key, lastUpdatedAt: unix, updatedAt: new Date() })
    .onConflictDoUpdate({ target: syncState.key, set: { lastUpdatedAt: unix, updatedAt: new Date() } });
}

export interface SyncResult {
  source: SourceKey;
  status: "ok" | "error";
  rows: number;
  message?: string;
}

/** Окно синхронизации — 95 дней, чтобы покрыть 90-дневный фильтр дашборда. */
const SYNC_WINDOW_DAYS = Number(process.env.SYNC_WINDOW_DAYS) || 95;

export async function runFullSync(): Promise<SyncResult[]> {
  const range = lastNDays(SYNC_WINDOW_DAYS);
  const results: SyncResult[] = [];

  const CHUNK = 500;

  // Инкрементальный синк: тянем только изменённые с прошлого успешного прогона.
  const syncStartUnix = Math.floor(Date.now() / 1000);
  const OVERLAP = (Number(process.env.FITBASE_SYNC_OVERLAP_HOURS) || 48) * 3600; // запас на поздние правки
  const sinceFor = async (key: string): Promise<number> => {
    const wm = await getWatermark(key);
    return wm ? Math.max(0, wm - OVERLAP) : 0; // 0 = первый прогон → полный бэкфилл
  };

  const syncAdSpend = (src: "yandex_direct" | "vk_ads", fetcher: typeof fetchYandexDirectSpend) =>
    guarded(src, async () => {
      const rows = await fetcher(range);
      // дедуп по ключу уникального индекса (date, source, campaign_id)
      const m = new Map<string, (typeof rows)[number]>();
      for (const r of rows) m.set(`${r.date}|${r.campaignId}`, r);
      const uniq = [...m.values()];
      for (let i = 0; i < uniq.length; i += CHUNK) {
        const batch = uniq.slice(i, i + CHUNK).map((r) => ({
          date: r.date,
          source: src,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          utmCampaign: r.utmCampaign,
          cost: String(r.cost),
          impressions: r.impressions,
          clicks: r.clicks,
          raw: r.raw,
        }));
        await db
          .insert(adSpend)
          .values(batch)
          .onConflictDoUpdate({
            target: [adSpend.date, adSpend.source, adSpend.campaignId],
            set: {
              cost: sql`excluded.cost`,
              impressions: sql`excluded.impressions`,
              clicks: sql`excluded.clicks`,
              campaignName: sql`excluded.campaign_name`,
              utmCampaign: sql`excluded.utm_campaign`,
              updatedAt: new Date(),
            },
          });
      }
      return rows.length;
    });

  results.push(await syncAdSpend("yandex_direct", fetchYandexDirectSpend));
  results.push(await syncAdSpend("vk_ads", fetchVkAdsSpend));

  results.push(await guarded("yandex_metrika", async () => {
    const rows = await fetchYandexMetrika(range);
    const m = new Map<string, (typeof rows)[number]>();
    for (const r of rows) m.set(`${r.date}|${r.utmSource}|${r.utmMedium}|${r.utmCampaign}|${r.trafficSource}`, r);
    const uniq = [...m.values()];
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const batch = uniq.slice(i, i + CHUNK).map((r) => ({
        date: r.date,
        utmSource: r.utmSource,
        utmMedium: r.utmMedium,
        utmCampaign: r.utmCampaign,
        trafficSource: r.trafficSource,
        visits: r.visits,
        users: r.users,
        bounces: r.bounces,
        goalReaches: r.goalReaches,
        raw: r.raw,
      }));
      await db
        .insert(webSessions)
        .values(batch)
        .onConflictDoUpdate({
          target: [webSessions.date, webSessions.utmSource, webSessions.utmMedium, webSessions.utmCampaign, webSessions.trafficSource],
          set: {
            visits: sql`excluded.visits`,
            users: sql`excluded.users`,
            bounces: sql`excluded.bounces`,
            goalReaches: sql`excluded.goal_reaches`,
            updatedAt: new Date(),
          },
        });
    }
    return rows.length;
  }));

  results.push(await guarded("fitbase", async () => {
    // Дедуп по fitbaseId: API может вернуть дубли на стыке страниц, а INSERT ...
    // ON CONFLICT не может обновить одну строку дважды в одном пакете.
    const dedupe = <T extends { fitbaseId: string }>(rows: T[]): T[] => {
      const m = new Map<string, T>();
      for (const r of rows) m.set(r.fitbaseId, r);
      return [...m.values()];
    };
    // Эндпоинты Fitbase — последовательно (внутри каждого пагинация по 3 стр.
    // параллельно + повтор при 429), чтобы суммарно не превышать лимит частоты.
    const clientsSince = await sinceFor("fitbase:client");
    const contractsSince = await sinceFor("fitbase:client-contract");
    const clientsRaw = await fetchFitbaseClients(range, clientsSince);
    const leadsRaw = await fetchFitbaseLeads(range);
    const contractsRaw = await fetchFitbaseContracts(range, contractsSince);
    const visitsRaw = await fetchFitbaseVisits(range);
    const contractRowsAll = dedupe(contractsRaw.filter((c) => c.fitbaseId));

    const clientRows = dedupe(clientsRaw.filter((c) => c.fitbaseId));
    // Пакетная вставка чанками (neon-http делает HTTP-запрос на каждый вызов).
    for (let i = 0; i < clientRows.length; i += CHUNK) {
      const batch = clientRows.slice(i, i + CHUNK);
      await db
        .insert(clients)
        .values(batch)
        .onConflictDoUpdate({
          target: [clients.fitbaseId],
          set: {
            name: sql`excluded.name`,
            phone: sql`excluded.phone`,
            createdAt: sql`excluded.created_at`,
            updatedAt: new Date(),
          },
        });
    }
    await setWatermark("fitbase:client", syncStartUnix);

    // Лиды воронки (атрибуция канала + этап). fetchFitbaseLeads возвращает ПОЛНЫЙ
    // набор нужной воронки за раз, поэтому делаем полное обновление таблицы:
    // при непустом наборе чистим старые лиды (в т.ч. других воронок с прошлых синков),
    // затем вставляем отфильтрованный набор. Пустой ответ таблицу НЕ обнуляет.
    const leadRows = dedupe(leadsRaw.filter((l) => l.fitbaseId));
    if (leadRows.length > 0) {
      await db.execute(sql`DELETE FROM fitbase_leads`);
    }
    for (let i = 0; i < leadRows.length; i += CHUNK) {
      const batch = leadRows.slice(i, i + CHUNK).map((l) => ({ ...l, budget: String(l.budget) }));
      await db
        .insert(fitbaseLeads)
        .values(batch)
        .onConflictDoUpdate({
          target: [fitbaseLeads.fitbaseId],
          set: {
            clientId: sql`excluded.client_id`,
            phoneNorm: sql`excluded.phone_norm`,
            utmSource: sql`excluded.utm_source`,
            utmMedium: sql`excluded.utm_medium`,
            utmCampaign: sql`excluded.utm_campaign`,
            advertisingSource: sql`excluded.advertising_source`,
            funnelStep: sql`excluded.funnel_step`,
            funnelId: sql`excluded.funnel_id`,
            budget: sql`excluded.budget`,
            createdAt: sql`excluded.created_at`,
            updatedAt: new Date(),
          },
        });
    }

    // Абонементы (деньги/LTV).
    const contractRows = contractRowsAll;
    for (let i = 0; i < contractRows.length; i += CHUNK) {
      const batch = contractRows
        .slice(i, i + CHUNK)
        .map((c) => ({ ...c, amount: String(c.amount), paid: c.paid ? 1 : 0 }));
      await db
        .insert(clientContracts)
        .values(batch)
        .onConflictDoUpdate({
          target: [clientContracts.fitbaseId],
          set: {
            clientId: sql`excluded.client_id`,
            amount: sql`excluded.amount`,
            paid: sql`excluded.paid`,
            paymentDate: sql`excluded.payment_date`,
            beginDate: sql`excluded.begin_date`,
            endDate: sql`excluded.end_date`,
            createdAt: sql`excluded.created_at`,
            updatedAt: new Date(),
          },
        });
    }
    await setWatermark("fitbase:client-contract", syncStartUnix);

    // Визиты (посещаемость).
    const visitRows = dedupe(visitsRaw.filter((v) => v.fitbaseId));
    for (let i = 0; i < visitRows.length; i += CHUNK) {
      const batch = visitRows.slice(i, i + CHUNK);
      await db
        .insert(clientVisits)
        .values(batch)
        .onConflictDoUpdate({
          target: [clientVisits.fitbaseId],
          set: {
            clientId: sql`excluded.client_id`,
            startAt: sql`excluded.start_at`,
            updatedAt: new Date(),
          },
        });
    }

    // Единая касса (абонементы + услуги + товары) — НЕКРИТИЧНЫЙ подшаг: его сбой
    // (502/недоступность услуг/товаров) не роняет уже сохранённые клиентов/лидов/
    // контракты/визиты. Выручка дашборда берётся из sales_ledger, client_payments вторичны.
    let payCount = 0;
    try {
      const svcSince = await sinceFor("fitbase:client-service");
      const prodSince = await sinceFor("fitbase:client-product");
      const pay = await fetchFitbasePayments(contractRowsAll, svcSince, prodSince);
      const payMap = new Map<string, (typeof pay.rows)[number]>();
      for (const p of pay.rows) if (p.extId) payMap.set(p.extId, p);
      const payRows = [...payMap.values()];
      for (let i = 0; i < payRows.length; i += CHUNK) {
        const batch = payRows.slice(i, i + CHUNK).map((p) => ({
          extId: p.extId,
          kind: p.kind,
          clientId: p.clientId,
          amount: String(p.amount),
          paid: p.paid ? 1 : 0,
          payDate: p.payDate,
          raw: p.raw,
        }));
        await db
          .insert(clientPayments)
          .values(batch)
          .onConflictDoUpdate({
            target: [clientPayments.extId],
            set: {
              clientId: sql`excluded.client_id`,
              amount: sql`excluded.amount`,
              paid: sql`excluded.paid`,
              payDate: sql`excluded.pay_date`,
              updatedAt: new Date(),
            },
          });
      }
      payCount = payRows.length;
      // Водяные знаки продвигаем только по реально загруженным эндпоинтам.
      if (pay.servicesOk) await setWatermark("fitbase:client-service", syncStartUnix);
      if (pay.productsOk) await setWatermark("fitbase:client-product", syncStartUnix);
    } catch (e) {
      console.error("Fitbase касса (услуги/товары) пропущена, ядро сохранено:", e instanceof Error ? e.message : e);
    }

    return clientRows.length + leadRows.length + contractRows.length + visitRows.length + payCount;
  }));

  results.push(await guarded("callibri", async () => {
    const touches = await fetchCallibri(range);
    // Дедуп по externalId (одно обращение могло попасть в пересекающиеся окна).
    const uniq = new Map<string, (typeof touches)[number]>();
    for (const t of touches) uniq.set(t.externalId, t);
    const rows = [...uniq.values()];
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK).map((t) => ({
        externalId: t.externalId,
        channel: t.channel,
        phoneNorm: t.phone ? normalizePhone(t.phone) : null,
        phoneRaw: t.phone ? String(t.phone).slice(0, 64) : null,
        utmSource: t.utmSource,
        utmMedium: t.utmMedium,
        utmCampaign: t.utmCampaign,
        channelName: t.channelName,
        createdAt: t.createdAt,
        raw: t.raw,
      }));
      await db
        .insert(leadTouches)
        .values(batch)
        .onConflictDoUpdate({
          target: [leadTouches.externalId],
          set: {
            channel: sql`excluded.channel`,
            phoneNorm: sql`excluded.phone_norm`,
            utmSource: sql`excluded.utm_source`,
            utmMedium: sql`excluded.utm_medium`,
            utmCampaign: sql`excluded.utm_campaign`,
            channelName: sql`excluded.channel_name`,
            createdAt: sql`excluded.created_at`,
            updatedAt: new Date(),
          },
        });
    }
    return rows.length;
  }));

  // После загрузки сырья — пересчитываем витрину.
  await recomputeDailyMetrics();

  return results;
}

async function guarded(source: SourceKey, fn: () => Promise<number>): Promise<SyncResult> {
  const started = new Date();
  try {
    const rows = await fn();
    await db.insert(syncLog).values({ source, status: "ok", rowsUpserted: rows, startedAt: started, finishedAt: new Date() });
    return { source, status: "ok", rows };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.insert(syncLog).values({ source, status: "error", message: message.slice(0, 1024), startedAt: started, finishedAt: new Date() });
    return { source, status: "error", rows: 0, message };
  }
}

/**
 * Пересчёт витрины daily_metrics.
 * Сводим расход (ad_spend) по источнику, визиты и цели (web_sessions),
 * продажи и выручку (sales) — по дню, затем считаем производные метрики.
 *
 * Атрибуция источника продаж/лидов: по utm_source/utm_medium сопоставляем канал.
 * Для MVP используем упрощённое правило (last-click по utm_source).
 */
export async function recomputeDailyMetrics(): Promise<void> {
  // Полностью пересобираем витрину из сырья — просто и надёжно для текущих объёмов.
  await db.execute(sql`DELETE FROM daily_metrics`);

  // 1) Расходы рекламных источников (Директ, VK). Enum-источник → подпись канала.
  await db.execute(sql`
    INSERT INTO daily_metrics (date, source, cost, impressions, clicks, visits, leads, sales_count, revenue)
    SELECT
      s.date,
      CASE s.source
        WHEN 'yandex_direct' THEN 'Яндекс.Директ'
        WHEN 'vk_ads' THEN 'VK Реклама'
        ELSE s.source::text
      END AS source,
      COALESCE(SUM(s.cost), 0)        AS cost,
      COALESCE(SUM(s.impressions), 0) AS impressions,
      COALESCE(SUM(s.clicks), 0)      AS clicks,
      0, 0, 0, 0
    FROM ad_spend s
    GROUP BY 1, 2
  `);

  // 2) Визиты и цели из Метрики → канал.
  //    Приоритет: справочник source_mappings > органика/прямые (тип трафика) >
  //    встроенные правила Директ/VK по utm_source > сырой utm_source > «Сайт (прочее)».
  await db.execute(sql`
    WITH web AS (
      SELECT
        w.date,
        CASE
          -- Метка (utm_source) важнее типа трафика: если метка есть — канал по ней.
          WHEN coalesce(m.label,'') <> '' THEN m.label
          WHEN lower(coalesce(w.utm_source,'')) LIKE '%yandex%' OR lower(coalesce(w.utm_source,'')) LIKE '%direct%' THEN 'Яндекс.Директ'
          WHEN lower(coalesce(w.utm_source,'')) LIKE '%vk%' THEN 'VK Реклама'
          -- Трафик карточки Яндекс.Бизнеса (помечен в интеграции): платный / органика.
          WHEN lower(coalesce(w.traffic_source,'')) = 'yandex_business_ad' THEN 'Яндекс.Бизнес (реклама)'
          WHEN lower(coalesce(w.traffic_source,'')) = 'yandex_business' THEN 'Яндекс.Бизнес'
          -- Метки нет → смотрим тип трафика (органика/прямые заходы).
          WHEN lower(coalesce(w.traffic_source,'')) = 'organic' THEN 'SEO (органика)'
          WHEN lower(coalesce(w.traffic_source,'')) = 'direct' THEN 'Прямые заходы'
          -- Прочий неразмеченный трафик без метки.
          ELSE 'Сайт (прочее)'
        END AS source,
        SUM(w.visits) AS visits,
        SUM(w.goal_reaches) AS leads
      FROM web_sessions w
      LEFT JOIN source_mappings m
        ON coalesce(w.utm_source,'') <> '' AND m.utm_source = lower(w.utm_source)
      GROUP BY 1, 2
    )
    INSERT INTO daily_metrics (date, source, visits, leads)
    SELECT date, source, visits, leads FROM web
    ON CONFLICT (date, source) DO UPDATE
      SET visits = daily_metrics.visits + EXCLUDED.visits,
          leads  = daily_metrics.leads  + EXCLUDED.leads
  `);

  // 4) Производные метрики: CPL, CAC, ROMI.
  await db.execute(sql`
    UPDATE daily_metrics
    SET
      cpl  = CASE WHEN leads > 0 THEN ROUND(cost / leads, 2) END,
      cac  = CASE WHEN sales_count > 0 THEN ROUND(cost / sales_count, 2) END,
      romi = CASE WHEN cost > 0 THEN ROUND((revenue - cost) / cost, 4) END
  `);
}
