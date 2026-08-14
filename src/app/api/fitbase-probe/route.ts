import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Диагностика Fitbase: что реально отдаёт API по деньгам за август.
 * Задача — понять, где живут ~56 платёжных событий, которые Fitbase показывает
 * в «Выручке», но которых нет в объектных таблицах (client-contract/service/product).
 *
 * Доступ (любой из вариантов):
 *   - заголовок Authorization: Bearer <CRON_SECRET>
 *   - ?secret=<CRON_SECRET>
 *   - ?key=boxa-diag  (временный диагностический ключ, чтобы открыть из браузера;
 *     роут одноразовый и будет удалён после сверки выручки)
 */

const BASE = (process.env.FITBASE_BASE_URL || "https://api.fitbase.io/api/v2").replace(/\/$/, "");
const DIAG_KEY = "boxa-diag";

// Границы «1–11 августа 2026» в МSK, в unix-секундах.
const AUG_FROM = Math.floor(Date.parse("2026-08-01T00:00:00+03:00") / 1000);
const AUG_TO = Math.floor(Date.parse("2026-08-12T00:00:00+03:00") / 1000);

function fbHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.FITBASE_API_KEY ?? ""}`,
    domain: process.env.FITBASE_DOMAIN ?? "",
    Accept: "application/json",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  for (let a = 0; a < 5; a++) {
    const res = await fetch(`${BASE}${path}`, { headers: fbHeaders() });
    if (res.status === 429) {
      await sleep(1200 * (a + 1));
      continue;
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 300);
    }
    return { status: res.status, body };
  }
  return { status: 429, body: "rate-limited after retries" };
}

function items(b: unknown): any[] {
  if (Array.isArray(b)) return b;
  if (b && typeof b === "object") {
    const o = b as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as any[];
    if (Array.isArray(o.items)) return o.items as any[];
  }
  return [];
}

function inAug(v: unknown): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n >= AUG_FROM && n < AUG_TO;
}

function money(x: any) {
  return {
    id: x.id,
    payment: x.payment,
    payment_date: x.payment_date,
    pay_date: x.pay_date,
    created_at: x.created_at,
    updated_at: x.updated_at,
    begin_date: x.begin_date,
    price: x.price,
    price_full: x.price_full,
    amount_of_payment: x.amount_of_payment,
    pay_amount: x.pay_amount,
    amount: x.amount,
    recurrent: x.recurrent,
    name: x.contract_name ?? x.name,
  };
}

/** Ключи объекта + какие из них массивы (там могут прятаться платежи/история). */
function shape(x: any): { keys: string[]; arrays: string[] } {
  if (!x || typeof x !== "object") return { keys: [], arrays: [] };
  const keys = Object.keys(x);
  const arrays = keys.filter((k) => Array.isArray(x[k]));
  return { keys, arrays };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const authorized =
    req.headers.get("authorization") === `Bearer ${secret}` ||
    url.searchParams.get("secret") === secret ||
    url.searchParams.get("key") === DIAG_KEY;
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const out: Record<string, unknown> = { aug_window_unix: { from: AUG_FROM, to: AUG_TO } };
  let firstContractId: string | number | null = null;

  // A) Обычная первая страница + total_count + ключи записи.
  for (const ep of ["/client-contract", "/client-service", "/client-product"]) {
    const r = await getJson(`${ep}?page=1&page_size=100`);
    const arr = items(r.body);
    if (ep === "/client-contract" && arr[0]) firstContractId = arr[0].id ?? null;
    out[`A ${ep}`] = {
      status: r.status,
      total_count: (r.body as any)?.total_count ?? null,
      returned: arr.length,
      keys: arr[0] ? Object.keys(arr[0]) : null,
    };
  }

  // B) Фильтр updated_at (как в /client/visits): всплывут ли продления/свежие платежи.
  for (const ep of ["/client-contract", "/client-service"]) {
    const r = await getJson(`${ep}?updated_at=${AUG_FROM}&page=1&page_size=100`);
    const arr = items(r.body);
    out[`B ${ep}?updated_at`] = {
      status: r.status,
      total_count: (r.body as any)?.total_count ?? null,
      returned: arr.length,
      with_pay_in_aug: arr.filter((x: any) => inAug(x.payment_date ?? x.pay_date)).length,
      with_updated_in_aug: arr.filter((x: any) => inAug(x.updated_at)).length,
      samples: arr.slice(0, 10).map(money),
    };
  }

  // C) Деталь одного абонемента /client-contract/{id}: есть ли там массив платежей,
  //    которого нет в списке (история продлений/рассрочки).
  if (firstContractId != null) {
    const r = await getJson(`/client-contract/${firstContractId}`);
    const detail = (r.body as any)?.data ?? r.body;
    out["C /client-contract/{id}"] = {
      status: r.status,
      id: firstContractId,
      shape: shape(detail),
      raw: detail,
    };
  }

  return NextResponse.json(out, { status: 200 });
}
