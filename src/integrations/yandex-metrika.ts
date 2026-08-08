import type { WebSessionRow, DateRange } from "./types";

/**
 * Яндекс.Метрика — Reporting API.
 * Docs: https://yandex.ru/dev/metrika/doc/api2/api_v1/intro.html
 *
 * Забираем визиты/пользователей/отказы/достижения целей в разрезе UTM по дням.
 * Это связующее звено воронки: реклама → визит → цель (лид).
 */

const API_URL = "https://api-metrika.yandex.net/stat/v1/data";

export async function fetchYandexMetrika(range: DateRange): Promise<WebSessionRow[]> {
  const token = process.env.YANDEX_METRIKA_TOKEN;
  const counterId = process.env.YANDEX_METRIKA_COUNTER_ID;
  if (!token) throw new Error("YANDEX_METRIKA_TOKEN is not set");
  if (!counterId) throw new Error("YANDEX_METRIKA_COUNTER_ID is not set");

  const params = new URLSearchParams({
    ids: counterId,
    date1: range.from,
    date2: range.to,
    dimensions: "ym:s:date,ym:s:UTMSource,ym:s:UTMMedium,ym:s:UTMCampaign",
    metrics: "ym:s:visits,ym:s:users,ym:s:bounceRate,ym:s:goalReaches",
    limit: "100000",
    accuracy: "full",
  });

  const res = await fetch(`${API_URL}?${params.toString()}`, {
    headers: { Authorization: `OAuth ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yandex.Metrika API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    data: Array<{ dimensions: Array<{ name: string }>; metrics: number[] }>;
  };

  return json.data.map((row) => {
    const [dateDim, sourceDim, mediumDim, campaignDim] = row.dimensions;
    const [visits, users, bounceRate, goalReaches] = row.metrics;
    const visitsN = Number(visits) || 0;
    return {
      date: dateDim.name,
      utmSource: sourceDim.name || null,
      utmMedium: mediumDim.name || null,
      utmCampaign: campaignDim.name || null,
      visits: visitsN,
      users: Number(users) || 0,
      // bounceRate — процент; переводим в абсолютное число отказов
      bounces: Math.round(((Number(bounceRate) || 0) / 100) * visitsN),
      goalReaches: Number(goalReaches) || 0,
      raw: row,
    };
  });
}
