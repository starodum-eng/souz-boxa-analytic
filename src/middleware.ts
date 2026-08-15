import { NextRequest, NextResponse } from "next/server";

/**
 * Basic Auth на весь дашборд.
 * Логин/пароль берутся из переменных окружения DASHBOARD_USER / DASHBOARD_PASSWORD.
 * Если они не заданы — доступ не блокируется (чтобы не залочить проект случайно).
 *
 * Исключения (работают без логина):
 *   /api/lead        — вебхук форм с сайта (внешний источник, свой CORS)
 *   /api/cron        — вызывается Vercel-кроном с Bearer CRON_SECRET (своя защита)
 *   статические файлы — в т.ч. /lead-tracker.js, который грузит внешний сайт.
 *     ВАЖНО: если закрыть их логином, браузер на стороне сайта показывает попап
 *     авторизации при загрузке скрипта. Поэтому статику никогда не гейтим.
 */
const PUBLIC_PREFIXES = ["/api/lead", "/api/cron"];
// Любой файл с расширением (js/css/png/…) — публичная статика.
const STATIC_FILE = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|txt|xml|json|pdf)$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    STATIC_FILE.test(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.next();
  }

  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return NextResponse.next(); // защита не настроена — пропускаем

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const i = decoded.indexOf(":");
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === user && p === pass) return NextResponse.next();
    } catch {
      // некорректный заголовок — попросим авторизацию ниже
    }
  }

  return new NextResponse("Требуется авторизация", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Souz Boksa Analytics", charset="UTF-8"' },
  });
}

export const config = {
  // Защищаем всё, кроме статики Next и фавикона.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
