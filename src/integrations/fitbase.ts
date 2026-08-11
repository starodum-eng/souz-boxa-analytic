import type {
  ClientRow,
  DateRange,
  FitbaseLeadRow,
  FitbaseContractRow,
  FitbaseVisitRow,
  FitbasePaymentRow,
} from "./types";
import { normalizePhone } from "@/lib/phone";

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

/** Универсальная постраничная выгрузка всех записей эндпоинта Fitbase. */
async function fetchAllPages(path: string, endpointName: string): Promise<any[]> {
  const headers = authHeaders();
  const out: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${baseUrl()}${path}${sep}page=${page}&page_size=${PAGE_SIZE}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fitbase ${endpointName} error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const items = extractItems(json);
    if (items.length === 0) break;
    out.push(...items);
    const total = Number(json.total_count) || 0;
    if (total && page * PAGE_SIZE >= total) break;
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

export async function fetchFitbaseClients(_range: DateRange): Promise<ClientRow[]> {
  const items = await fetchAllPages("/client", "/client");
  return items.map((c) => ({
    fitbaseId: String(c.id ?? ""),
    name: fullName(c),
    phone: extractPhone(c),
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    createdAt: toDate(c.created_at),
    raw: c,
  }));
}

/** Лиды из воронки (/v2/lead) — с UTM, этапом, источником, бюджетом, client_id. */
export async function fetchFitbaseLeads(_range: DateRange): Promise<FitbaseLeadRow[]> {
  const items = await fetchAllPages("/lead", "/lead");
  return items.map((l) => ({
    fitbaseId: String(l.id ?? ""),
    clientId: l.client_id != null ? String(l.client_id) : null,
    phoneNorm: normalizePhone(l.phone),
    utmSource: l.utm_source ?? null,
    utmMedium: l.utm_medium ?? null,
    utmCampaign: l.utm_campaign ?? null,
    // advertising_source — объект {id,name} или строка
    advertisingSource:
      (l.advertising_source && typeof l.advertising_source === "object"
        ? l.advertising_source.name
        : l.advertising_source) ?? null,
    funnelStep:
      l.funnel_step && typeof l.funnel_step === "object" ? l.funnel_step.name : l.funnel_step ?? null,
    budget: Number(l.budget) || 0,
    createdAt: toDate(l.created_at),
    raw: l,
  }));
}

/** Визиты клиентов (/v2/client/visits) — посещаемость. Тянем недавние по updated_at. */
export async function fetchFitbaseVisits(range: DateRange): Promise<FitbaseVisitRow[]> {
  const fromUnix = Math.floor(new Date(`${range.from}T00:00:00Z`).getTime() / 1000);
  const items = await fetchAllPages(`/client/visits?updated_at=${fromUnix}`, "/client/visits");
  return items.map((v) => ({
    fitbaseId: String(v.id ?? ""),
    clientId: v.client_id != null ? String(v.client_id) : null,
    startAt: toDate(v.start_at),
    raw: v,
  }));
}

/** Абонементы (/v2/client-contract) — суммы оплат = LTV. */
export async function fetchFitbaseContracts(_range: DateRange): Promise<FitbaseContractRow[]> {
  const items = await fetchAllPages("/client-contract", "/client-contract");
  return items.map((c) => ({
    fitbaseId: String(c.id ?? ""),
    clientId: c.client_id != null ? String(c.client_id) : null,
    // сумма фактической оплаты; если её нет — цена
    amount: Number(c.amount_of_payment ?? c.price ?? 0) || 0,
    paid: Boolean(c.payment),
    paymentDate: toDate(c.payment_date),
    beginDate: toDate(c.begin_date),
    endDate: toDate(c.end_date),
    createdAt: toDate(c.created_at),
    raw: c,
  }));
}

/** Единая касса: абонементы + услуги + товары → нормализованные платежи. */
export async function fetchFitbasePayments(range: DateRange): Promise<FitbasePaymentRow[]> {
  const [contracts, services, products] = await Promise.all([
    fetchFitbaseContracts(range),
    fetchAllPages("/client-service", "/client-service"),
    fetchAllPages("/client-product", "/client-product"),
  ]);

  const out: FitbasePaymentRow[] = [];

  // Абонементы
  for (const c of contracts) {
    out.push({
      extId: `contract:${c.fitbaseId}`,
      kind: "contract",
      clientId: c.clientId,
      amount: c.amount,
      paid: c.paid,
      payDate: c.paymentDate,
      raw: c.raw,
    });
  }
  // Услуги (персональные тренировки и т.п.)
  for (const s of services) {
    const amount = Number(s.pay_amount ?? s.amount ?? 0) || 0;
    out.push({
      extId: `service:${s.id}`,
      kind: "service",
      clientId: s.client_id != null ? String(s.client_id) : null,
      amount,
      paid: amount > 0,
      payDate: toDate(s.pay_date),
      raw: s,
    });
  }
  // Товары
  for (const p of products) {
    const amount = Number(p.pay_amount ?? p.amount ?? 0) || 0;
    out.push({
      extId: `product:${p.id}`,
      kind: "product",
      clientId: p.client_id != null ? String(p.client_id) : null,
      amount,
      paid: amount > 0,
      payDate: toDate(p.pay_date),
      raw: p,
    });
  }

  return out;
}
