import type { ClientRow, DateRange } from "./types";

/**
 * Fitbase — CRM спортивных клубов. API v2.
 * Docs (Swagger): https://api.fitbase.io/site/docs_v2
 *
 * Авторизация: заголовки
 *   Authorization: Bearer <token>
 *   domain: <домен клуба>            (напр. soyuz-boksa)
 *
 * Эндпоинта продаж/платежей нет, поэтому из Fitbase берём «дно воронки»
 * на уровне CRM — новых клиентов (регистрации в клубе).
 *
 * Структура ответа /client (по факту):
 *   { data: [ {id, name, surname, patronymic, created_at(unix sec),
 *              contacts:[{contact_type:"phone", contact:"79..."}], ... } ],
 *     page, page_size, count, total_count }
 *   UTM-меток в карточке нет — атрибуция по каналам недоступна.
 */

const DEFAULT_BASE_URL = "https://api.fitbase.io/api/v2";
const PAGE_SIZE = 100; // максимум, который принимает Fitbase (иначе Validation error)
const MAX_PAGES = 200; // предохранитель (100 × 200 = 20000 клиентов)

function authHeaders(): Record<string, string> {
  const key = process.env.FITBASE_API_KEY;
  const domain = process.env.FITBASE_DOMAIN;
  if (!key) throw new Error("FITBASE_API_KEY is not set");
  if (!domain) throw new Error("FITBASE_DOMAIN is not set");
  return { Authorization: `Bearer ${key}`, domain, Accept: "application/json" };
}

function baseUrl(): string {
  return (process.env.FITBASE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

/** Массив клиентов: под известными ключами или первый массив в объекте-обёртке. */
function extractItems(json: unknown): any[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as any[];
    if (Array.isArray(o.items)) return o.items as any[];
    for (const v of Object.values(o)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as any[];
    }
  }
  return [];
}

/** Unix-секунды/миллисекунды или ISO-строку → Date (или null). */
function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    // < 1e11 считаем секундами, иначе миллисекундами
    const ms = n < 1e11 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function extractPhone(c: any): string | null {
  const contacts = Array.isArray(c.contacts) ? c.contacts : [];
  const phone = contacts.find((x: any) => x?.contact_type === "phone") ?? contacts[0];
  return phone?.contact ?? c.phone ?? null;
}

function fullName(c: any): string | null {
  const parts = [c.surname, c.name, c.patronymic].filter((p) => p && String(p).trim() && p !== "-");
  return parts.length ? parts.join(" ") : (c.name ?? null);
}

export async function fetchFitbaseClients(_range: DateRange): Promise<ClientRow[]> {
  const headers = authHeaders();
  const out: ClientRow[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl()}/client?page=${page}&page_size=${PAGE_SIZE}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fitbase /client error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const items = extractItems(json);
    if (items.length === 0) break;

    for (const c of items) {
      out.push({
        fitbaseId: String(c.id ?? ""),
        name: fullName(c),
        phone: extractPhone(c),
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        createdAt: toDate(c.created_at),
        raw: c,
      });
    }

    const total = Number(json.total_count) || 0;
    if (total && page * PAGE_SIZE >= total) break;
    if (items.length < PAGE_SIZE) break;
  }

  return out;
}
