"use client";

import { useEffect, useMemo, useState, Fragment, type ReactNode } from "react";
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
  cohort_ltv: number;
  romi_cohort: number | null;
  avg_ltv: number | null;
  new_clients: number;
  paid_new: number;
}
interface LifetimeRow {
  source: string;
  clients: number;
  paying: number;
  ltv: number;
  avg_ltv: number | null;
}
interface SourceRow {
  source: string;
  cost: number;
  visits: number;
  leads: number;
  clients: number;
  paying: number;
  revenue: number;
  cohortLtv: number;
  cpl: number | null;
  cac: number | null;
  romi: number | null;
  romiCohort: number | null;
}
interface CampaignRow {
  source: string;
  campaign_name: string;
  cost: number;
  clicks: number;
  impressions: number;
}
interface InfluenceRow {
  source: string;
  clients: number;
  paying: number;
  revenue: number;
}
interface DateRow {
  date: string;
  cost: number;
  leads: number;
  cpl: number | null;
  clients: number;
  sales_count: number;
  revenue: number;
  visits: number;
}
interface TimePoint {
  date: string;
  visits: number;
  cost: number;
  leads: number;
  revenue: number;
  clients: number;
  paying: number;
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
  prevTotals?: { cost: number; leads: number; new_clients: number; revenue: number };
  bySource: SourceRow[];
  campaignsBySource: CampaignRow[];
  channelInfluence: InfluenceRow[];
  lifetimeByChannel: LifetimeRow[];
  byDate: DateRow[];
  timeline: TimePoint[];
  timelinePrev: TimePoint[] | null;
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
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
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

// ── Метрики графика: цвет + ось (rub/cnt/pct) ──
type Axis = "rub" | "cnt" | "pct";
const METRICS: { key: string; label: string; color: string; axis: Axis }[] = [
  { key: "visits", label: "Визиты", color: "#2b7fd4", axis: "cnt" },
  { key: "leads", label: "Заявки", color: "#c0398b", axis: "cnt" },
  { key: "conv_lead", label: "Конв. в заявки", color: "#e0a53b", axis: "pct" },
  { key: "conv_sale", label: "Конв. в продажи", color: "#8b5cf6", axis: "pct" },
  { key: "sales", label: "Продажи", color: "#0e9f6e", axis: "cnt" },
  { key: "revenue", label: "Выручка", color: "#1aa053", axis: "rub" },
  { key: "cost", label: "Расходы", color: "#e0271b", axis: "rub" },
  { key: "roi", label: "ROI", color: "#d97706", axis: "pct" },
];

function computeMetrics(d: TimePoint) {
  const visits = Number(d.visits);
  const leads = Number(d.leads);
  const clients = Number(d.clients);
  const sales = Number(d.paying);
  const revenue = Number(d.revenue);
  const cost = Number(d.cost);
  return {
    visits,
    leads,
    sales,
    revenue,
    cost,
    conv_lead: visits > 0 ? (leads / visits) * 100 : 0,
    conv_sale: clients > 0 ? (sales / clients) * 100 : 0,
    roi: cost > 0 ? ((revenue - cost) / cost) * 100 : 0,
  };
}

interface PfRow {
  key: string;
  label: string;
  unit: "шт" | "₽" | "%";
  dir: "up" | "down";
  type: "flow" | "eff";
  fact: number | null;
  target: number | null;
  forecast: number | null;
  pct: number | null;
  status: "green" | "yellow" | "red" | "none";
}
interface PlanFact {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  rows: PfRow[];
}

export default function Dashboard({ onGoTargets }: { onGoTargets?: () => void } = {}) {
  const initial = presetRange("30d");
  const [preset, setPreset] = useState<PresetKey | "custom">("30d");
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [selMetrics, setSelMetrics] = useState<Set<string>>(new Set(["visits", "leads"]));
  const [sortKey, setSortKey] = useState<string>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pf, setPf] = useState<PlanFact | null>(null);

  // План/факт — по ТЕКУЩЕМУ месяцу, независимо от верхнего фильтра периода.
  useEffect(() => {
    fetch("/api/plan-fact")
      .then((r) => r.json())
      .then(setPf)
      .catch(() => {});
  }, []);

  function applyPreset(key: PresetKey) {
    const r = presetRange(key);
    setPreset(key);
    setFrom(r.from);
    setTo(r.to);
  }

  function loadMetrics() {
    return fetch(`/api/metrics?from=${from}&to=${to}${compare ? "&compare=1" : ""}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)));
  }

  useEffect(() => {
    setData(null);
    setError(null);
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, compare]);

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

  function toggleMetric(k: string) {
    setSelMetrics((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }
  function toggleSort(k: string) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }
  function toggleExpand(k: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  const t = data?.totals;
  const p = data?.prevTotals;

  // Данные графика с производными метриками (+ пунктир прошлого периода).
  const chartData = useMemo(() => {
    if (!data) return [];
    const cur = data.timeline.map((d) => ({ date: d.date, ...computeMetrics(d) }));
    if (compare && data.timelinePrev) {
      data.timelinePrev.forEach((d, i) => {
        if (cur[i]) {
          const m = computeMetrics(d);
          for (const key of Object.keys(m)) {
            (cur[i] as Record<string, number | string>)[`prev_${key}`] = (m as Record<string, number>)[key];
          }
        }
      });
    }
    return cur;
  }, [data, compare]);

  const kindByName = useMemo(() => {
    const map: Record<string, Axis> = {};
    for (const m of METRICS) {
      map[m.label] = m.axis;
      map[`${m.label} (пред.)`] = m.axis;
    }
    return map;
  }, []);

  // Строки отчёта по каналам.
  const repRows = useMemo(() => {
    if (!data) return [];
    return data.bySource.map((s) => {
      const visits = Number(s.visits);
      const leads = Number(s.leads);
      const clients = Number(s.clients);
      const sales = Number(s.paying);
      const revenue = Number(s.revenue);
      const cost = Number(s.cost);
      return {
        source: s.source,
        visits,
        leads,
        clients,
        sales,
        revenue,
        cost,
        convLead: visits > 0 ? leads / visits : null,
        convSale: clients > 0 ? sales / clients : null,
        avgCheck: sales > 0 ? revenue / sales : null,
        profit: revenue - cost,
        roi: s.romiCohort,
      };
    });
  }, [data]);

  const sortedRows = useMemo(() => {
    const rows = [...repRows];
    rows.sort((a, b) => {
      if (sortKey === "source") {
        const av = SOURCE_LABEL[a.source] ?? a.source;
        const bv = SOURCE_LABEL[b.source] ?? b.source;
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = Number((a as Record<string, unknown>)[sortKey] ?? 0);
      const bv = Number((b as Record<string, unknown>)[sortKey] ?? 0);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [repRows, sortKey, sortDir]);

  const campaignsBy = useMemo(() => {
    const m = new Map<string, CampaignRow[]>();
    if (data) for (const c of data.campaignsBySource) {
      const arr = m.get(c.source) ?? [];
      arr.push(c);
      m.set(c.source, arr);
    }
    return m;
  }, [data]);

  const maxConvLead = Math.max(0, ...repRows.map((r) => r.convLead ?? 0));
  const maxConvSale = Math.max(0, ...repRows.map((r) => r.convSale ?? 0));

  const REP_COLS: { key: string; label: string; left?: boolean }[] = [
    { key: "source", label: "Канал", left: true },
    { key: "visits", label: "Визиты" },
    { key: "convLead", label: "Конв. в заявки" },
    { key: "leads", label: "Заявки" },
    { key: "convSale", label: "Конв. в продажи" },
    { key: "sales", label: "Продажи" },
    { key: "revenue", label: "Выручка" },
    { key: "avgCheck", label: "Средний чек" },
    { key: "profit", label: "Прибыль" },
    { key: "cost", label: "Расходы" },
    { key: "roi", label: "ROI" },
  ];

  const tot = data ? sumMetrics(data.bySource) : null;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Обзор</h1>
          <div className="sub">Реклама → визиты → лиды → клиенты. Данные обновляются раз в сутки.</div>
        </div>
        <div className="controls">
          {PRESETS.map((pr) => (
            <button key={pr.key} className={pr.key === preset ? "active" : ""} onClick={() => applyPreset(pr.key)}>
              {pr.label}
            </button>
          ))}
          <button onClick={handleSync} disabled={syncing} className="sync-btn">
            {syncing ? "Обновление…" : "Обновить данные"}
          </button>
        </div>
      </div>

      <div className="daterange">
        <span className="muted">Период:</span>
        <input type="date" value={from} max={to} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} />
        <span className="muted">—</span>
        <input type="date" value={to} min={from} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} />
        {preset === "custom" && <span className="badge">свой период</span>}
      </div>

      {syncMsg && <div className="card muted" style={{ marginBottom: 16 }}>{syncMsg}</div>}
      {error && <div className="card neg">Ошибка загрузки: {error}</div>}
      {!data && !error && <div className="card muted">Загрузка…</div>}

      {data && t && (
        <>
          {/* ── Компактная стат-полоса ── */}
          <div className="statbar">
            <Stat label="Визиты" value={num(t.visits)} />
            <Stat label="Заявки" value={num(t.leads)} delta={<Delta cur={t.leads} prev={p?.leads ?? 0} />} />
            <Stat label="Продажи" value={num(t.paid_new)} />
            <Stat label="Выручка" value={rub(t.revenue)} delta={<Delta cur={t.revenue} prev={p?.revenue ?? 0} />} />
            <Stat label="Расходы" value={rub(t.cost)} delta={<Delta cur={t.cost} prev={p?.cost ?? 0} mode="neutral" />} />
            <Stat
              label="ROI"
              value={pct(t.romi_cohort ?? null)}
              cls={t.romi_cohort != null ? (t.romi_cohort >= 0 ? "pos" : "neg") : ""}
            />
            <Stat label="LTV/CAC" value={ltvCacStr(t)} cls={ltvCacCls(t)} />
          </div>

          {/* ── План / факт (текущий месяц) ── */}
          {pf &&
            (() => {
              const [yy, mm] = pf.month.split("-").map(Number);
              const monthLabel = new Date(yy, mm - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
              const hasAny = pf.rows.some((r) => r.target != null);
              const fmt = (unit: string, v: number | null) =>
                v == null ? "—" : unit === "₽" ? rub(v) : unit === "%" ? `${Math.round(v)}%` : num(v);
              const dot = (s: string) =>
                s === "green" ? "var(--green)" : s === "yellow" ? "var(--gold)" : s === "red" ? "var(--red)" : "var(--muted)";
              return (
                <>
                  <div className="section-title" style={{ marginTop: 6 }}>
                    План / факт · {monthLabel} · текущий месяц (не зависит от фильтра периода)
                  </div>
                  {!hasAny ? (
                    <div className="card muted">
                      Цели на месяц не заданы.{" "}
                      <span
                        onClick={onGoTargets}
                        style={{ color: "var(--link)", cursor: "pointer", borderBottom: "1px dotted var(--link)" }}
                      >
                        Задайте цели во вкладке «Цели»
                      </span>
                      .
                    </div>
                  ) : (
                    <div className="card" style={{ padding: 0 }}>
                      <div className="report-wrap">
                        <table className="report">
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", width: 22 }}></th>
                              <th style={{ textAlign: "left" }}>Метрика</th>
                              <th>Факт (с начала месяца)</th>
                              <th>План</th>
                              <th>Прогноз</th>
                              <th>% выполнения</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pf.rows.map((r) => (
                              <tr key={r.key}>
                                <td>
                                  <span
                                    style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: dot(r.status) }}
                                  />
                                </td>
                                <td style={{ textAlign: "left" }}>{r.label}</td>
                                <td>{fmt(r.unit, r.fact)}</td>
                                <td>{r.target != null ? fmt(r.unit, r.target) : "—"}</td>
                                <td>{r.type === "flow" && r.forecast != null ? fmt(r.unit, r.forecast) : "—"}</td>
                                <td className={r.status === "green" ? "pos" : r.status === "red" ? "neg" : ""}>
                                  {r.pct != null ? pct(r.pct) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

          {/* ── График + метрик-пикер ── */}
          <div className="section-title" style={{ marginTop: 6 }}>Динамика</div>
          <div className="card">
            <div className="chart-row">
              <div className="chart-main">
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                      <YAxis yAxisId="rub" stroke="var(--muted)" fontSize={11} width={54} />
                      <YAxis yAxisId="cnt" orientation="right" stroke="var(--muted)" fontSize={11} width={40} />
                      <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} hide />
                      <Tooltip
                        contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                        formatter={(v: number, name: string) => {
                          const k = kindByName[name];
                          return k === "rub" ? rub(v) : k === "pct" ? `${Number(v).toFixed(0)}%` : num(v);
                        }}
                      />
                      <Legend />
                      {METRICS.filter((m) => selMetrics.has(m.key)).map((m) => (
                        <Line
                          key={m.key}
                          yAxisId={m.axis}
                          type="monotone"
                          dataKey={m.key}
                          name={m.label}
                          stroke={m.color}
                          dot={false}
                          strokeWidth={2}
                        />
                      ))}
                      {compare &&
                        METRICS.filter((m) => selMetrics.has(m.key)).map((m) => (
                          <Line
                            key={`prev_${m.key}`}
                            yAxisId={m.axis}
                            type="monotone"
                            dataKey={`prev_${m.key}`}
                            name={`${m.label} (пред.)`}
                            stroke={m.color}
                            strokeDasharray="4 3"
                            dot={false}
                            strokeWidth={1.5}
                          />
                        ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="metric-picker">
                {METRICS.map((m) => (
                  <div key={m.key} className={`metric-chip ${selMetrics.has(m.key) ? "on" : ""}`} onClick={() => toggleMetric(m.key)}>
                    <span className="dot" style={{ background: m.color, opacity: selMetrics.has(m.key) ? 1 : 0.3 }} />
                    {m.label}
                  </div>
                ))}
                <label className="compare-toggle">
                  <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                  Сравнить с периодом
                </label>
              </div>
            </div>
          </div>

          {/* ── Отчёт по каналам ── */}
          <div className="section-title">
            Отчёт по каналам · {PRESETS.find((pr) => pr.key === preset)?.label ?? `${from} — ${to}`}
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="report-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
              <table className="report">
                <thead>
                  <tr>
                    {REP_COLS.map((c) => (
                      <th
                        key={c.key}
                        style={{ textAlign: c.left ? "left" : "right" }}
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.label}
                        {sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tot && (
                    <tr className="total-top">
                      <td>Итого / Среднее</td>
                      <td>{num(tot.visits)}</td>
                      <td>{tot.visits > 0 ? pct(tot.leads / tot.visits) : "—"}</td>
                      <td>{num(tot.leads)}</td>
                      <td>{tot.clients > 0 ? pct(tot.paying / tot.clients) : "—"}</td>
                      <td>{num(tot.paying)}</td>
                      <td>{rub(tot.revenue)}</td>
                      <td>{tot.paying > 0 ? rub(tot.revenue / tot.paying) : "—"}</td>
                      <td>{rub(tot.revenue - tot.cost)}</td>
                      <td>{rub(tot.cost)}</td>
                      <td className={data.totals.romi_cohort != null ? (data.totals.romi_cohort >= 0 ? "pos" : "neg") : "muted"}>
                        {pct(data.totals.romi_cohort ?? null)}
                      </td>
                    </tr>
                  )}
                  {sortedRows.map((r) => {
                    const camps = campaignsBy.get(r.source);
                    const canExpand = !!camps?.length;
                    const open = expanded.has(r.source);
                    return (
                      <Fragment key={r.source}>
                        <tr>
                          <td>
                            {canExpand && (
                              <span className="expand-btn" onClick={() => toggleExpand(r.source)}>
                                {open ? "−" : "+"}
                              </span>
                            )}
                            {SOURCE_LABEL[r.source] ?? r.source}
                          </td>
                          <td><span className="num-link">{num(r.visits)}</span></td>
                          <td><MiniBar val={r.convLead} max={maxConvLead} /></td>
                          <td><span className="num-link">{num(r.leads)}</span></td>
                          <td><MiniBar val={r.convSale} max={maxConvSale} /></td>
                          <td><span className="num-link">{num(r.sales)}</span></td>
                          <td><span className="num-link">{rub(r.revenue)}</span></td>
                          <td>{r.avgCheck != null ? rub(r.avgCheck) : "—"}</td>
                          <td className={r.profit < 0 ? "neg" : ""}>{rub(r.profit)}</td>
                          <td><span className="num-link">{rub(r.cost)}</span></td>
                          <td className={r.roi != null ? (Number(r.roi) >= 0 ? "pos" : "neg") : "muted"}>{pct(r.roi)}</td>
                        </tr>
                        {open && canExpand && (
                          <tr className="campaign-row">
                            <td colSpan={REP_COLS.length}>
                              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                                Кампании канала. Атрибуция на уровне кампании не настроена — только расход/клики/показы.
                              </div>
                              <table style={{ width: "100%" }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: "left" }}>Кампания</th>
                                    <th>Расход</th>
                                    <th>Клики</th>
                                    <th>Показы</th>
                                    <th>CPC</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {camps!.map((c, i) => (
                                    <tr key={i}>
                                      <td style={{ textAlign: "left" }}>{c.campaign_name}</td>
                                      <td>{rub(c.cost)}</td>
                                      <td>{num(c.clicks)}</td>
                                      <td>{num(c.impressions)}</td>
                                      <td>{Number(c.clicks) > 0 ? rub(Number(c.cost) / Number(c.clicks)) : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={REP_COLS.length} className="muted" style={{ padding: 14 }}>
                        Нет данных за период. Запустите синхронизацию.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            «Прибыль» = выручка − рекламные расходы (маржа, без себестоимости абонемента). Раскрытие «+» —
            только у платных каналов (расход/клики/показы/CPC); per-campaign воронка не считается.
          </div>

          <div className="section-title">Воронка периода</div>
          <div className="card">
            {(() => {
              const conv = (a: number, b: number) => (Number(b) > 0 ? pct(Number(a) / Number(b)) : "—");
              const Step = ({ fromL, fromV, toL, toV }: { fromL: string; fromV: number; toL: string; toV: number }) => (
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span className="muted">{fromL}</span>
                  <b>{num(fromV)}</b>
                  <span className="muted">→</span>
                  <span className="muted">{toL}</span>
                  <b>{num(toV)}</b>
                  <span className="badge">{conv(toV, fromV)}</span>
                </div>
              );
              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <Step fromL="Визиты" fromV={t.visits} toL="Лиды" toV={t.leads} />
                  <Step fromL="Лиды" fromV={t.leads} toL="Клиенты" toV={t.new_clients} />
                  <Step fromL="Клиенты" fromV={t.new_clients} toL="Оплатили" toV={t.paid_new} />
                </div>
              );
            })()}
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Визиты — из Метрики (сайт), Лиды — заявки Fitbase (воронка «Новые лиды»),
              Клиенты — из Fitbase. Конверсия Визит→Лид межсистемная и ориентировочная
              (у части лидов нет визита на сайт — звонки/чат-бот); Клиент→Оплата — доля
              новых клиентов периода, сделавших оплату.
            </div>
          </div>

          <div className="section-title">Юнит-экономика периода</div>
          <div className="kpis">
            {(() => {
              const cac = Number(t.new_clients) > 0 ? Number(t.cost) / Number(t.new_clients) : null;
              const ratio = t.avg_ltv != null && cac && cac > 0 ? Number(t.avg_ltv) / cac : null;
              const drr = Number(t.revenue) > 0 ? Number(t.cost) / Number(t.revenue) : null;
              const ratioCls = ratio == null ? "" : ratio >= 3 ? "pos" : ratio < 1 ? "neg" : "";
              const ratioStr = ratio == null ? "—" : ratio.toFixed(1).replace(".", ",") + "×";
              return (
                <>
                  <Kpi label="CAC" value={cac != null ? rub(cac) : "—"} title="Средняя стоимость клиента = рекламный расход ÷ все новые клиенты периода (blended)." />
                  <Kpi label="LTV/CAC" value={ratioStr} className={ratioCls} title="Средний LTV клиента ÷ CAC. Ориентир здоровья юнит-экономики — от 3×." />
                  <Kpi label="ДРР" value={drr != null ? pct(drr) : "—"} title="Доля рекламных расходов = расход ÷ выручка (касса) за период." />
                </>
              );
            })()}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 4 }}>
            CAC — «blended» (весь рекламный расход на всех новых клиентов, включая органических).
            LTV/CAC берёт средний LTV за всё время против CAC периода.
          </div>

          <div className="section-title">Ценность клиентов по каналам · за всё время</div>
          <div className="card">
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Сколько денег принесли за <b>всю жизнь</b> клиенты, которых привёл канал (по первому касанию).
              Не зависит от выбранного периода — показывает, какой канал приводит самых <b>денежных</b> клиентов.
            </div>
            <div className="report-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Канал</th>
                    <th title="Сколько клиентов канал привёл за всю историю.">Привёл клиентов</th>
                    <th title="Из них хотя бы раз заплатили.">Оплатили</th>
                    <th title="Суммарные оплаты этих клиентов за всё время.">LTV за всё время</th>
                    <th title="LTV за всё время ÷ число оплативших. Средняя ценность клиента канала.">Средний LTV</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lifetimeByChannel.map((r) => (
                    <tr key={r.source}>
                      <td>{SOURCE_LABEL[r.source] ?? r.source}</td>
                      <td>{num(r.clients)}</td>
                      <td>{num(r.paying)}</td>
                      <td>{rub(r.ltv)}</td>
                      <td>{r.avg_ltv != null ? rub(r.avg_ltv) : "—"}</td>
                    </tr>
                  ))}
                  {data.lifetimeByChannel.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">Нет данных.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section-title">Влияние каналов · касания за период</div>
          <div className="card">
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Клиенты, которые <b>касались</b> канала в периоде (не обязательно первым касанием), и их LTV.
              Один клиент может попасть в несколько каналов — поэтому выручка здесь <b>пересекается</b> и не суммируется в общий итог.
            </div>
            <div className="report-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Канал</th>
                    <th>Коснулось клиентов</th>
                    <th>Оплатили</th>
                    <th>Их LTV (influence)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channelInfluence.map((r) => (
                    <tr key={r.source}>
                      <td>{SOURCE_LABEL[r.source] ?? r.source}</td>
                      <td>{num(r.clients)}</td>
                      <td>{num(r.paying)}</td>
                      <td>{rub(r.revenue)}</td>
                    </tr>
                  ))}
                  {data.channelInfluence.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">Нет данных за период.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section-title">
            По дням · {PRESETS.find((pr) => pr.key === preset)?.label ?? `${from} — ${to}`}
          </div>
          <div className="card">
            <div className="muted" style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
              <b style={{ color: "var(--accent)" }}>Слева — маркетинг/лиды</b> (реклама и Метрика):
              расход, заявки, цена лида, новые клиенты.
              <b style={{ color: "#a9781f", marginLeft: 8 }}>Справа — Fitbase</b> (факт клуба):
              продажи и выручка по дате платежа и посещения.
            </div>
            <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
              <table className="split-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Дата</th>
                    <th colSpan={4} className="grp grp-mkt">Маркетинг / Лиды</th>
                    <th colSpan={3} className="grp grp-fb">Fitbase</th>
                  </tr>
                  <tr>
                    <th className="col-mkt">Расход</th>
                    <th className="col-mkt">Лиды</th>
                    <th className="col-mkt">CPL</th>
                    <th className="col-mkt">Клиенты</th>
                    <th className="col-fb">Продажи</th>
                    <th className="col-fb">Выручка</th>
                    <th className="col-fb">Посещения</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDate.map((d) => (
                    <tr key={d.date}>
                      <td>{new Date(d.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", weekday: "short" })}</td>
                      <td className="col-mkt">{rub(d.cost)}</td>
                      <td className="col-mkt">{num(d.leads)}</td>
                      <td className="col-mkt">{d.cpl != null ? rub(d.cpl) : "—"}</td>
                      <td className="col-mkt">{num(d.clients)}</td>
                      <td className="col-fb">{num(d.sales_count)}</td>
                      <td className="col-fb">{rub(d.revenue)}</td>
                      <td className="col-fb">{num(d.visits)}</td>
                    </tr>
                  ))}
                  {data.byDate.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">Нет данных. Запустите синхронизацию.</td>
                    </tr>
                  )}
                </tbody>
                {data.byDate.length > 0 && (() => {
                  const tf = sumMetrics(data.byDate);
                  return (
                    <tfoot>
                      <tr className="total-row">
                        <td>Всего</td>
                        <td className="col-mkt">{rub(tf.cost)}</td>
                        <td className="col-mkt">{num(tf.leads)}</td>
                        <td className="col-mkt">{tf.cpl != null ? rub(tf.cpl) : "—"}</td>
                        <td className="col-mkt">{num(tf.clients)}</td>
                        <td className="col-fb">{num(tf.sales_count)}</td>
                        <td className="col-fb">{rub(tf.revenue)}</td>
                        <td className="col-fb">{num(tf.visits)}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
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
                    <td className="muted">{s.finished_at ? new Date(s.finished_at).toLocaleString("ru-RU") : "—"}</td>
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
function sumMetrics(rows: readonly unknown[]) {
  const n = (v: unknown) => Number(v) || 0;
  const sum = (k: string) => rows.reduce((a: number, r) => a + n((r as Record<string, unknown>)[k]), 0);
  const cost = sum("cost");
  const leads = sum("leads");
  const clients = sum("clients");
  const paying = sum("paying");
  const sales_count = sum("sales_count");
  const revenue = sum("revenue");
  const cohortLtv = sum("cohortLtv");
  const visits = sum("visits");
  return {
    cost,
    leads,
    clients,
    paying,
    sales_count,
    revenue,
    cohortLtv,
    visits,
    cpl: leads > 0 ? cost / leads : null,
    cac: cost > 0 && clients > 0 ? cost / clients : null,
    romi: cost > 0 ? (revenue - cost) / cost : null,
  };
}

function ltvCacRatio(t: Totals): number | null {
  const cac = Number(t.new_clients) > 0 ? Number(t.cost) / Number(t.new_clients) : null;
  return t.avg_ltv != null && cac && cac > 0 ? Number(t.avg_ltv) / cac : null;
}
function ltvCacStr(t: Totals): string {
  const r = ltvCacRatio(t);
  return r == null ? "—" : r.toFixed(1).replace(".", ",") + "×";
}
function ltvCacCls(t: Totals): string {
  const r = ltvCacRatio(t);
  return r == null ? "" : r >= 3 ? "pos" : r < 1 ? "neg" : "";
}

function Stat({ label, value, delta, cls }: { label: string; value: string; delta?: ReactNode; cls?: string }) {
  return (
    <div className="stat">
      <div className="s-label">{label}</div>
      <div className={`s-value ${cls ?? ""}`}>
        {value}
        {delta}
      </div>
    </div>
  );
}

function MiniBar({ val, max }: { val: number | null; max: number }) {
  if (val == null) return <span className="muted">—</span>;
  const w = max > 0 ? Math.min(100, (val / max) * 100) : 0;
  return (
    <span className="minibar">
      <span className="fill" style={{ width: `${w}%` }} />
      <span className="pctval">{pct(val)}</span>
    </span>
  );
}

function Kpi({
  label,
  value,
  className,
  delta,
  title,
}: {
  label: string;
  value: string;
  className?: string;
  delta?: ReactNode;
  title?: string;
}) {
  return (
    <div className="card kpi" title={title}>
      <div className="label">{label}</div>
      <div className={`value ${className ?? ""}`}>
        {value}
        {delta}
      </div>
    </div>
  );
}

/** Δ% к прошлому периоду. Для расхода рост не «плохой» — режим neutral. */
function Delta({ cur, prev, mode = "up-good" }: { cur: number; prev: number; mode?: "up-good" | "neutral" }) {
  if (!prev) return null;
  const d = (cur - prev) / prev;
  const up = d >= 0;
  const cls = mode === "neutral" ? "muted" : up ? "pos" : "neg";
  return (
    <span className={cls} style={{ fontSize: 11, marginLeft: 6, fontWeight: 600 }}>
      {up ? "▲" : "▼"} {Math.abs(d * 100).toFixed(0)}%
    </span>
  );
}
