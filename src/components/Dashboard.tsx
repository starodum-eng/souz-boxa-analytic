"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { rub, num, pct, SOURCE_LABEL } from "@/lib/format";

interface SyncResult {
  source: string;
  status: string;
  rows: number;
  message?: string;
}

interface Totals {
  cost: number;
  clicks: number;
  visits: number;
  leads: number;
  sales_count: number;
  revenue: number;
  new_clients: number;
}
interface SourceRow {
  source: string;
  cost: number;
  leads: number;
  clients: number;
  sales_count: number;
  revenue: number;
  cpl: number | null;
  cac: number | null;
  romi: number | null;
}
interface RevenueSourceRow {
  source: string;
  clients: number;
  paying: number;
  revenue: number;
  avg_check: number | null;
}
interface DateRow {
  date: string;
  cost: number;
  leads: number;
  clients: number;
  sales_count: number;
  revenue: number;
  cpl: number | null;
  cac: number | null;
  romi: number | null;
}
interface TimePoint {
  date: string;
  cost: number;
  leads: number;
  revenue: number;
}
interface SyncRow {
  source: string;
  status: string;
  rows_upserted: number;
  message: string | null;
  finished_at: string | null;
}

interface Data {
  totals: Totals;
  bySource: SourceRow[];
  revenueBySource: RevenueSourceRow[];
  byDate: DateRow[];
  timeline: TimePoint[];
  lastSync: SyncRow[];
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Начало недели — понедельник.
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0 = понедельник
  return addDays(x, -dow);
}

type PresetKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "7d" | "30d" | "90d";
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "thisWeek", label: "Эта нед." },
  { key: "lastWeek", label: "Прошл. нед." },
  { key: "7d", label: "7 дн." },
  { key: "30d", label: "30 дн." },
  { key: "90d", label: "90 дн." },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case "today":
      return { from: ymd(today), to: ymd(today) };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: ymd(y), to: ymd(y) };
    }
    case "thisWeek":
      return { from: ymd(startOfWeek(today)), to: ymd(today) };
    case "lastWeek": {
      const sow = startOfWeek(today);
      return { from: ymd(addDays(sow, -7)), to: ymd(addDays(sow, -1)) };
    }
    case "7d":
      return { from: ymd(addDays(today, -6)), to: ymd(today) };
    case "30d":
      return { from: ymd(addDays(today, -29)), to: ymd(today) };
    case "90d":
      return { from: ymd(addDays(today, -89)), to: ymd(today) };
  }
}

export default function Dashboard() {
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  function loadMetrics() {
    const { from, to } = presetRange(preset);
    return fetch(`/api/metrics?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)));
  }

  useEffect(() => {
    setData(null);
    setError(null);
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync-now", { method: "POST" });
      const body = (await res.json()) as { results: SyncResult[] };
      const results = body.results ?? [];
      const ok = results.filter((r) => r.status === "ok");
      const fail = results.filter((r) => r.status !== "ok");
      setSyncMsg(
        `Готово. Загружено: ${ok.map((r) => `${SOURCE_LABEL[r.source] ?? r.source} (${r.rows})`).join(", ") || "—"}` +
          (fail.length ? ` · Ошибки: ${fail.map((r) => SOURCE_LABEL[r.source] ?? r.source).join(", ")}` : ""),
      );
      await loadMetrics();
    } catch (e) {
      setSyncMsg(`Ошибка синхронизации: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  }

  const t = data?.totals;
  const romi = t && Number(t.cost) > 0 ? (Number(t.revenue) - Number(t.cost)) / Number(t.cost) : null;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Обзор</h1>
          <div className="sub">Реклама → визиты → лиды → клиенты. Данные обновляются раз в сутки.</div>
        </div>
        <div className="controls">
          {PRESETS.map((p) => (
            <button key={p.key} className={p.key === preset ? "active" : ""} onClick={() => setPreset(p.key)}>
              {p.label}
            </button>
          ))}
          <button onClick={handleSync} disabled={syncing} className="sync-btn">
            {syncing ? "Обновление…" : "Обновить данные"}
          </button>
        </div>
      </div>

      {syncMsg && <div className="card muted" style={{ marginBottom: 16 }}>{syncMsg}</div>}
      {error && <div className="card neg">Ошибка загрузки: {error}</div>}
      {!data && !error && <div className="card muted">Загрузка…</div>}

      {data && t && (
        <>
          <div className="kpis">
            <Kpi label="Расход" value={rub(t.cost)} />
            <Kpi label="Клики" value={num(t.clicks)} />
            <Kpi label="Лиды" value={num(t.leads)} />
            <Kpi label="Клиенты" value={num(t.new_clients)} />
            <Kpi label="Выручка" value={rub(t.revenue)} />
            <Kpi label="ROMI" value={pct(romi)} className={romi != null && romi >= 0 ? "pos" : "neg"} />
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>Динамика</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.timeline}>
                  <CartesianGrid stroke="#38302a" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#a8998c" fontSize={12} />
                  <YAxis stroke="#a8998c" fontSize={12} />
                  <Tooltip
                    contentStyle={{ background: "#201a16", border: "1px solid #38302a", borderRadius: 8 }}
                    formatter={(v: number, name) =>
                      name === "Лиды" ? num(v) : rub(v)
                    }
                  />
                  <Legend />
                  <Line type="monotone" dataKey="cost" name="Расход" stroke="#e0271b" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="revenue" name="Выручка" stroke="#46c07a" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="leads" name="Лиды" stroke="#e0a53b" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="section-title">По источникам · {PRESETS.find((p) => p.key === preset)?.label}</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>Расход</th>
                  <th>Лиды</th>
                  <th>CPL</th>
                  <th>Клиенты</th>
                  <th>Продажи</th>
                  <th>CAC</th>
                  <th>Выручка</th>
                  <th>ROMI</th>
                </tr>
              </thead>
              <tbody>
                {data.bySource.map((s) => (
                  <tr key={s.source}>
                    <td>{SOURCE_LABEL[s.source] ?? s.source}</td>
                    <td>{rub(s.cost)}</td>
                    <td>{num(s.leads)}</td>
                    <td>{s.cpl != null ? rub(s.cpl) : "—"}</td>
                    <td>{num(s.clients)}</td>
                    <td>{num(s.sales_count)}</td>
                    <td>{s.cac != null ? rub(s.cac) : "—"}</td>
                    <td>{rub(s.revenue)}</td>
                    <td className={s.romi != null ? (Number(s.romi) >= 0 ? "pos" : "neg") : "muted"}>
                      {pct(s.romi)}
                    </td>
                  </tr>
                ))}
                {data.bySource.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">Нет данных за период. Запустите синхронизацию.</td>
                  </tr>
                )}
              </tbody>
              {data.bySource.length > 0 && (() => {
                const t = sumMetrics(data.bySource);
                return (
                  <tfoot>
                    <tr className="total-row">
                      <td>Всего</td>
                      <td>{rub(t.cost)}</td>
                      <td>{num(t.leads)}</td>
                      <td>{t.cpl != null ? rub(t.cpl) : "—"}</td>
                      <td>{num(t.clients)}</td>
                      <td>{num(t.sales_count)}</td>
                      <td>{t.cac != null ? rub(t.cac) : "—"}</td>
                      <td>{rub(t.revenue)}</td>
                      <td className={t.romi != null ? (t.romi >= 0 ? "pos" : "neg") : "muted"}>{pct(t.romi)}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>

          <div className="section-title">Выручка по источникам (Fitbase) · {PRESETS.find((p) => p.key === preset)?.label}</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>Клиенты</th>
                  <th>Оплатили</th>
                  <th>Выручка (LTV)</th>
                  <th>Средний чек</th>
                </tr>
              </thead>
              <tbody>
                {data.revenueBySource.map((r) => (
                  <tr key={r.source}>
                    <td>{r.source}</td>
                    <td>{num(r.clients)}</td>
                    <td>{num(r.paying)}</td>
                    <td>{rub(r.revenue)}</td>
                    <td>{r.avg_check != null ? rub(r.avg_check) : "—"}</td>
                  </tr>
                ))}
                {data.revenueBySource.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">Нет данных за период.</td>
                  </tr>
                )}
              </tbody>
              {data.revenueBySource.length > 0 && (() => {
                const clients = data.revenueBySource.reduce((a, r) => a + Number(r.clients || 0), 0);
                const paying = data.revenueBySource.reduce((a, r) => a + Number(r.paying || 0), 0);
                const revenue = data.revenueBySource.reduce((a, r) => a + Number(r.revenue || 0), 0);
                return (
                  <tfoot>
                    <tr className="total-row">
                      <td>Всего</td>
                      <td>{num(clients)}</td>
                      <td>{num(paying)}</td>
                      <td>{rub(revenue)}</td>
                      <td>{paying > 0 ? rub(Math.round(revenue / paying)) : "—"}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>

          <div className="section-title">По дням (5 дней)</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Расход</th>
                  <th>Лиды</th>
                  <th>CPL</th>
                  <th>Клиенты</th>
                  <th>Продажи</th>
                  <th>CAC</th>
                  <th>Выручка</th>
                  <th>ROMI</th>
                </tr>
              </thead>
              <tbody>
                {data.byDate.map((d) => (
                  <tr key={d.date}>
                    <td>{new Date(d.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", weekday: "short" })}</td>
                    <td>{rub(d.cost)}</td>
                    <td>{num(d.leads)}</td>
                    <td>{d.cpl != null ? rub(d.cpl) : "—"}</td>
                    <td>{num(d.clients)}</td>
                    <td>{num(d.sales_count)}</td>
                    <td>{d.cac != null ? rub(d.cac) : "—"}</td>
                    <td>{rub(d.revenue)}</td>
                    <td className={d.romi != null ? (Number(d.romi) >= 0 ? "pos" : "neg") : "muted"}>
                      {pct(d.romi)}
                    </td>
                  </tr>
                ))}
                {data.byDate.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">Нет данных. Запустите синхронизацию.</td>
                  </tr>
                )}
              </tbody>
              {data.byDate.length > 0 && (() => {
                const t = sumMetrics(data.byDate);
                return (
                  <tfoot>
                    <tr className="total-row">
                      <td>Всего</td>
                      <td>{rub(t.cost)}</td>
                      <td>{num(t.leads)}</td>
                      <td>{t.cpl != null ? rub(t.cpl) : "—"}</td>
                      <td>{num(t.clients)}</td>
                      <td>{num(t.sales_count)}</td>
                      <td>{t.cac != null ? rub(t.cac) : "—"}</td>
                      <td>{rub(t.revenue)}</td>
                      <td className={t.romi != null ? (t.romi >= 0 ? "pos" : "neg") : "muted"}>{pct(t.romi)}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>

          <div className="section-title">Статус синхронизации</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>Статус</th>
                  <th>Строк</th>
                  <th>Когда</th>
                  <th>Сообщение</th>
                </tr>
              </thead>
              <tbody>
                {data.lastSync.map((s, i) => (
                  <tr key={i}>
                    <td>{SOURCE_LABEL[s.source] ?? s.source}</td>
                    <td>
                      <span className={`badge ${s.status === "ok" ? "ok" : "error"}`}>
                        {s.status === "ok" ? "ok" : "ошибка"}
                      </span>
                    </td>
                    <td>{num(s.rows_upserted)}</td>
                    <td className="muted">
                      {s.finished_at ? new Date(s.finished_at).toLocaleString("ru-RU") : "—"}
                    </td>
                    <td className="msg" title={s.message ?? ""}>{s.message ?? ""}</td>
                  </tr>
                ))}
                {data.lastSync.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">Синхронизаций ещё не было.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Сумма показателей строк; производные (CPL/CAC/ROMI) считаются от итогов. */
function sumMetrics(rows: Array<{ cost: number; leads: number; clients: number; sales_count: number; revenue: number }>) {
  const n = (v: unknown) => Number(v) || 0;
  const cost = rows.reduce((a, r) => a + n(r.cost), 0);
  const leads = rows.reduce((a, r) => a + n(r.leads), 0);
  const clients = rows.reduce((a, r) => a + n(r.clients), 0);
  const sales_count = rows.reduce((a, r) => a + n(r.sales_count), 0);
  const revenue = rows.reduce((a, r) => a + n(r.revenue), 0);
  return {
    cost,
    leads,
    clients,
    sales_count,
    revenue,
    cpl: leads > 0 ? cost / leads : null,
    cac: sales_count > 0 ? cost / sales_count : null,
    romi: cost > 0 ? (revenue - cost) / cost : null,
  };
}

function Kpi({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value ${className ?? ""}`}>{value}</div>
    </div>
  );
}
