import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Токен cookie = SHA-256(user:password). Меняется при смене пароля → старые сессии инвалидируются. */
async function tokenFor(user: string, pass: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${user}:${pass}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: Request) {
  const { user, password } = (await req.json().catch(() => ({}))) as { user?: string; password?: string };
  const U = process.env.DASHBOARD_USER;
  const P = process.env.DASHBOARD_PASSWORD;

  // Защита не настроена — вход не требуется.
  if (!U || !P) return NextResponse.json({ ok: true, note: "auth disabled" });

  if (user === U && password === P) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("sb_auth", await tokenFor(U, P), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 дней
    });
    return res;
  }
  return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
}
