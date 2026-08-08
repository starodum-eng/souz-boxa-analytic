/**
 * Нормализация телефона к ключу склейки: последние 10 цифр.
 * 79031480804 / +7 903 148-08-04 / 89031480804 → "9031480804".
 * Так телефоны из Fitbase, Callibri и форм сходятся между собой.
 */
export function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
