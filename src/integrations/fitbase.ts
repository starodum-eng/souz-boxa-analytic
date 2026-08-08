import type { ClientRow, DateRange } from "./types";

/**
 * Fitbase — CRM спортивных клубов. API v2.
 * Docs (Swagger): https://api.fitbase.io/site/docs_v2
 *
 * Авторизация: заголовки
 *   Authorization: Bearer <token>
 *   domain: <домен клуба>            (напр. soyuz-boksa)
 *
 * В доступе есть /client, /user, /schedule, /schedule-registration, /place.
 * Эндпоинта продаж/платежей нет, поэтому из Fitbase берём «дно воронки»
 * на уровне CRM — новых клиентов (регистрации в клубе).
 *
 * Пагинация — стандартная Yii2 REST: параметры page / per-page,
 * заголовки X-Pagination-Page-Count и т.п. Тело ответа — массив объектов.
 */

const DEFAULT_BASE_URL = "https://api.fitbase.io/api/v2";
const PER_PAGE = 200;
const MAX_PAGES = 100; // предохранитель

function authHeaders(): Record<string, string> {
  const key = process.env.FITBASE_API_KEY;
  const domain = process.env.FITBASE_DOMAIN;
  if (!key) throw new Error("FITBASE_API_KEY is not set");
  if (!domain) throw new Error("FITBASE_DOMAIN is not set");
  return {
    Authorization: `Bearer ${key}`,
    domain,
    Accept: "application/json",
  };
}

function baseUrl(): string {
  return (process.env.FITBASE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

/** Достаёт массив записей из тела ответа (Yii2 может отдавать массив или обёртку). */
function extractItems(json: unknown): any[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as any[];
    if (Array.isArray(o.data)) return o.data as any[];
  }
  return [];
}

/** Берёт первое непустое значение из набора возможных имён полей. */
function pick(obj: any, keys: string[]): any {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

export async function fetchFitbaseClients(range: DateRange): Promise<ClientRow[]> {
  const headers = authHeaders();
  const out: ClientRow[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl()}/client?per-page=${PER_PAGE}&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fitbase /client error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    const items = extractItems(json);
    if (items.length === 0) break;

    for (const c of items) {
      const createdRaw = pick(c, [
        "created_at",
        "createdAt",
        "dateCreate",
        "date_create",
        "createDate",
        "registration_date",
        "created",
        "date",
      ]);
      const created = createdRaw ? new Date(createdRaw) : null;
      out.push({
        fitbaseId: String(pick(c, ["id", "clientId", "client_id"]) ?? ""),
        name: pick(c, ["name", "fio", "fullName", "full_name"]),
        phone: pick(c, ["phone", "phoneNumber", "phone_number"]),
        // UTM в карточке клиента может отсутствовать — тогда атрибуция по каналам недоступна.
        utmSource: pick(c, ["utm_source", "utmSource"]),
        utmMedium: pick(c, ["utm_medium", "utmMedium"]),
        utmCampaign: pick(c, ["utm_campaign", "utmCampaign"]),
        createdAt: created && !isNaN(created.getTime()) ? created : null,
        raw: c,
      });
    }

    // Yii2 отдаёт общее число страниц в заголовке; если он есть — используем его.
    const pageCount = Number(res.headers.get("x-pagination-page-count"));
    if (pageCount && page >= pageCount) break;
    if (items.length < PER_PAGE) break;
  }

  return out;
}
