import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const { leadTouches } = schema;

// Вебхук вызывается с сайта клуба (другой домен), поэтому разрешаем CORS.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Приём заявки с формы сайта. Тело JSON:
 *   { phone, utm_source?, utm_medium?, utm_campaign?, channel?, channel_name?,
 *     external_id?, ym_client_id?, page?, comment? }
 * Телефон нормализуем (последние 10 цифр) — это ключ склейки с Fitbase.
 * Дедуп: одно касание формы на телефон в день (external_id = form:<phone>:<дата>).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !body.phone) {
    return NextResponse.json({ error: "phone required" }, { status: 400, headers: CORS });
  }
  const phoneNorm = normalizePhone(body.phone);
  if (!phoneNorm) {
    return NextResponse.json({ error: "invalid phone" }, { status: 400, headers: CORS });
  }

  const today = new Date().toISOString().slice(0, 10);
  const externalId: string = body.external_id || `form:${phoneNorm}:${today}`;

  await db
    .insert(leadTouches)
    .values({
      externalId,
      channel: body.channel || "form",
      phoneNorm,
      phoneRaw: String(body.phone).slice(0, 64),
      utmSource: body.utm_source ?? null,
      utmMedium: body.utm_medium ?? null,
      utmCampaign: body.utm_campaign ?? null,
      channelName: body.channel_name ?? null,
      createdAt: new Date(),
      raw: body,
    })
    // Первое касание за день сохраняем, повторные — игнорируем (first-touch).
    .onConflictDoNothing({ target: leadTouches.externalId });

  return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
}
