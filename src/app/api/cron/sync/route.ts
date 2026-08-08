import { NextResponse } from "next/server";
import { runFullSync } from "@/lib/etl";

// Синхронизация может идти дольше стандартного лимита — просим побольше времени.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Эндпоинт вызывается Vercel Cron (см. vercel.json) по расписанию.
 * Vercel добавляет заголовок Authorization: Bearer $CRON_SECRET — проверяем его,
 * чтобы синк нельзя было дёрнуть снаружи.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await runFullSync();
  const ok = results.every((r) => r.status === "ok");
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
}
