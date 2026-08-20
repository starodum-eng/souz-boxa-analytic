import { NextRequest, NextResponse } from "next/server";

/**
 * Авторизация дашборда через cookie-сессию (форма /login).
 * Логин/пароль — DASHBOARD_USER / DASHBOARD_PASSWORD. Если не заданы — не блокируем.
 * Cookie sb_auth = SHA-256(user:password), живёт 30 дней → логинимся один раз.
 *
 * Публично (без логина):
 *   статические файлы (в т.ч. /lead-tracker.js для внешнего сайта),
 *   /api/lead (вебхук форм), /api/cron (крон),
 *   /login и /api/login (сама страница входа).
 */
const PUBLIC_PREFIXES = ["/api/lead", "/api/cron", "/api/login", "/login"];
const STATIC_FILE = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|txt|xml|json|pdf)$/i;

async function tokenFor(user: string, pass: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${user}:${pass}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    STATIC_FILE.test(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.next();
  }

  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return NextResponse.next(); // защита не настроена

  const cookie = req.cookies.get("sb_auth")?.value;
  if (cookie && cookie === (await tokenFor(user, pass))) {
    return NextResponse.next();
  }

  // Не авторизован: API → 401, страницы → редирект на форму входа.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
