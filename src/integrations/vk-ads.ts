import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { AdSpendRow, DateRange } from "./types";

/**
 * VK Реклама (новый кабинет ads.vk.com, платформа myTarget/VK Ads API).
 * Docs: https://ads.vk.ru/en/doc/api/info/Authorization
 *
 * ВАЖНО: это НЕ старый API "ВКонтакте" (api.vk.com/method/ads.*).
 * Новый кабинет использует OAuth2. Авторизация двумя способами:
 *   1) VK_ADS_CLIENT_ID + VK_ADS_CLIENT_SECRET — токен кэшируется в БД
 *      (oauth_tokens), переиспользуется 24 ч и обновляется по refresh_token.
 *      client_credentials дёргаем только в крайнем случае — у VK лимит 5 токенов
 *      на client_id, иначе ловим token_limit_exceeded.
 *   2) VK_ADS_ACCESS_TOKEN — готовый токен (быстро для теста, но протухает).
 */

const BASE_URL = "https://ads.vk.com/api/v2";
const { oauthTokens } = schema;

type TokenResp = { access_token?: string; refresh_token?: string; expires_in?: number; user_id?: string | number };

async function loadVkToken() {
  const rows = await db.select().from(oauthTokens).where(eq(oauthTokens.provider, "vk_ads")).limit(1);
  return rows[0] ?? null;
}

async function saveVkToken(t: {
  accessToken: string;
  refreshToken: string | null;
  userId: string | null;
  expiresAt: Date;
}) {
  await db
    .insert(oauthTokens)
    .values({ provider: "vk_ads", ...t, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        userId: t.userId,
        expiresAt: t.expiresAt,
        updatedAt: new Date(),
      },
    });
}

async function postToken(params: Record<string, string>): Promise<{ status: number; json: TokenResp; text: string }> {
  const res = await fetch(`${BASE_URL}/oauth2/token.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  let json: TokenResp = {};
  try {
    json = JSON.parse(text) as TokenResp;
  } catch {
    /* не JSON — оставим пустой объект, разберём по тексту */
  }
  return { status: res.status, json, text };
}

/** Отозвать токены VK при упоре в лимит (освобождает слот). Ошибку не роняем. */
async function deleteVkTokens(clientId: string, clientSecret: string, userId: string | null) {
  try {
    const params: Record<string, string> = { client_id: clientId, client_secret: clientSecret };
    const uid = process.env.VK_ADS_USER_ID || userId || "";
    if (uid) params.user_id = uid;
    await fetch(`${BASE_URL}/oauth2/token/delete.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  } catch (e) {
    console.error("VK Ads token/delete failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Действующий access-токен VK. Держим ОДИН токен: кэш в БД → refresh → (крайнее)
 * client_credentials с саморазблокировкой при token_limit_exceeded.
 */
async function getVkAccessToken(): Promise<string> {
  const clientId = process.env.VK_ADS_CLIENT_ID;
  const clientSecret = process.env.VK_ADS_CLIENT_SECRET;

  if (clientId && clientSecret) {
    const now = Date.now();
    const cached = await loadVkToken();

    // 1) Свежий кэш — переиспользуем (чинит рост числа токенов при кликах «Обновить»).
    if (cached?.accessToken && cached.expiresAt && cached.expiresAt.getTime() > now + 120_000) {
      return cached.accessToken;
    }

    const persist = (j: TokenResp, fallbackRefresh: string | null, fallbackUser: string | null) =>
      saveVkToken({
        accessToken: j.access_token as string,
        refreshToken: j.refresh_token ?? fallbackRefresh,
        userId: j.user_id != null ? String(j.user_id) : fallbackUser,
        expiresAt: new Date(now + (Number(j.expires_in) || 86400) * 1000),
      });

    // 2) Обновление по refresh_token — НЕ создаёт новый слот.
    if (cached?.refreshToken) {
      const r = await postToken({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: cached.refreshToken,
      });
      if (r.status < 400 && r.json.access_token) {
        await persist(r.json, cached.refreshToken, cached.userId ?? null);
        return r.json.access_token;
      }
      // refresh не удался — пойдём на client_credentials ниже
    }

    // 3) client_credentials (крайний случай) + саморазблокировка при лимите.
    const cc = () => postToken({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
    let r = await cc();
    if ((r.status >= 400 || !r.json.access_token) && /token_limit/i.test(r.text)) {
      await deleteVkTokens(clientId, clientSecret, cached?.userId ?? null);
      r = await cc();
    }
    if (r.status >= 400 || !r.json.access_token) {
      throw new Error(`VK Ads OAuth error ${r.status}: ${r.text.slice(0, 300)}`);
    }
    await persist(r.json, null, process.env.VK_ADS_USER_ID || cached?.userId || null);
    return r.json.access_token;
  }

  // 4) Готовый токен из переменной (без изменений).
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
