import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { lastNDays, type SourceKey } from "@/integrations/types";
import { fetchYandexDirectSpend } from "@/integrations/yandex-direct";
import { fetchYandexMetrika } from "@/integrations/yandex-metrika";
import { fetchVkAdsSpend } from "@/integrations/vk-ads";
import { fetchFitbaseClients, fetchFitbaseLeads, fetchFitbaseContracts } from "@/integrations/fitbase";

const { adSpend, webSessions, clients, fitbaseLeads, clientContracts, dailyMetrics, syncLog } = schema;

export interface SyncResult {
  source: SourceKey;
  status: "ok" | "error";
  rows: number;
  message?: string;
}

/** Окно синхронизации по умолчанию — последние 30 дней (перезаписываем витрину). */
const SYNC_WINDOW_DAYS = 30;

export async function runFullSync(): Promise<SyncResult[]> {
  const range = lastNDays(SYNC_WINDOW_DAYS);
  const results: SyncResult[] = [];

  results.push(await guarded("yandex_direct", async () => {
    const rows = await fetchYandexDirectSpend(range);
    for (const r of rows) {
      await db
        .insert(adSpend)
        .values({
          date: r.date,
          source: "yandex_direct",
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          utmCampaign: r.utmCampaign,
          cost: String(r.cost),
          impressions: r.impressions,
          clicks: r.clicks,
          raw: r.raw,
        })
        .onConflictDoUpdate({
          target: [adSpend.date, adSpend.source, adSpend.campaignId],
          set: {
            cost: String(r.cost),
            impressions: r.impressions,
            clicks: r.clicks,
            campaignName: r.campaignName,
            utmCampaign: r.utmCampaign,
            updatedAt: new Date(),
          },
        });
    }
    return rows.length;
  }));

  results.push(await guarded("vk_ads", async () => {
    const rows = await fetchVkAdsSpend(range);
    for (const r of rows) {
      await db
        .insert(adSpend)
        .values({
          date: r.date,
          source: "vk_ads",
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          utmCampaign: r.utmCampaign,
          cost: String(r.cost),
          impressions: r.impressions,
          clicks: r.clicks,
          raw: r.raw,
        })
        .onConflictDoUpdate({
          target: [adSpend.date, adSpend.source, adSpend.campaignId],
          set: {
            cost: String(r.cost),
            impressions: r.impressions,
            clicks: r.clicks,
            updatedAt: new Date(),
          },
        });
    }
    return rows.length;
  }));

  results.push(await guarded("yandex_metrika", async () => {
    const rows = await fetchYandexMetrika(range);
    for (const r of rows) {
      await db
        .insert(webSessions)
        .values({
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
        })
        .onConflictDoUpdate({
          target: [webSessions.date, webSessions.utmSource, webSessions.utmMedium, webSessions.utmCampaign, webSessions.trafficSource],
          set: {
            visits: r.visits,
            users: r.users,
            bounces: r.bounces,
            goalReaches: r.goalReaches,
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
    const clientRows = dedupe((await fetchFitbaseClients(range)).filter((c) => c.fitbaseId));
    // Пакетная вставка: neon-http делает по HTTP-запросу на каждый вызов,
    // поэтому вставляем чанками, а не по одной строке (иначе тысячи round-trip).
    const CHUNK = 500;
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

    // Лиды воронки (атрибуция канала + этап).
    const leadRows = dedupe((await fetchFitbaseLeads(range)).filter((l) => l.fitbaseId));
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
            budget: sql`excluded.budget`,
            createdAt: sql`excluded.created_at`,
            updatedAt: new Date(),
          },
        });
    }

    // Абонементы (деньги/LTV).
    const contractRows = dedupe((await fetchFitbaseContracts(range)).filter((c) => c.fitbaseId));
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
            beginDate: sql`excluded.begin_date`,
            endDate: sql`excluded.end_date`,
            createdAt: sql`excluded.created_at`,
            updatedAt: new Date(),
          },
        });
    }

    return clientRows.length + leadRows.length + contractRows.length;
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
