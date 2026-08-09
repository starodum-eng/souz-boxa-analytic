import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { recomputeDailyMetrics } from "@/lib/etl";

export const dynamic = "force-dynamic";

const { sourceMappings } = schema;

/**
 * Список UTM-меток, встреченных в данных (веб-сессии + касания форм/Callibri),
 * со статистикой и текущим присвоенным названием канала.
 * Плюс метки, для которых уже есть запись в справочнике.
 */
export async function GET() {
  const rows = await db.execute(sql`
    WITH src AS (
      SELECT lower(utm_source) AS u, visits AS v, goal_reaches AS l, 0 AS t
      FROM web_sessions WHERE coalesce(utm_source,'') <> ''
      UNION ALL
      SELECT lower(utm_source) AS u, 0, 0, 1
      FROM lead_touches WHERE coalesce(utm_source,'') <> ''
      UNION ALL
      SELECT utm_source AS u, 0, 0, 0 FROM source_mappings
    )
    SELECT
      src.u AS utm_source,
      SUM(src.v)::int AS visits,
      SUM(src.l)::int AS leads,
      SUM(src.t)::int AS touches,
      m.label AS label,
      coalesce(m.ignored, 0) AS ignored
    FROM src
    LEFT JOIN source_mappings m ON m.utm_source = src.u
    GROUP BY src.u, m.label, m.ignored
    ORDER BY (coalesce(m.label,'') <> ''), SUM(src.v) DESC, SUM(src.t) DESC
  `);
  return NextResponse.json({ items: rows.rows });
}

/**
 * Присвоить/изменить название канала для UTM-метки.
 * Тело: { utm_source, label }. Пустой label — удалить сопоставление.
 * После сохранения пересчитываем витрину, чтобы дашборд сразу обновился.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const utmSource = String(body?.utm_source ?? "").trim().toLowerCase();
  const label = String(body?.label ?? "").trim();
  const ignored = body?.ignored === true;
  if (!utmSource) {
    return NextResponse.json({ error: "utm_source required" }, { status: 400 });
  }

  if (ignored) {
    // Скрыть метку: запись остаётся (label пустой, ignored=1), на дашборде → «Сайт (прочее)».
    await db
      .insert(sourceMappings)
      .values({ utmSource, label: "", ignored: 1 })
      .onConflictDoUpdate({
        target: sourceMappings.utmSource,
        set: { label: "", ignored: 1, updatedAt: new Date() },
      });
  } else if (!label) {
    // Ни названия, ни скрытия — удаляем запись (метка снова «неразмеченная»).
    await db.execute(sql`DELETE FROM source_mappings WHERE utm_source = ${utmSource}`);
  } else {
    await db
      .insert(sourceMappings)
      .values({ utmSource, label, ignored: 0 })
      .onConflictDoUpdate({
        target: sourceMappings.utmSource,
        set: { label, ignored: 0, updatedAt: new Date() },
      });
  }

  await recomputeDailyMetrics();
  return NextResponse.json({ ok: true });
}
