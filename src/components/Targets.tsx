"use client";

import { useEffect, useState } from "react";
import { KPI_METRICS, currentMonthMsk } from "@/lib/kpi";

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m-1 текущий (0-based) минус 1
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Targets() {
  const [month, setMonth] = useState<string>(currentMonthMsk());
  const [vals, setVals] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function fetchTargets(m: string): Promise<Record<string, number>> {
    const res = await fetch(`/api/targets?month=${m}`);
    const json = await res.json();
    return (json.targets ?? {}) as Record<string, number>;
  }

  function applyTargets(targets: Record<string, number>, asBaseline: boolean) {
    const next: Record<string, string> = {};
    for (const mt of KPI_METRICS) next[mt.key] = targets[mt.key] != null ? String(targets[mt.key]) : "";
    setVals(next);
    if (asBaseline) setBaseline(next);
  }

  useEffect(() => {
    fetchTargets(month).then((t) => applyTargets(t, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function copyFromPrev() {
    const t = await fetchTargets(prevMonth(month));
    applyTargets(t, false); // не baseline → отметятся как изменённые и сохранятся
    setToast("Скопировано из прошлого месяца — не забудьте сохранить");
  }

  async function save() {
    setBusy(true);
    try {
      const changed = KPI_METRICS.filter((mt) => (vals[mt.key] ?? "") !== (baseline[mt.key] ?? ""));
      for (const mt of changed) {
        await fetch("/api/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, metric: mt.key, target: vals[mt.key] ?? "" }),
        });
      }
      setBaseline({ ...vals });
      setToast(changed.length ? "Сохранено" : "Изменений нет");
    } catch (e) {
      setToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  const dirty = KPI_METRICS.some((mt) => (vals[mt.key] ?? "") !== (baseline[mt.key] ?? ""));

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Цели</h1>
          <div className="sub">Плановые KPI по месяцам. Факт и светофор — на вкладке «Дашборд».</div>
        </div>
        <div className="controls">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, colorScheme: "light" }}
          />
          <button onClick={copyFromPrev}>Копировать из прошлого месяца</button>
          <button className="sync-btn" onClick={save} disabled={busy || !dirty}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      {toast && <div className="card muted" style={{ marginBottom: 16 }}>{toast}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Метрика</th>
              <th>Ед.</th>
              <th>План</th>
              <th style={{ textAlign: "left" }}>Направление</th>
            </tr>
          </thead>
          <tbody>
            {KPI_METRICS.map((mt) => (
              <tr key={mt.key}>
                <td>{mt.label}</td>
                <td className="muted">{mt.unit}</td>
                <td>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={vals[mt.key] ?? ""}
                    placeholder="—"
                    onChange={(e) => setVals((v) => ({ ...v, [mt.key]: e.target.value }))}
                    style={{
                      width: 120,
                      textAlign: "right",
                      padding: "6px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--panel)",
                      color: "var(--text)",
                    }}
                  />
                </td>
                <td style={{ textAlign: "left" }} className="muted">
                  {mt.dir === "up" ? "↑ больше — лучше" : "↓ меньше — лучше"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Проценты вводите как проценты (например 25 = 25%). Пустое поле снимает цель по метрике.
      </div>
    </div>
  );
}
