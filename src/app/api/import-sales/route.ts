import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { parseCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Импорт выручки из отчёта Fitbase «Отчёт по продажам» (Финансы → Выгрузить в CSV).
 * Это источник правды по выручке: включает онлайн-платежи/продления CloudPayments,
 * которых нет в объектном API. Колонки сопоставляются по ЗАГОЛОВКАМ (устойчиво к
 * порядку/набору столбцов), сумма берётся из «Оплачено, ₽».
 *
 * POST multipart/form-data: file=<csv>, secret=<CRON_SECRET>
 *   либо POST с ?key=<CRON_SECRET> и телом CSV.
 */

const { salesLedger } = schema;

function norm(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function letters(s: string): string {
  return (s || "").toLowerCase().replace(/[^а-яё]/gi, "");
}

/** Индексы колонок по заголовкам отчёта. */
function mapColumns(header: string[]) {
  const H = header.map(norm);
  const find = (pred: (h: string, i: number) => boolean) => H.findIndex(pred);
  const idx = {
    clientId: find((h) => h === "id клиента"),
    payDate: find((h) => h === "дата оплаты"),
    accrualDate: find((h) => h === "дата начисления"),
    clientName: find((h) => h === "клиент"),
    kind: find((h) => h === "тип"),
    name: find((h) => h === "наименование"),
    category: find((h) => h === "категория"),
    manager: find((h) => h === "отв. менеджер"),
    method: find((h) => h === "способ оплаты"),
    // «Оплачено, ₽» — фактически оплаченная сумма; НЕ «оплачено за вычетом комиссии»
    amount: header.findIndex((h) => letters(h) === "оплачено"),
    renewal: find((h) => h.startsWith("статус продления")),
    receipt: find((h) => h === "чек"),
  };
  if (idx.amount < 0) idx.amount = find((h) => h === "итоговая стоимость, ₽" || h.startsWith("итоговая стоимость"));
  return idx;
}

function parseRuDate(s: string): Date | null {
  const m = (s || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "00", mi = "00"] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh.padStart(2, "0")}:${mi}:00+03:00`);
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(s: string): number {
  const n = parseFloat((s || "").replace(/ /g, "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST CSV сюда: file=<csv>, secret=<CRON_SECRET>" });
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);

  let csvText = "";
  let providedSecret = url.searchParams.get("key") ?? url.searchParams.get("secret") ?? "";
  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) providedSecret = secret ?? "";

  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const f = form.get("file");
    if (form.get("secret")) providedSecret = String(form.get("secret"));
    if (f && typeof (f as File).text === "function") csvText = await (f as File).text();
    else if (form.get("csv")) csvText = String(form.get("csv"));
  } else {
    csvText = await req.text();
  }

  if (secret && providedSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!csvText.trim()) {
    return NextResponse.json({ error: "Пустой файл. Ожидается CSV из «Отчёт по продажам»." }, { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return NextResponse.json({ error: "В файле нет строк данных." }, { status: 400 });
  }
  const header = rows[0];
  const c = mapColumns(header);

  const missing = (["clientId", "payDate", "amount"] as const).filter((k) => c[k] < 0);
  if (missing.length) {
    return NextResponse.json(
      { error: `Не найдены колонки: ${missing.join(", ")}`, detected_headers: header },
      { status: 400 },
    );
  }

  const at = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i] : "");
  const seen = new Set<string>();
  const records: (typeof salesLedger.$inferInsert)[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((x) => (x ?? "").trim())) continue; // пустая строка
    const clientId = at(r, c.clientId).trim() || null;
    const payDate = parseRuDate(at(r, c.payDate));
    const amount = parseAmount(at(r, c.amount));
    const name = at(r, c.name).trim() || null;
    const method = at(r, c.method).trim() || null;
    const receipt = c.receipt >= 0 ? at(r, c.receipt).trim() : "";

    // ext_id: устойчивый ключ дедупа (чек уникален; иначе — состав полей)
    const keySrc = receipt || `${clientId}|${payDate?.toISOString() ?? ""}|${amount}|${name}|${method}`;
    const extId = "sl_" + createHash("sha1").update(keySrc).digest("hex");
    if (seen.has(extId)) {
      skipped++;
      continue;
    }
    seen.add(extId);

    records.push({
      extId,
      clientId,
      clientName: at(r, c.clientName).trim() || null,
      payDate,
      accrualDate: parseRuDate(at(r, c.accrualDate)),
      amount: String(amount),
      method,
      kind: at(r, c.kind).trim() || null,
      name,
      category: at(r, c.category).trim() || null,
      manager: at(r, c.manager).trim() || null,
      raw: { renewal: c.renewal >= 0 ? at(r, c.renewal) : null, row: r },
    });
  }

  // Пакетная запись с апсертом по ext_id (повторный импорт не плодит дубли).
  const CHUNK = 500;
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = records.slice(i, i + CHUNK);
    await db
      .insert(salesLedger)
      .values(batch)
      .onConflictDoUpdate({
        target: [salesLedger.extId],
        set: {
          clientId: sql`excluded.client_id`,
          clientName: sql`excluded.client_name`,
          payDate: sql`excluded.pay_date`,
          accrualDate: sql`excluded.accrual_date`,
          amount: sql`excluded.amount`,
          method: sql`excluded.method`,
          kind: sql`excluded.kind`,
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          manager: sql`excluded.manager`,
          raw: sql`excluded.raw`,
          importedAt: new Date(),
        },
      });
  }

  // Сводка для проверки, что залилось верно.
  const byMethod: Record<string, number> = {};
  let sum = 0;
  let minD = "";
  let maxD = "";
  for (const r of records) {
    const a = Number(r.amount);
    sum += a;
    const mth = r.method ?? "—";
    byMethod[mth] = (byMethod[mth] ?? 0) + a;
    const d = r.payDate ? r.payDate.toISOString().slice(0, 10) : "";
    if (d && (!minD || d < minD)) minD = d;
    if (d && (!maxD || d > maxD)) maxD = d;
  }

  return NextResponse.json({
    ok: true,
    parsed_rows: records.length,
    skipped_duplicates_in_file: skipped,
    sum_paid: Math.round(sum * 100) / 100,
    by_method: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    date_range: { from: minD, to: maxD },
    note: "Готово. Обнови дашборд — «Касса за период» теперь считается из этого журнала.",
  });
}
