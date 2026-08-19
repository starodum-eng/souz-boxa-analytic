/**
 * Конфиг SMM-площадок (единый для API, иконок, легенды и линий графиков)
 * + хелперы недель (понедельник Europe/Moscow).
 */
export interface Platform {
  key: string;
  label: string;
  color: string;
}

export const PLATFORMS: Platform[] = [
  { key: "vk", label: "VK", color: "#2787F5" },
  { key: "telegram", label: "Telegram", color: "#29A9EB" },
  { key: "max", label: "MAX", color: "#6C5CE7" },
  { key: "instagram", label: "Instagram", color: "#C13584" },
  { key: "youtube", label: "YouTube", color: "#FF0000" },
  { key: "tiktok", label: "TikTok", color: "#EE1D52" },
  { key: "other", label: "Другое", color: "#7a8698" },
];

export const PLATFORM_KEYS = new Set(PLATFORMS.map((p) => p.key));

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Понедельник недели, в которую попадает дата 'YYYY-MM-DD'. */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 0 = понедельник
  dt.setDate(dt.getDate() - dow);
  return fmt(dt);
}

/** Прибавить n дней к 'YYYY-MM-DD'. */
export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return fmt(dt);
}

/** Текущий понедельник (МСК). */
export function currentMondayMsk(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return mondayOf(today);
}
