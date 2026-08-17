"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  revenue: number; // касса за период
  cohort_ltv: number; // LTV привлечённой когорты
  romi_cohort: number | null; // когортный ROMI по платным каналам
  avg_ltv: number | null; // средний LTV клиента за всё время
  new_clients: number;
  paid_new: number; // новые клиенты периода с оплатой
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
  leads: number;
  clients: number;
  paying: number;
  revenue: number; // касса за период
  cohortLtv: number; // LTV привлечённой когорты
  cpl: number | null;
  cac: number | null;
  romi: number | null;
  romiCohort: number | null;
}
interface InfluenceRow {
  source: string;
  clients: number;
  paying: number;
  revenue: number;
}
interface DateRow {
  date: string;
  // левая часть — маркетинг
  cost: number;
  leads: number;
  cpl: number | null;
  clients: number;
  // правая часть — Fitbase
  sales_count: number;
  revenue: number;
  visits: number;
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
  prevTotals?: { cost: number; leads: number; new_clients: number; revenue: number };
  bySource: SourceRow[];
  channelInfluence: InfluenceRow[];
  lifetimeByChannel: LifetimeRow[];
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
  const initial = presetRange("30d");
  const [preset, setPreset] = useState<PresetKey | "custom">("30d");
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  function applyPreset(key: PresetKey) {
    const r = presetRange(key);
    setPreset(key);
    setFrom(r.from);
    setTo(r.to);
  }

  function loadMetrics() {
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
  }, [from, to]);

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
  const p = data?.prevTotals;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Обзор</h1>
          <div className="sub">Реклама → визиты → лиды → клиенты. Данные обновляются раз в сутки.</div>
        </div>
        <div className="controls">
          {PRESETS.map((p) => (
            <button key={p.key} className={p.key === preset ? "active" : ""} onClick={() => applyPreset(p.key)}>
              {p.label}
            </button>
          ))}
          <button onClick={handleSync} disabled={syncing} className="sync-btn">
            {syncing ? "Обновление…" : "Обновить данные"}
          </button>
        </div>
      </div>

      <div className="daterange">
        <span className="muted">Период:</span>
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }}
        />
        <span className="muted">—</span>
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => { setPreset("custom"); setTo(e.target.value); }}
        />
        {preset === "custom" && <span className="badge">свой период</span>}
      </div>

      {syncMsg && <div className="card muted" style={{ marginBottom: 16 }}>{syncMsg}</div>}
      {error && <div className="card neg">Ошибка загрузки: {error}</div>}
      {!data && !error && <div className="card muted">Загрузка…</div>}

      {data && t && (
        <>
          <div className="kpis">
            <Kpi label="Расход" value={rub(t.cost)} delta={<Delta cur={t.cost} prev={p?.cost ?? 0} mode="neutral" />} />
            <Kpi label="Лиды" value={num(t.leads)} delta={<Delta cur={t.leads} prev={p?.leads ?? 0} />} />
            <Kpi label="Клиенты" value={num(t.new_clients)} delta={<Delta cur={t.new_clients} prev={p?.new_clients ?? 0} />} />
            <Kpi label="Касса за период" value={rub(t.revenue)} delta={<Delta cur={t.revenue} prev={p?.revenue ?? 0} />} />
            <Kpi label="Средний LTV клиента" value={t.avg_ltv != null ? rub(t.avg_ltv) : "—"} />
            <Kpi
              label="ROMI когорты"
              value={pct(t.romi_cohort ?? null)}
              className={t.romi_cohort != null && t.romi_cohort >= 0 ? "pos" : "neg"}
            />
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
              Конверсии Визит→Лид считаются по Метрике, Лид→Клиент — межсистемно
              (Метрика → Fitbase) и носят ориентировочный характер; Клиент→Оплата — доля
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
                  <Kpi
                    label="CAC"
                    value={cac != null ? rub(cac) : "—"}
                    title="Средняя стоимость клиента = рекламный расход ÷ все новые клиенты периода (blended)."
                  />
                  <Kpi
                    label="LTV/CAC"
                    value={ratioStr}
                    className={ratioCls}
                    title="Средний LTV клиента ÷ CAC. Ориентир здоровья юнит-экономики — от 3×."
                  />
                  <Kpi
                    label="ДРР"
                    value={drr != null ? pct(drr) : "—"}
                    title="Доля рекламных расходов = расход ÷ выручка (касса) за период."
                  />
                </>
              );
            })()}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 4 }}>
            CAC — «blended» (весь рекламный расход на всех новых клиентов, включая органических).
            LTV/CAC берёт средний LTV за всё время против CAC периода.
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>Динамика</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.timeline}>
                  <CartesianGrid stroke="#38302a" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#a8998c" fontSize={12} />
                  <YAxis yAxisId="left" stroke="#a8998c" fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" stroke="#e0a53b" fontSize={12} />
                  <Tooltip
                    contentStyle={{ background: "#201a16", border: "1px solid #38302a", borderRadius: 8 }}
                    formatter={(v: number, name) =>
                      name === "Лиды" ? num(v) : rub(v)
                    }
                  />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="cost" name="Расход" stroke="#e0271b" dot={false} strokeWidth={2} />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" name="Выручка" stroke="#46c07a" dot={false} strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="leads" name="Лиды" stroke="#e0a53b" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="section-title">
            По источникам · {PRESETS.find((p) => p.key === preset)?.label ?? `${from} — ${to}`}
          </div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th title="Канал привлечения (откуда пришёл клиент). Подробнее — во вкладке «Справка».">Источник</th>
                  <th title="Сколько потрачено на рекламу этого канала за период.">Расход</th>
                  <th title="Обращения: заявки, звонки, цели Метрики.">Лиды</th>
                  <th title="Стоимость одного лида = Расход ÷ Лиды.">CPL</th>
                  <th title="Новые клиенты, привлечённые каналом (по первому касанию).">Клиенты</th>
                  <th title="Из привлечённых — сколько сделали хотя бы одну оплату.">Оплатили</th>
                  <th title="Стоимость привлечения клиента = Расход ÷ Клиенты.">CAC</th>
                  <th title="Реальные оплаты за период (из отчёта Fitbase). Сходится с кассой Fitbase.">Касса</th>
                  <th title="Когортный ROMI: (LTV привлечённых за период клиентов − Расход) ÷ Расход. Честная окупаемость привлечения.">ROMI когорты</th>
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
                    <td>{num(s.paying)}</td>
                    <td>{s.cac != null ? rub(s.cac) : "—"}</td>
                    <td>{rub(s.revenue)}</td>
                    <td className={s.romiCohort != null ? (Number(s.romiCohort) >= 0 ? "pos" : "neg") : "muted"}>
                      {pct(s.romiCohort)}
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
                      <td>{num(t.paying)}</td>
                      <td>{t.cac != null ? rub(t.cac) : "—"}</td>
                      <td>{rub(t.revenue)}</td>
                      <td className={data.totals.romi_cohort != null ? (data.totals.romi_cohort >= 0 ? "pos" : "neg") : "muted"}>
                        {pct(data.totals.romi_cohort ?? null)}
                      </td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>

          <div className="section-title">Ценность клиентов по каналам · за всё время</div>
          <div className="card">
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Сколько денег принесли за <b>всю жизнь</b> клиенты, которых привёл канал (по первому касанию).
              Не зависит от выбранного периода — показывает, какой канал приводит самых <b>денежных</b> клиентов.
            </div>
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

          <div className="section-title">Влияние каналов · касания за период</div>
          <div className="card">
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Клиенты, которые <b>касались</b> канала в периоде (не обязательно первым касанием), и их LTV.
              Показывает реальное влияние канала. Один клиент может попасть в несколько каналов —
              поэтому выручка здесь <b>пересекается</b> между каналами и не суммируется в общий итог.
            </div>
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

          <div className="section-title">
            По дням · {PRESETS.find((p) => p.key === preset)?.label ?? `${from} — ${to}`}
          </div>
          <div className="card">
            <div className="muted" style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
              <b style={{ color: "var(--accent)" }}>Слева — маркетинг/лиды</b> (из рекламы и Метрики):
              расход, заявки-лиды, цена лида и новые клиенты клуба.
              <b style={{ color: "var(--gold)", marginLeft: 8 }}>Справа — Fitbase</b> (факт из клуба):
              продажи и выручка по дате платежа (касса дня) и посещения (визиты клиентов).
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
                  const t = sumMetrics(data.byDate);
                  return (
                    <tfoot>
                      <tr className="total-row">
                        <td>Всего</td>
                        <td className="col-mkt">{rub(t.cost)}</td>
                        <td className="col-mkt">{num(t.leads)}</td>
                        <td className="col-mkt">{t.cpl != null ? rub(t.cpl) : "—"}</td>
                        <td className="col-mkt">{num(t.clients)}</td>
                        <td className="col-fb">{num(t.sales_count)}</td>
                        <td className="col-fb">{rub(t.revenue)}</td>
                        <td className="col-fb">{num(t.visits)}</td>
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
function Delta({
  cur,
  prev,
  mode = "up-good",
}: {
  cur: number;
  prev: number;
  mode?: "up-good" | "neutral";
}) {
  if (!prev) return null; // нет базы за прошлый период — не показываем
  const d = (cur - prev) / prev;
  const up = d >= 0;
  const cls = mode === "neutral" ? "muted" : up ? "pos" : "neg";
  return (
    <span className={cls} style={{ fontSize: 12, marginLeft: 6 }}>
      {up ? "▲" : "▼"} {Math.abs(d * 100).toFixed(0)}%
    </span>
  );
}
