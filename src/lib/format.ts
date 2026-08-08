export const rub = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(
    Number(v) || 0,
  );

export const num = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("ru-RU").format(Number(v) || 0);

export const pct = (v: number | string | null | undefined) =>
  v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`;

export const SOURCE_LABEL: Record<string, string> = {
  yandex_direct: "Яндекс.Директ",
  yandex_metrika: "Яндекс.Метрика",
  yandex_business: "Яндекс.Бизнес",
  vk_ads: "VK Реклама",
  fitbase: "Fitbase",
  site: "Сайт (органика)",
};
