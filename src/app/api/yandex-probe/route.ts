import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Диагностика: чем токен Яндекса может пользоваться (Метрика, Вебмастер, …).
 * Защищено CRON_SECRET. Дёргает лёгкие GET-эндпоинты и репортит статусы.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.YANDEX_TOKEN || process.env.YANDEX_METRIKA_TOKEN;
  if (!token) return NextResponse.json({ error: "YANDEX_TOKEN is not set" }, { status: 400 });

  const oauth = { Authorization: `OAuth ${token}` };
  const out: Record<string, unknown> = {};

  const probe = async (name: string, url: string, headers: Record<string, string> = oauth) => {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 300);
      }
      out[name] = { ok: res.ok, status: res.status, sample: summarize(body) };
      return body as any;
    } catch (e) {
      out[name] = { ok: false, error: e instanceof Error ? e.message : String(e) };
      return null;
    }
  };

  // Кто владелец токена
  await probe("passport_login", "https://login.yandex.ru/info?format=json");

  // Метрика — список всех счётчиков, доступных токену
  await probe("metrika_counters", "https://api-metrika.yandex.net/management/v1/counters?per_page=100");

  // Вебмастер — user_id, затем список сайтов
  const wmUser = await probe("webmaster_user", "https://api.webmaster.yandex.net/v4/user/");
  const userId = wmUser?.user_id;
  if (userId) {
    await probe("webmaster_hosts", `https://api.webmaster.yandex.net/v4/user/${userId}/hosts/`);
  }

  // Яндекс.Бизнес (партнёрский API — может быть недоступен)
  await probe("business_companies", "https://api.yandex-team.ru/v1/companies");

  return NextResponse.json(out);
}

/** Короткая сводка ответа: ключи + размеры массивов, без простыней. */
function summarize(body: unknown): unknown {
  if (Array.isArray(body)) return { array_len: body.length, first: body[0] };
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) r[k] = `[array ${v.length}]`;
      else if (v && typeof v === "object") r[k] = "{object}";
      else r[k] = v;
    }
    return r;
  }
  return body;
}
