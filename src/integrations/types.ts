/**
 * Общий контракт для всех интеграций.
 * Каждый источник умеет вернуть свои строки за период [from, to].
 * ETL-оркестратор складывает их в соответствующие таблицы и пересчитывает витрину.
 */

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface AdSpendRow {
  date: string;
  campaignId: string | null;
  campaignName: string | null;
  utmCampaign: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  raw?: unknown;
}

export interface WebSessionRow {
  date: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  visits: number;
  users: number;
  bounces: number;
  goalReaches: number;
  raw?: unknown;
}

export interface ClientRow {
  fitbaseId: string;
  name: string | null;
  phone: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: Date | null;
  raw?: unknown;
}

export interface SaleRow {
  fitbaseId: string;
  date: string;
  clientFitbaseId: string | null;
  product: string | null;
  amount: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  raw?: unknown;
}

export type SourceKey =
  | "yandex_direct"
  | "yandex_metrika"
  | "yandex_business"
  | "vk_ads"
  | "fitbase";

/** Утилита: строка последних N дней в формате YYYY-MM-DD. */
export function lastNDays(n: number): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - n);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}
