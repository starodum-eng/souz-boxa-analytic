import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Диагностика Fitbase: как правильно отфильтровать лиды по воронке.
 * В ответе /lead нет id воронки (только funnel_step), а ?funnel_id= сервер
 * игнорирует и отдаёт ВСЕ воронки. Этот пробник за один заход проверяет:
 *   1) какой query-параметр реально фильтрует /lead по воронке (сравниваем
 *      total_count разных вариантов — у правильного он резко меньше);
 *   2) есть ли эндпоинт справочника воронок с их этапами (чтобы фильтровать по
 *      принадлежности funnel_step → воронка).
 * Доступ — под логином дашборда (middleware). Ничего не пишет в БД.
 */
export async function GET() {
  const key = process.env.FITBASE_API_KEY;
  const domain = process.env.FITBASE_DOMAIN;
  if (!key || !domain) {
    return NextResponse.json({ error: "FITBASE_API_KEY / FITBASE_DOMAIN не заданы" }, { status: 400 });
  }
  const base = (process.env.FITBASE_BASE_URL || "https://api.fitbase.io/api/v2").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${key}`, domain, Accept: "application/json" };
  const FUNNEL = (process.env.FITBASE_LEADS_FUNNEL_ID ?? "1").trim() || "1";

  const call = async (path: string) => {
    try {
      const res = await fetch(`${base}${path}`, { headers });
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: res.ok, status: res.status, raw: text.slice(0, 200) };
      }
      const items = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : null;
      return {
        ok: res.ok,
        status: res.status,
        // total_count — главный маркер: у верного фильтра он резко меньше «всех».
        total_count: json?.total_count ?? json?.count ?? null,
        items_on_page: items ? items.length : null,
        top_keys: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json).slice(0, 12) : null,
        sample: shape(items ? items[0] : json),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // 1) Какой параметр фильтрует /lead по воронке? Сравниваем total_count.
  const leadFilters: Record<string, unknown> = {};
  const sep = "&page=1&page_size=1";
  leadFilters["no_filter"] = await call(`/lead?${sep.slice(1)}`);
  for (const p of ["funnel_id", "funnels_id", "funnel", "pipeline_id", "funnel_step_id"]) {
    leadFilters[`${p}=${FUNNEL}`] = await call(`/lead?${p}=${encodeURIComponent(FUNNEL)}${sep}`);
  }

  // 2) Эндпоинт справочника воронок (нужны id воронки + её этапы).
  const funnelDirs: Record<string, unknown> = {};
  for (const path of ["/funnel", "/funnels", `/funnel/${FUNNEL}`, "/lead-funnel", "/pipeline", "/funnel-step", "/funnel/step"]) {
    funnelDirs[path] = await call(path.includes("?") ? path : `${path}?page=1&page_size=100`);
  }

  return NextResponse.json({ funnelConfigured: FUNNEL, leadFilters, funnelDirs });
}

/** Форма объекта: ключи → тип/значение (без простыней), с раскрытием funnel_step. */
function shape(v: unknown): unknown {
  if (v == null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const r: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(o)) {
    if (val && typeof val === "object") {
      // Раскрываем вложенные объекты, важные для атрибуции воронки.
      if (["funnel_step", "funnel", "pipeline"].includes(k)) r[k] = val;
      else if (Array.isArray(val)) r[k] = `[array ${val.length}${val.length ? `] first=${JSON.stringify(shape(val[0])).slice(0, 120)}` : "]"}`;
      else r[k] = "{object}";
    } else {
      r[k] = val;
    }
  }
  return r;
}
