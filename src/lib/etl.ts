import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { lastNDays, type SourceKey } from "@/integrations/types";
import { fetchYandexDirectSpend } from "@/integrations/yandex-direct";
import { fetchYandexMetrika } from "@/integrations/yandex-metrika";
import { fetchVkAdsSpend } from "@/integrations/vk-ads";
import { fetchFitbaseClients, fetchFitbaseSales } from "@/integrations/fitbase";

const { adSpend, webSessions, clients, sales, dailyMetrics, syncLog } = schema;

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
          visits: r.visits,
          users: r.users,
          bounces: r.bounces,
          goalReaches: r.goalReaches,
          raw: r.raw,
        })
        .onConflictDoUpdate({
          target: [webSessions.date, webSessions.utmSource, webSessions.utmMedium, webSessions.utmCampaign],
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
    const clientRows = await fetchFitbaseClients(range);
    for (const c of clientRows) {
      await db
        .insert(clients)
        .values(c)
        .onConflictDoUpdate({
          target: [clients.fitbaseId],
          set: { name: c.name, phone: c.phone, utmSource: c.utmSource, utmMedium: c.utmMedium, utmCampaign: c.utmCampaign, updatedAt: new Date() },
        });
    }
    const saleRows = await fetchFitbaseSales(range);
    for (const s of saleRows) {
      await db
        .insert(sales)
        .values({ ...s, amount: String(s.amount) })
        .onConflictDoUpdate({
          target: [sales.fitbaseId],
          set: { amount: String(s.amount), product: s.product, date: s.date, updatedAt: new Date() },
        });
    }
    return clientRows.length + saleRows.length;
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

  // 1) Расходы рекламных источников (Директ, VK) + переносим визиты/лиды из Метрики по utm.
  await db.execute(sql`
    INSERT INTO daily_metrics (date, source, cost, impressions, clicks, visits, leads, sales_count, revenue)
    SELECT
      s.date,
      s.source,
      COALESCE(SUM(s.cost), 0)        AS cost,
      COALESCE(SUM(s.impressions), 0) AS impressions,
      COALESCE(SUM(s.clicks), 0)      AS clicks,
      0, 0, 0, 0
    FROM ad_spend s
    GROUP BY s.date, s.source
  `);

  // 2) Визиты и достижения целей из Метрики, разложенные по каналам (utm_medium → источник).
  //    cpc/cpm-трафик Директа: utm_source ~ 'yandex', VK: utm_source ~ 'vk'.
  await db.execute(sql`
    WITH web AS (
      SELECT
        date,
        CASE
          WHEN lower(coalesce(utm_source,'')) LIKE '%yandex%' OR lower(coalesce(utm_source,'')) LIKE '%direct%' THEN 'yandex_direct'
          WHEN lower(coalesce(utm_source,'')) LIKE '%vk%' THEN 'vk_ads'
          ELSE NULL
        END::source AS source,
        SUM(visits) AS visits,
        SUM(goal_reaches) AS leads
      FROM web_sessions
      GROUP BY 1, 2
    )
    UPDATE daily_metrics dm
    SET visits = web.visits, leads = web.leads
    FROM web
    WHERE web.source IS NOT NULL AND dm.date = web.date AND dm.source = web.source
  `);

  // 3) Продажи Fitbase, разнесённые по каналам через utm_source.
  await db.execute(sql`
    WITH s AS (
      SELECT
        date,
        CASE
          WHEN lower(coalesce(utm_source,'')) LIKE '%yandex%' OR lower(coalesce(utm_source,'')) LIKE '%direct%' THEN 'yandex_direct'
          WHEN lower(coalesce(utm_source,'')) LIKE '%vk%' THEN 'vk_ads'
          ELSE 'fitbase'
        END::source AS source,
        COUNT(*) AS sales_count,
        SUM(amount) AS revenue
      FROM sales
      GROUP BY 1, 2
    )
    INSERT INTO daily_metrics (date, source, sales_count, revenue)
    SELECT date, source, sales_count, revenue FROM s
    ON CONFLICT (date, source) DO UPDATE
      SET sales_count = EXCLUDED.sales_count, revenue = EXCLUDED.revenue
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
