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
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  trafficSource: string; // тип источника трафика Метрики: organic | direct | ad | ...
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

/** Лид из воронки Fitbase (/v2/lead) — атрибуция канала + этап. */
export interface FitbaseLeadRow {
  fitbaseId: string;
  clientId: string | null;
  phoneNorm: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  advertisingSource: string | null; // Сайт/Звонок/Трафик (справочник Fitbase)
  funnelStep: string | null;
  funnelId: string | null; // id воронки (funnels_id) — фильтр «Новые лиды»
  budget: number;
  createdAt: Date | null;
  raw?: unknown;
}

/** Абонемент клиента Fitbase (/v2/client-contract) — деньги/LTV. */
export interface FitbaseContractRow {
  fitbaseId: string;
  clientId: string | null;
  amount: number; // сумма оплаты
  paid: boolean;
  paymentDate: Date | null; // дата платежа — для «кассы за период»
  beginDate: Date | null;
  endDate: Date | null;
  createdAt: Date | null;
  raw?: unknown;
}

/** Платёж клиента Fitbase (абонемент/услуга/товар) — единая касса. */
export interface FitbasePaymentRow {
  extId: string; // kind:id — уникален across типов
  kind: string; // contract | service | product
  clientId: string | null;
  amount: number;
  paid: boolean;
  payDate: Date | null;
  raw?: unknown;
}

/** Визит клиента Fitbase (/v2/client/visits) — посещаемость. */
export interface FitbaseVisitRow {
  fitbaseId: string;
  clientId: string | null;
  startAt: Date | null;
  raw?: unknown;
}

export type SourceKey =
  | "yandex_direct"
  | "yandex_metrika"
  | "yandex_business"
  | "vk_ads"
  | "fitbase"
  | "callibri";

/** Утилита: строка последних N дней в формате YYYY-MM-DD. */
export function lastNDays(n: number): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - n);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}
