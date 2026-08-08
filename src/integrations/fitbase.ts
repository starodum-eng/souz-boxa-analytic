import type { ClientRow, SaleRow, DateRange } from "./types";

/**
 * Fitbase — CRM фитнес/спортивных клубов.
 * Docs: https://fitbase.ru (раздел API/интеграции — точные пути эндпоинтов
 * сверить в личном кабинете, т.к. они выдаются по API-ключу клуба).
 *
 * Отсюда берём "дно воронки": клиентов и продажи абонементов (выручку).
 * utm_* переносим с карточки клиента, чтобы связать деньги с рекламой.
 *
 * Пути эндпоинтов ниже помечены как ПРЕДПОЛОЖЕНИЕ — их нужно подтвердить
 * по актуальной документации Fitbase (структура ответа может отличаться).
 */

const BASE_URL = "https://api.fitbase.ru/v1";

function authHeaders(): Record<string, string> {
  const key = process.env.FITBASE_API_KEY;
  if (!key) throw new Error("FITBASE_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export async function fetchFitbaseClients(range: DateRange): Promise<ClientRow[]> {
  const params = new URLSearchParams({ created_from: range.from, created_to: range.to });
  const res = await fetch(`${BASE_URL}/clients?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fitbase clients API error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { items?: any[] };
  return (json.items ?? []).map((c) => ({
    fitbaseId: String(c.id),
    name: c.name ?? null,
    phone: c.phone ?? null,
    utmSource: c.utm_source ?? null,
    utmMedium: c.utm_medium ?? null,
    utmCampaign: c.utm_campaign ?? null,
    createdAt: c.created_at ? new Date(c.created_at) : null,
    raw: c,
  }));
}

export async function fetchFitbaseSales(range: DateRange): Promise<SaleRow[]> {
  const params = new URLSearchParams({ date_from: range.from, date_to: range.to });
  const res = await fetch(`${BASE_URL}/sales?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fitbase sales API error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { items?: any[] };
  return (json.items ?? []).map((s) => ({
    fitbaseId: String(s.id),
    date: String(s.date).slice(0, 10),
    clientFitbaseId: s.client_id != null ? String(s.client_id) : null,
    product: s.product ?? s.title ?? null,
    amount: Number(s.amount) || 0,
    utmSource: s.utm_source ?? null,
    utmMedium: s.utm_medium ?? null,
    utmCampaign: s.utm_campaign ?? null,
    raw: s,
  }));
}
