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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Сигнал «страница окончательно не отдалась» — для partial-режима (см. fetchAllPages). */
class PageFailure extends Error {}

interface PageOpts {
  /** Параллельность пагинации. Для «тяжёлых» эндпоинтов (клиенты) ставим 1, чтобы не ловить 429. */
  concurrency?: number;
  /** Пауза между запросами, мс — сглаживает всплеск и снижает шанс лимита частоты. */
  throttleMs?: number;
  /** true → при окончательном сбое страницы вернуть уже собранное (complete=false), а не падать. */
  partialOk?: boolean;
}

/**
 * Универсальная выгрузка эндпоинта Fitbase: пагинация с повтором при 429/5xx.
 * Возвращает { items, complete }. complete=false — выгрузка оборвалась на сбое
 * страницы (только в partialOk-режиме): собранное отдаём, но это НЕ весь набор.
 */
async function fetchAllPages(
  path: string,
  endpointName: string,
  opts: PageOpts = {},
): Promise<{ items: any[]; complete: boolean }> {
  const { concurrency = 3, throttleMs = 0, partialOk = false } = opts;
  const headers = authHeaders();
  const sep = path.includes("?") ? "&" : "?";
  // Больше попыток и длиннее backoff (до 8с) — штраф за частоту снимается не сразу.
  const getPage = async (page: number): Promise<Record<string, unknown>> => {
    for (let attempt = 0; attempt < 10; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl()}${path}${sep}page=${page}&page_size=${PAGE_SIZE}`, { headers });
      } catch {
        // Сетевой сбой (обрыв соединения) — тоже транзиент, повторяем.
        await sleep(Math.min(1500 * (attempt + 1), 8000));
        continue;
      }
      // Транзиентные: 429 (лимит частоты) и 5xx (502/503/… — временный сбой Fitbase).
      if (res.status === 429 || res.status >= 500) {
        await sleep(Math.min(1500 * (attempt + 1), 8000)); // backoff до 8с, 10 попыток
        continue;
      }
      // 4xx — наши ошибки (доступ/параметры), не транзиент → падаем сразу.
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Fitbase ${endpointName} error ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as Record<string, unknown>;
    }
    // Исчерпали повторы. В partial-режиме сигналим отдельным классом, чтобы вызвавший
    // цикл вернул уже собранные страницы, а не потерял всю выгрузку.
    throw new PageFailure(`Fitbase ${endpointName}: не удалось получить ответ после повторов (429/5xx)`);
  };

  const first = await getPage(1);
  const firstItems = extractItems(first);
  const out = [...firstItems];

  // ВАЖНО: total_count Fitbase отдаёт с запаздыванием — он не учитывает самые
  // свежие записи. Поэтому НЕ используем его как условие остановки (иначе
  // теряется последняя страница с новейшими платежами/продлениями).
  // Останавливаемся, только когда страница пришла НЕПОЛНОЙ — значит данные кончились.
  if (firstItems.length < PAGE_SIZE) return { items: out, complete: true };

  let page = 2;
  let done = false;
  while (!done && page <= MAX_PAGES) {
    const batch = [];
    for (let p = page; p < page + concurrency && p <= MAX_PAGES; p++) batch.push(getPage(p));
    try {
      const results = await Promise.all(batch);
      for (const json of results) {
        const items = extractItems(json);
        out.push(...items);
        if (items.length < PAGE_SIZE) done = true; // дошли до конца выгрузки
      }
    } catch (e) {
      // Страница окончательно не отдалась. В partial-режиме не роняем всю выгрузку —
      // отдаём собранное как неполное (следующий синк доберёт: upsert идемпотентен).
      if (partialOk && e instanceof PageFailure) {
        return { items: out, complete: false };
      }
      throw e;
    }
    page += batch.length;
    if (throttleMs && !done) await sleep(throttleMs);
  }
  return { items: out, complete: true };
}

/** Добавить ?updated_at=<unix> к пути (инкрементальный синк). since<=0 → полный пул. */
function withUpdated(path: string, since?: number): string {
  if (!since || since <= 0) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}updated_at=${since}`;
}

/**
 * Клиенты (справочник имён/телефонов). Самый «тяжёлый» эндпоинт (~20k строк) — именно
 * он упирается в лимит частоты Fitbase. Поэтому: пагинация ПОСЛЕДОВАТЕЛЬНО (concurrency=1)
 * с паузой между запросами и partial-режим — если Fitbase оборвёт выдачу штрафом,
 * возвращаем то, что успели (complete=false), а не теряем весь синк. Данные — вторичны
 * (только имена для «Удержания»; атрибуция строится на лидах/касаниях), поэтому неполный
 * справочник допустим: следующий прогон доберёт (upsert идемпотентен).
 */
export async function fetchFitbaseClients(
  _range: DateRange,
  updatedSince?: number,
): Promise<{ rows: ClientRow[]; complete: boolean }> {
  const { items, complete } = await fetchAllPages(withUpdated("/client", updatedSince), "/client", {
    concurrency: 1,
    throttleMs: 350,
    partialOk: true,
  });
  const rows = items.map((c) => ({
    fitbaseId: String(c.id ?? ""),
    name: fullName(c),
    phone: extractPhone(c),
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    createdAt: toDate(c.created_at),
    raw: c,
  }));
  return { rows, complete };
}

/**
 * Лиды из воронки (/v2/lead) — с UTM, этапом, источником, бюджетом, client_id.
 * По бизнес-логике работаем только с воронкой «Новые лиды» (funnels_id=1):
 * фильтруем по FITBASE_LEADS_FUNNEL_ID (пусто → все воронки, обратная совместимость).
 * id воронки — поле `funnels_id`; эндпоинт также принимает query `funnel_id`.
 */
export async function fetchFitbaseLeads(
  _range: DateRange,
): Promise<{ rows: FitbaseLeadRow[]; rawCount: number }> {
  const FUNNEL = (process.env.FITBASE_LEADS_FUNNEL_ID ?? "1").trim();
  // Пробрасываем funnel_id в запрос (если API учтёт — не тянем лишнее);
  // клиентский фильтр ниже — источник правды на случай, если параметр игнорируется.
  const path = FUNNEL ? `/lead?funnel_id=${encodeURIComponent(FUNNEL)}` : "/lead";
  const { items } = await fetchAllPages(path, "/lead");

  // ДИАГНОСТИКА (Vercel logs): реальное имя поля воронки в ответе /lead. Смотрим
  // первые записи, чтобы понять, как называется id воронки и его значение для
  // «Новые лиды». Дёшево (2 строки/синк), помогает выставить FITBASE_LEADS_FUNNEL_ID.
  for (const l of items.slice(0, 2)) {
    console.log(
      "RAW LEAD KEYS",
      JSON.stringify({
        funnels_id: l.funnels_id,
        funnel_id: l.funnel_id,
        funnel: l.funnel,
        funnel_step: l.funnel_step,
        created_at: l.created_at,
      }),
    );
  }

  const mapped = items.map((l) => {
    // Достаём id воронки из всех правдоподобных мест (имя поля в API v2 плавает).
    const rawFunnel =
      l.funnels_id ??
      l.funnel_id ??
      (l.funnel && typeof l.funnel === "object" ? l.funnel.id : l.funnel) ??
      (l.funnel_step && typeof l.funnel_step === "object" ? l.funnel_step.funnels_id : null);
    const funnelId = rawFunnel != null ? String(rawFunnel) : null;
    return {
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
      funnelId,
      budget: Number(l.budget) || 0,
      createdAt: toDate(l.created_at),
      raw: l,
    };
  });

  // FAIL-OPEN: отбрасываем лид ТОЛЬКО если его воронка ЗНАЕМА и не равна целевой.
  // Неопознанную воронку (funnelId == null) НИКОГДА не выкидываем молча — иначе
  // рассинхрон имени поля обнулит всю таблицу. В худшем случае попадут лишние
  // воронки (это видно и легко чинится), но реальные лиды не пропадут.
  const rows = mapped.filter((r) => !FUNNEL || r.funnelId == null || r.funnelId === FUNNEL);
  return { rows, rawCount: items.length };
}

/** Визиты клиентов (/v2/client/visits) — посещаемость. Тянем недавние по updated_at. */
export async function fetchFitbaseVisits(range: DateRange): Promise<FitbaseVisitRow[]> {
  const fromUnix = Math.floor(new Date(`${range.from}T00:00:00Z`).getTime() / 1000);
  const { items } = await fetchAllPages(`/client/visits?updated_at=${fromUnix}`, "/client/visits");
  return items.map((v) => ({
    fitbaseId: String(v.id ?? ""),
    clientId: v.client_id != null ? String(v.client_id) : null,
    startAt: toDate(v.start_at),
    raw: v,
  }));
}

/** Абонементы (/v2/client-contract) — суммы оплат = LTV. */
export async function fetchFitbaseContracts(_range: DateRange, updatedSince?: number): Promise<FitbaseContractRow[]> {
  const { items } = await fetchAllPages(withUpdated("/client-contract", updatedSince), "/client-contract");
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

/**
 * Единая касса: абонементы (уже загруженные) + услуги + товары.
 * Абонементы передаём готовыми, чтобы не тянуть их дважды.
 * Услуги/товары — best-effort: их сбой (502/…) не роняет кассу, возвращаем флаги
 * успеха, чтобы ETL продвигал водяной знак только по реально загруженному.
 */
export async function fetchFitbasePayments(
  contracts: FitbaseContractRow[],
  servicesSince?: number,
  productsSince?: number,
): Promise<{ rows: FitbasePaymentRow[]; servicesOk: boolean; productsOk: boolean }> {
  let services: any[] = [];
  let products: any[] = [];
  let servicesOk = false;
  let productsOk = false;
  try {
    services = (await fetchAllPages(withUpdated("/client-service", servicesSince), "/client-service")).items;
    servicesOk = true;
  } catch (e) {
    console.error("Fitbase /client-service недоступен, пропускаю услуги:", e instanceof Error ? e.message : e);
  }
  try {
    products = (await fetchAllPages(withUpdated("/client-product", productsSince), "/client-product")).items;
    productsOk = true;
  } catch (e) {
    console.error("Fitbase /client-product недоступен, пропускаю товары:", e instanceof Error ? e.message : e);
  }

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

  return { rows: out, servicesOk, productsOk };
}
