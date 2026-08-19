import { NextResponse } from "next/server";
import { eq, gte } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { PLATFORM_KEYS, currentMondayMsk, mondayOf, addDaysStr } from "@/lib/smm";

export const dynamic = "force-dynamic";

const { smmWeekly } = schema;
const validDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const int = (v: unknown) => Math.trunc(Number(v)) || 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const weeksParam = url.searchParams.get("weeks");

  // Режим трендов: последние N недель.
  if (weeksParam) {
    const n = Math.max(1, Math.min(52, Number(weeksParam) || 12));
    const cutoff = addDaysStr(currentMondayMsk(), -(n - 1) * 7);
    const rows = await db
      .select()
      .from(smmWeekly)
      .where(gte(smmWeekly.weekStart, cutoff))
      .orderBy(smmWeekly.weekStart);
    const weeks = [...new Set(rows.map((r) => String(r.weekStart)))].sort();
    const byPlatform = rows.map((r) => ({
      platform: r.platform,
      week: String(r.weekStart),
      reach: r.reach,
      followers: r.followers,
      engagement: r.engagement,
      posts: r.posts,
      spend: Number(r.spend),
    }));
    return NextResponse.json({ weeks, byPlatform });
  }

  // Режим одной недели + подписчики прошлой недели (для прироста).
  const week = validDate(url.searchParams.get("week")) ? mondayOf(url.searchParams.get("week")!) : currentMondayMsk();
  const rows = await db.select().from(smmWeekly).where(eq(smmWeekly.weekStart, week));
  const prevRows = await db.select().from(smmWeekly).where(eq(smmWeekly.weekStart, addDaysStr(week, -7)));
  const prevFollowers: Record<string, number> = {};
  for (const r of prevRows) prevFollowers[r.platform] = r.followers;

  return NextResponse.json({
    weekStart: week,
    rows: rows.map((r) => ({
      platform: r.platform,
      posts: r.posts,
      reach: r.reach,
      engagement: r.engagement,
      followers: r.followers,
      clicks: r.clicks,
      spend: Number(r.spend),
      note: r.note ?? "",
    })),
    prevFollowers,
  });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const week = validDate(String(b.weekStart ?? "")) ? mondayOf(String(b.weekStart)) : null;
  const platform = String(b.platform ?? "");
  if (!week || !PLATFORM_KEYS.has(platform)) {
    return NextResponse.json({ error: "Некорректный weekStart или platform" }, { status: 400 });
  }

  const values = {
    weekStart: week,
    platform,
    posts: int(b.posts),
    reach: int(b.reach),
    engagement: int(b.engagement),
    followers: int(b.followers),
    clicks: int(b.clicks),
    spend: String(Number(b.spend) || 0),
    note: b.note ? String(b.note).slice(0, 512) : null,
    updatedAt: new Date(),
  };

  await db
    .insert(smmWeekly)
    .values(values)
    .onConflictDoUpdate({
      target: [smmWeekly.weekStart, smmWeekly.platform],
      set: {
        posts: values.posts,
        reach: values.reach,
        engagement: values.engagement,
        followers: values.followers,
        clicks: values.clicks,
        spend: values.spend,
        note: values.note,
        updatedAt: new Date(),
      },
    });
  return NextResponse.json({ ok: true, weekStart: week, platform });
}
