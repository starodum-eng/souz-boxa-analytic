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
  // Общий токен Яндекса подходит и для Метрики (см. YANDEX_TOKEN).
  const token = process.env.YANDEX_METRIKA_TOKEN || process.env.YANDEX_TOKEN;
  const counterId = process.env.YANDEX_METRIKA_COUNTER_ID;
  // ID цели в Метрике, которую считаем «лидом» (напр. отправка формы заявки).
  // У Метрики нет общей метрики достижений — только по конкретной цели:
  // ym:s:goal<ID>reaches. Если не задан — грузим визиты, лиды = 0.
  const goalId = process.env.YANDEX_METRIKA_GOAL_ID?.trim();
  if (!token) throw new Error("YANDEX_METRIKA_TOKEN / YANDEX_TOKEN is not set");
  if (!counterId) throw new Error("YANDEX_METRIKA_COUNTER_ID is not set");

  const metrics = ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"];
  if (goalId) metrics.push(`ym:s:goal${goalId}reaches`);

  const params = new URLSearchParams({
    ids: counterId,
    date1: range.from,
    date2: range.to,
    // lastTrafficSource — тип источника (organic/direct/ad/referral/social/…),
    // нужен для разделения SEO и прямых заходов (UTM у них нет).
    dimensions: "ym:s:date,ym:s:UTMSource,ym:s:UTMMedium,ym:s:UTMCampaign,ym:s:lastTrafficSource",
    metrics: metrics.join(","),
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
    data: Array<{ dimensions: Array<{ id?: string | null; name: string | null }>; metrics: number[] }>;
  };

  return json.data.map((row) => {
    const [dateDim, sourceDim, mediumDim, campaignDim, trafficDim] = row.dimensions;
    const [visits, users, bounceRate] = row.metrics;
    // goalReaches идёт 4-м элементом только если задан goalId; иначе его нет.
    const goalReaches = goalId ? row.metrics[3] : 0;
    const visitsN = Number(visits) || 0;
    return {
      date: dateDim.name ?? "",
      utmSource: sourceDim.name || "",
      utmMedium: mediumDim.name || "",
      utmCampaign: campaignDim.name || "",
      // у типа трафика код лежит в id (organic/direct/…), name — локализованная подпись
      trafficSource: trafficDim?.id || trafficDim?.name || "",
      visits: visitsN,
      users: Number(users) || 0,
      // bounceRate — процент; переводим в абсолютное число отказов
      bounces: Math.round(((Number(bounceRate) || 0) / 100) * visitsN),
      goalReaches: Number(goalReaches) || 0,
      raw: row,
    };
  });
}
