import type { AdSpendRow, DateRange } from "./types";

/**
 * VK Реклама (новый кабинет ads.vk.com, платформа myTarget/VK Ads API).
 * Docs: https://ads.vk.com/doc/api
 *
 * ВАЖНО: это НЕ старый API "ВКонтакте" (api.vk.com/method/ads.*).
 * Новый кабинет использует OAuth2 client_credentials и статистику по объявлениям/кампаниям.
 *
 * Ниже — заготовка запроса дневной статистики по кампаниям. Точный путь эндпоинта
 * стоит сверить с личным кабинетом (v2/statistics/...), т.к. VK периодически
 * меняет структуру ответа.
 */

const BASE_URL = "https://ads.vk.com/api/v2";

export async function fetchVkAdsSpend(range: DateRange): Promise<AdSpendRow[]> {
  const token = process.env.VK_ADS_ACCESS_TOKEN;
  if (!token) throw new Error("VK_ADS_ACCESS_TOKEN is not set");

  const params = new URLSearchParams({
    date_from: range.from,
    date_to: range.to,
    metrics: "base",
  });

  const res = await fetch(`${BASE_URL}/statistics/campaigns/day.json?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VK Ads API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    items: Array<{
      id: number | string;
      rows: Array<{
        date: string;
        base?: { shows?: number; clicks?: number; spent?: string | number };
      }>;
    }>;
  };

  const rows: AdSpendRow[] = [];
  for (const campaign of json.items ?? []) {
    for (const r of campaign.rows ?? []) {
      rows.push({
        date: r.date,
        campaignId: String(campaign.id),
        campaignName: null,
        // TODO: подтянуть utm_campaign из настроек кампании (отдельный вызов /campaigns.json)
        utmCampaign: null,
        impressions: Number(r.base?.shows) || 0,
        clicks: Number(r.base?.clicks) || 0,
        cost: Number(r.base?.spent) || 0,
        raw: r,
      });
    }
  }
  return rows;
}
