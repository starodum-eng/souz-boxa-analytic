import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

export const dynamic = "force-dynamic";

const { channelGroups } = schema;

/**
 * Каналы отчёта и их родители (укрупнение). Список каналов берём из витрины
 * daily_metrics (что реально показывается в отчёте) + уже заданные группы.
 */
export async function GET() {
  const rows = await db.execute(sql`
    WITH ch AS (
      SELECT DISTINCT source AS channel FROM daily_metrics WHERE coalesce(source,'') <> ''
      UNION
      SELECT channel FROM channel_groups
    )
    SELECT ch.channel, g.parent
    FROM ch
    LEFT JOIN channel_groups g ON g.channel = ch.channel
    ORDER BY ch.channel
  `);
  // Список существующих родителей — для автоподсказок в UI.
  const parents = await db.execute(sql`SELECT DISTINCT parent FROM channel_groups WHERE coalesce(parent,'') <> '' ORDER BY parent`);
  return NextResponse.json({
    items: rows.rows,
    parents: (parents.rows as Array<{ parent: string }>).map((r) => r.parent),
  });
}

/**
 * Назначить/сменить родителя канала. Тело: { channel, parent }.
 * Пустой parent (или равный самому каналу) — убрать группировку (удалить запись).
 * Пересчёт витрины не нужен: группировка применяется на чтении в /api/metrics.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const channel = String(body?.channel ?? "").trim();
  const parent = String(body?.parent ?? "").trim();
  if (!channel) return NextResponse.json({ error: "channel required" }, { status: 400 });

  if (!parent || parent === channel) {
    await db.execute(sql`DELETE FROM channel_groups WHERE channel = ${channel}`);
  } else {
    await db
      .insert(channelGroups)
      .values({ channel, parent })
      .onConflictDoUpdate({ target: channelGroups.channel, set: { parent, updatedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}
