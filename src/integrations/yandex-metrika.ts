import type { WebSessionRow, DateRange } from "./types";

/**
 * Яндекс.Метрика — Reporting API.
 * Docs: https://yandex.ru/dev/metrika/doc/api2/api_v1/intro.html
 *
 * Забираем визиты/пользователей/отказы/достижения целей в разрезе UTM по дням.
 * Поддержка нескольких счётчиков: YANDEX_METRIKA_COUNTER_ID можно задать через
 * запятую (напр. старый,новый на время перехода). Цели — YANDEX_METRIKA_GOAL_ID,
 * тоже через запятую, позиционно к счётчикам (у каждого счётчика своя цель).
 *
 * На пересекающихся днях данные счётчиков одного сайта объединяются по МАКСИМУМУ,
 * чтобы не задваивать визиты, пока на сайте стоят оба тега.
 */

const API_URL = "https://api-metrika.yandex.net/stat/v1/data";

async function fetchOneCounter(
  token: string,
  counterId: string,
  goalId: string | undefined,
  range: DateRange,
): Promise<WebSessionRow[]> {
  const metrics = ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"];
  if (goalId) metrics.push(`ym:s:goal${goalId}reaches`);

  const params = new URLSearchParams({
    ids: counterId,
    date1: range.from,
    date2: range.to,
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
    throw new Error(`Yandex.Metrika counter ${counterId} error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    data: Array<{ dimensions: Array<{ id?: string | null; name: string | null }>; metrics: number[] }>;
  };

  return json.data.map((row) => {
    const [dateDim, sourceDim, mediumDim, campaignDim, trafficDim] = row.dimensions;
    const [visits, users, bounceRate] = row.metrics;
    const goalReaches = goalId ? row.metrics[3] : 0;
    const visitsN = Number(visits) || 0;
    return {
      date: dateDim.name ?? "",
      utmSource: sourceDim.name || "",
      utmMedium: mediumDim.name || "",
      utmCampaign: campaignDim.name || "",
      trafficSource: trafficDim?.id || trafficDim?.name || "",
      visits: visitsN,
      users: Number(users) || 0,
      bounces: Math.round(((Number(bounceRate) || 0) / 100) * visitsN),
      goalReaches: Number(goalReaches) || 0,
      raw: row,
    };
  });
}

export async function fetchYandexMetrika(range: DateRange): Promise<WebSessionRow[]> {
  const token = process.env.YANDEX_METRIKA_TOKEN || process.env.YANDEX_TOKEN;
  if (!token) throw new Error("YANDEX_METRIKA_TOKEN / YANDEX_TOKEN is not set");

  const counters = (process.env.YANDEX_METRIKA_COUNTER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (counters.length === 0) throw new Error("YANDEX_METRIKA_COUNTER_ID is not set");

  const goals = (process.env.YANDEX_METRIKA_GOAL_ID || "")
    .split(",")
    .map((s) => s.trim());

  // Тянем каждый счётчик со своей целью (позиционно).
  const perCounter = await Promise.all(
    counters.map((c, i) => fetchOneCounter(token, c, goals[i] || undefined, range)),
  );

  // Счётчик Яндекс.Бизнеса (карточка организации) — отдельный источник.
  // Всю его посещаемость помечаем traffic_source='yandex_business', цель
  // «Клик на позвонить» = лиды. Витрина сведёт это в канал «Яндекс.Бизнес».
  const bizCounter = process.env.YANDEX_METRIKA_BUSINESS_COUNTER_ID?.trim();
  const bizGoal = process.env.YANDEX_METRIKA_BUSINESS_GOAL_ID?.trim();
  if (bizCounter) {
    const bizRows = await fetchOneCounter(token, bizCounter, bizGoal || undefined, range);
    // агрегируем по дню (utm у карточки нет) и метим как yandex_business
    const byDate = new Map<string, WebSessionRow>();
    for (const r of bizRows) {
      const prev = byDate.get(r.date);
      if (!prev) {
        byDate.set(r.date, {
          date: r.date,
          utmSource: "",
          utmMedium: "",
          utmCampaign: "",
          trafficSource: "yandex_business",
          visits: r.visits,
          users: r.users,
          bounces: r.bounces,
          goalReaches: r.goalReaches,
          raw: { business: true },
        });
      } else {
        prev.visits += r.visits;
        prev.users += r.users;
        prev.bounces += r.bounces;
        prev.goalReaches += r.goalReaches;
      }
    }
    perCounter.push([...byDate.values()]);
  }

  // Объединяем по ключу (день+utm+тип трафика), беря МАКСИМУМ метрик —
  // так визиты одного сайта не задваиваются между счётчиками.
  const key = (r: WebSessionRow) => `${r.date}|${r.utmSource}|${r.utmMedium}|${r.utmCampaign}|${r.trafficSource}`;
  const merged = new Map<string, WebSessionRow>();
  for (const rows of perCounter) {
    for (const r of rows) {
      const k = key(r);
      const prev = merged.get(k);
      if (!prev) {
        merged.set(k, { ...r });
      } else {
        prev.visits = Math.max(prev.visits, r.visits);
        prev.users = Math.max(prev.users, r.users);
        prev.bounces = Math.max(prev.bounces, r.bounces);
        prev.goalReaches = Math.max(prev.goalReaches, r.goalReaches);
      }
    }
  }
  return [...merged.values()];
}
