"use server";

import { runFullSync } from "@/lib/etl";

/**
 * Ручной запуск синхронизации из дашборда (кнопка «Обновить»).
 * Выполняется на сервере (Vercel), поэтому секрет cron здесь не нужен —
 * вызов идёт server-side, а не публичным HTTP-запросом.
 */
export async function syncNow() {
  const results = await runFullSync();
  return results;
}
