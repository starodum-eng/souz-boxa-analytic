import type { DateRange } from "./types";

/**
 * Яндекс.Бизнес.
 * У Яндекс.Бизнеса нет единого публичного REST API для всей статистики —
 * доступ выдаётся точечно (партнёрский API / выгрузки). Чаще всего полезны:
 *  - показы и переходы карточки организации,
 *  - звонки, построения маршрутов,
 *  - отзывы и рейтинг.
 *
 * Заготовка: возвращаем дневные показы/переходы карточки. Точный эндпоинт и
 * авторизацию нужно уточнить под конкретный выданный вам доступ.
 */

export interface BusinessRow {
  date: string;
  impressions: number;
  clicks: number; // переходы/действия по карточке
  raw?: unknown;
}

export async function fetchYandexBusiness(range: DateRange): Promise<BusinessRow[]> {
  const token = process.env.YANDEX_BUSINESS_TOKEN || process.env.YANDEX_TOKEN;
  const companyId = process.env.YANDEX_BUSINESS_COMPANY_ID;
  if (!token || !companyId) {
    // Не роняем весь синк, если доступ к Бизнесу ещё не настроен.
    throw new Error("YANDEX_BUSINESS_TOKEN / YANDEX_BUSINESS_COMPANY_ID is not set");
  }

  // TODO: подставить реальный эндпоинт из выданной вам документации Яндекс.Бизнеса.
  // Ниже — плейсхолдер структуры, чтобы ETL-контур был готов.
  void range;
  return [];
}
