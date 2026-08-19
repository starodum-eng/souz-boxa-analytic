"use client";

import { useEffect, useMemo, useState } from "react";
import { rub } from "@/lib/format";

interface CohortsData {
  currentMonth: string;
  maxAge: number;
  cacBlended: number | null;
  sizes: { cohort: string; clients: number }[];
  revCells: { cohort: string; age: number; revenue: number }[];
  visitCells: { cohort: string; age: number; active: number }[];
}

type View = "ltv" | "ret";

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export default function Cohorts() {
  const [data, setData] = useState<CohortsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("ltv");

  useEffect(() => {
    fetch("/api/cohorts")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  const model = useMemo(() => {
    if (!data) return null;
    const sizeMap = new Map(data.sizes.map((s) => [s.cohort, s.clients]));
    const revMap = new Map(data.revCells.map((c) => [`${c.cohort}|${c.age}`, c.revenue]));
    const visMap = new Map(data.visitCells.map((c) => [`${c.cohort}|${c.age}`, c.active]));
    const cohorts = data.sizes.map((s) => s.cohort); // отсортированы старые→новые

    const observedMax = Math.max(
      0,
      ...data.revCells.map((c) => c.age),
      ...data.visitCells.map((c) => c.age),
    );
    const maxCol = Math.min(data.maxAge, Math.max(0, observedMax));
    const ages = Array.from({ length: maxCol + 1 }, (_, i) => i);

    const livedOf = (cohort: string) => monthsBetween(cohort, data.currentMonth);

    // Накопленный доход и активные по когорте×возраст.
    const cumRev: Record<string, number[]> = {};
    const activeArr: Record<string, number[]> = {};
    for (const c of cohorts) {
      let run = 0;
      cumRev[c] = [];
      activeArr[c] = [];
      for (const a of ages) {
        run += revMap.get(`${c}|${a}`) ?? 0;
        cumRev[c][a] = run;
        activeArr[c][a] = visMap.get(`${c}|${a}`) ?? 0;
      }
    }

    // Значение ячейки (null = будущее, не прожито).
    const cell = (c: string, a: number): number | null => {
      if (a > livedOf(c)) return null;
      const size = sizeMap.get(c) ?? 0;
      if (size <= 0) return null;
      return view === "ltv" ? cumRev[c][a] / size : (activeArr[c][a] / size) * 100;
    };

    // Blended-кривая (взвешенно по размеру когорт, доживших до возраста a).
    const blended: (number | null)[] = [];
    const ltvBlended: (number | null)[] = [];
    for (const a of ages) {
      let sumSize = 0,
        sumCum = 0,
        sumActive = 0;
      for (const c of cohorts) {
        if (livedOf(c) < a) continue;
        const size = sizeMap.get(c) ?? 0;
        sumSize += size;
        sumCum += cumRev[c][a];
        sumActive += activeArr[c][a];
      }
      ltvBlended[a] = sumSize > 0 ? sumCum / sumSize : null;
      blended[a] = view === "ltv" ? ltvBlended[a] : sumSize > 0 ? (sumActive / sumSize) * 100 : null;
    }

    // Максимум для тепловой заливки.
    let maxCell = 0;
    for (const c of cohorts) for (const a of ages) {
      const v = cell(c, a);
      if (v != null && v > maxCell) maxCell = v;
    }

    // Итоговый LTV/клиент (накопл. до последнего прожитого возраста).
    const totalLtv = (c: string) => {
      const size = sizeMap.get(c) ?? 0;
      const lived = Math.min(livedOf(c), maxCol);
      return size > 0 && lived >= 0 ? cumRev[c][lived] / size : null;
    };

    // Окупаемость: первый возраст, где blended LTV/клиент ≥ CAC.
    let paybackAge: number | null = null;
    if (data.cacBlended != null) {
      for (const a of ages) {
        if (ltvBlended[a] != null && (ltvBlended[a] as number) >= data.cacBlended) {
          paybackAge = a;
          break;
        }
      }
    }

    return { sizeMap, cohorts, ages, cell, blended, maxCell, totalLtv, paybackAge, livedOf, maxCol };
  }, [data, view]);

  const fmt = (v: number | null) => (v == null ? "" : view === "ltv" ? rub(v) : `${Math.round(v)}%`);
  const bg = (v: number | null, maxCell: number) => {
    if (v == null) return "transparent";
    const denom = view === "ltv" ? maxCell || 1 : 100;
    const a = Math.min(0.85, (v / denom) * 0.85);
    return view === "ltv" ? `rgba(224,39,27,${a})` : `rgba(26,160,83,${a})`;
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Когорты</h1>
          <div className="sub">Клиенты по месяцу входа: как копится LTV и держится посещаемость.</div>
        </div>
        <div className="controls">
          <button className={view === "ltv" ? "active" : ""} onClick={() => setView("ltv")}>
            LTV, ₽/клиент
          </button>
          <button className={view === "ret" ? "active" : ""} onClick={() => setView("ret")}>
            Удержание, %
          </button>
        </div>
      </div>

      {err && <div className="card neg">Ошибка: {err}</div>}
      {!data && !err && <div className="card muted">Загрузка…</div>}

      {data && model && (
        <>
          {view === "ltv" && (
            <div className="card muted" style={{ marginBottom: 12, fontSize: 13 }}>
              Средний CAC (blended, за всё время):{" "}
              <b style={{ color: "var(--text)" }}>{data.cacBlended != null ? rub(data.cacBlended) : "—"}</b>.{" "}
              {model.paybackAge != null ? (
                <>Окупаемость привлечения — <b style={{ color: "var(--green)" }}>~{model.paybackAge}-й месяц</b> (по строке «Среднее»).</>
              ) : (
                <>Не окупается за {model.maxCol} мес (по blended-кривой).</>
              )}
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            <div className="report-wrap">
              <table className="report">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Когорта</th>
                    <th>Клиентов</th>
                    {view === "ltv" && <th>Итог LTV/клиент</th>}
                    {model.ages.map((a) => (
                      <th key={a}>{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {model.cohorts.map((c) => (
                    <tr key={c}>
                      <td style={{ textAlign: "left" }}>{c}</td>
                      <td>{model.sizeMap.get(c) ?? 0}</td>
                      {view === "ltv" && <td>{model.totalLtv(c) != null ? rub(model.totalLtv(c)!) : "—"}</td>}
                      {model.ages.map((a) => {
                        const v = model.cell(c, a);
                        return (
                          <td key={a} style={{ background: bg(v, model.maxCell), textAlign: "center" }}>
                            {fmt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Строка «Среднее» — blended-кривая */}
                  <tr className="total-top">
                    <td style={{ textAlign: "left" }}>Среднее</td>
                    <td>{data.sizes.reduce((s, x) => s + x.clients, 0)}</td>
                    {view === "ltv" && <td>—</td>}
                    {model.ages.map((a) => (
                      <td
                        key={a}
                        style={{
                          textAlign: "center",
                          outline: view === "ltv" && model.paybackAge === a ? "2px solid var(--green)" : undefined,
                        }}
                      >
                        {fmt(model.blended[a])}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            Столбцы — возраст когорты в месяцах (0 = месяц входа). Пустые ячейки — когорта ещё не прожила
            этот месяц. LTV считается из журнала продаж (ручной импорт «Отчёта по продажам») — верно на дату
            последнего импорта. Когорта — по дате создания клиента в Fitbase; оплаты/визиты до месяца входа игнорируются.
          </div>
        </>
      )}
    </div>
  );
}
