import { NextResponse } from "next/server";
import { runFullSync } from "@/lib/etl";

// Ручной запуск синхронизации из дашборда (кнопка «Обновить данные»).
// В отличие от Server Action, обычный роут адресуется по URL и не ломается
// при рассинхроне версий (открытая вкладка со старой сборкой + новый деплой).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  const results = await runFullSync();
  const ok = results.every((r) => r.status === "ok");
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
}
