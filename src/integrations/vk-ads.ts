import type { AdSpendRow, DateRange } from "./types";

/**
 * VK Реклама (новый кабинет ads.vk.com, платформа myTarget/VK Ads API).
 * Docs: https://ads.vk.com/doc/api
 *
 * ВАЖНО: это НЕ старый API "ВКонтакте" (api.vk.com/method/ads.*).
 * Новый кабинет использует OAuth2. Авторизация двумя способами:
 *   1) VK_ADS_CLIENT_ID + VK_ADS_CLIENT_SECRET — обмениваем на свежий токен
 *      (grant_type=client_credentials) на каждом синке. Рекомендуется: токены
 *      VK живут недолго, а так они всегда актуальны.
 *   2) VK_ADS_ACCESS_TOKEN — готовый токен (быстро для теста, но протухает).
 */

const BASE_URL = "https://ads.vk.com/api/v2";

/** Получить действующий access-токен: приоритет — обмен client_id/secret. */
async function getVkAccessToken(): Promise<string> {
  const clientId = process.env.VK_ADS_CLIENT_ID;
  const clientSecret = process.env.VK_ADS_CLIENT_SECRET;

  // Пара client_id/secret есть — меняем на свежий токен (надёжно для авто-синка).
  if (clientId && clientSecret) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(`${BASE_URL}/oauth2/token.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`VK Ads OAuth error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error("VK Ads OAuth: в ответе нет access_token");
    return json.access_token;
  }

  // Иначе — готовый токен из переменной.
  const direct = process.env.VK_ADS_ACCESS_TOKEN;
  if (direct) return direct;

  throw new Error("VK Ads: задай VK_ADS_CLIENT_ID + VK_ADS_CLIENT_SECRET (или VK_ADS_ACCESS_TOKEN)");
}

/** Справочник id → имя кампании (для читаемых подписей расхода). */
async function fetchCampaignNames(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(`${BASE_URL}/campaigns.json?fields=id,name&limit=250`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return map;
    const json = (await res.json()) as { items?: Array<{ id: number | string; name?: string }> };
    for (const c of json.items ?? []) map.set(String(c.id), c.name ?? "");
  } catch {
    // имя кампании не критично — при ошибке просто оставим null
  }
  return map;
}

export async function fetchVkAdsSpend(range: DateRange): Promise<AdSpendRow[]> {
  const token = await getVkAccessToken();

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

  const names = await fetchCampaignNames(token);

  const rows: AdSpendRow[] = [];
  for (const campaign of json.items ?? []) {
    const cid = String(campaign.id);
    for (const r of campaign.rows ?? []) {
      rows.push({
        date: r.date,
        campaignId: cid,
        campaignName: names.get(cid) || null,
        // utm_campaign не нужен для канальной атрибуции: расход VK помечается
        // каналом «VK Реклама» на витрине, а лиды — по utm_source ~ 'vk' в Метрике.
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
