/**
 * Единый конфиг KPI-метрик для план/факта.
 * Используется во вводе целей, в расчёте факта и на дашборде.
 */
export type KpiDir = "up" | "down"; // up — больше лучше, down — меньше лучше
export type KpiType = "flow" | "eff"; // поток (накапливается) / эффективность (отношение)
export type KpiUnit = "шт" | "₽" | "%";

export interface KpiMetric {
  key: string;
  label: string;
  unit: KpiUnit;
  dir: KpiDir;
  type: KpiType;
}

export const KPI_METRICS: KpiMetric[] = [
  { key: "leads", label: "Лиды", unit: "шт", dir: "up", type: "flow" },
  { key: "new_clients", label: "Клиенты", unit: "шт", dir: "up", type: "flow" },
  { key: "revenue", label: "Выручка (касса)", unit: "₽", dir: "up", type: "flow" },
  { key: "cost", label: "Расход (бюджет)", unit: "₽", dir: "down", type: "flow" },
  { key: "cpl", label: "CPL", unit: "₽", dir: "down", type: "eff" },
  { key: "cac", label: "CAC", unit: "₽", dir: "down", type: "eff" },
  { key: "drr", label: "ДРР", unit: "%", dir: "down", type: "eff" },
  { key: "romi", label: "ROMI", unit: "%", dir: "up", type: "eff" },
  { key: "conv_lead", label: "Конв. визит→лид", unit: "%", dir: "up", type: "eff" },
  { key: "conv_sale", label: "Конв. клиент→оплата", unit: "%", dir: "up", type: "eff" },
];

export const KPI_KEYS = new Set(KPI_METRICS.map((m) => m.key));

/** Текущий месяц 'YYYY-MM' в таймзоне Europe/Moscow. */
export function currentMonthMsk(): string {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return s.slice(0, 7);
}
