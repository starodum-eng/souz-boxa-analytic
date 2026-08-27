"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { rub, num } from "@/lib/format";
import { PLATFORMS, currentMondayMsk, addDaysStr } from "@/lib/smm";

type Fields = { posts: string; reach: string; engagement: string; followers: string; clicks: string; spend: string; note: string };
const EMPTY: Fields = { posts: "", reach: "", engagement: "", followers: "", clicks: "", spend: "", note: "" };

interface WeekResp {
  weekStart: string;
  rows: { platform: string; posts: number; reach: number; engagement: number; followers: number; clicks: number; spend: number; note: string }[];
  prevFollowers: Record<string, number>;
}
interface TrendResp {
  weeks: string[];
  byPlatform: { platform: string; week: string; reach: number; followers: number; engagement: number; posts: number; spend: number }[];
}

function shortDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
const N = (s: string) => Number(s) || 0;

export default function Content() {
  // По умолчанию — ПРОШЛАЯ неделя (её и заполняем по факту).
  const [week, setWeek] = useState<string>(addDaysStr(currentMondayMsk(), -7));
  const [vals, setVals] = useState<Record<string, Fields>>({});
  const [baseline, setBaseline] = useState<Record<string, Fields>>({});
  const [prevFollowers, setPrevFollowers] = useState<Record<string, number>>({});
  const [trends, setTrends] = useState<TrendResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function loadWeek(w: string) {
    fetch(`/api/smm?week=${w}`)
      .then((r) => r.json())
      .then((j: WeekResp) => {
        const next: Record<string, Fields> = {};
        for (const p of PLATFORMS) {
          const row = j.rows.find((x) => x.platform === p.key);
          next[p.key] = row
            ? {
                posts: String(row.posts || ""),
                reach: String(row.reach || ""),
                engagement: String(row.engagement || ""),
                followers: String(row.followers || ""),
                clicks: String(row.clicks || ""),
                spend: String(row.spend || ""),
                note: row.note || "",
              }
            : { ...EMPTY };
        }
        setVals(next);
        setBaseline(next);
        setPrevFollowers(j.prevFollowers ?? {});
      });
  }
  function loadTrends() {
    fetch(`/api/smm?weeks=12`).then((r) => r.json()).then(setTrends);
  }

  useEffect(() => {
    loadWeek(week);
  }, [week]);
  useEffect(() => {
    loadTrends();
  }, []);

  function setField(p: string, f: keyof Fields, v: string) {
    setVals((prev) => ({ ...prev, [p]: { ...(prev[p] ?? EMPTY), [f]: v } }));
  }

  async function save() {
    setBusy(true);
    try {
      const changed = PLATFORMS.filter((p) => JSON.stringify(vals[p.key] ?? EMPTY) !== JSON.stringify(baseline[p.key] ?? EMPTY));
      for (const p of changed) {
        const v = vals[p.key] ?? EMPTY;
        await fetch("/api/smm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart: week, platform: p.key, ...v }),
        });
      }
      setBaseline({ ...vals });
      loadTrends();
      setToast(changed.length ? "Сохранено" : "Изменений нет");
    } catch (e) {
      setToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  const dirty = PLATFORMS.some((p) => JSON.stringify(vals[p.key] ?? EMPTY) !== JSON.stringify(baseline[p.key] ?? EMPTY));
  const growth = (p: string): number | null =>
    prevFollowers[p] == null ? null : N(vals[p]?.followers ?? "") - prevFollowers[p];

  // Итоги недели.
  const tot = useMemo(() => {
    let posts = 0, reach = 0, engagement = 0, spend = 0, clicks = 0, growthSum = 0;
    for (const p of PLATFORMS) {
      const v = vals[p.key] ?? EMPTY;
      posts += N(v.posts);
      reach += N(v.reach);
      engagement += N(v.engagement);
      spend += N(v.spend);
      clicks += N(v.clicks);
      const g = growth(p.key);
      if (g != null) growthSum += g;
    }
    return {
      posts,
      reach,
      engagement,
      spend,
      clicks,
      growthSum,
      er: reach > 0 ? (engagement / reach) * 100 : null,
      cpm: spend > 0 && reach > 0 ? (spend / reach) * 1000 : null,
      costPerFollower: spend > 0 && growthSum > 0 ? spend / growthSum : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vals, prevFollowers]);

  const platformsWithData = new Set(trends?.byPlatform.map((x) => x.platform) ?? []);
  const pivot = (metric: "reach" | "followers") =>
    (trends?.weeks ?? []).map((w) => {
      const row: Record<string, number | string> = { week: shortDate(w) };
      for (const p of PLATFORMS) {
        const rec = trends?.byPlatform.find((x) => x.week === w && x.platform === p.key);
        row[p.key] = rec ? rec[metric] : 0;
      }
      return row;
    });
  const reachData = pivot("reach");
  const followersData = pivot("followers");

  const inputStyle: React.CSSProperties = {
    width: 84,
    textAlign: "right",
    padding: "5px 7px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--panel)",
    color: "var(--text)",
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>СММ</h1>
          <div className="sub">Недельный отчёт по соцсетям: публикации, охват, аудитория. Верх воронки.</div>
        </div>
        <div className="controls">
          <button onClick={() => setWeek(addDaysStr(week, -7))}>‹</button>
          <span style={{ padding: "7px 6px", fontSize: 13, fontWeight: 600 }}>
            Неделя: {shortDate(week)}–{shortDate(addDaysStr(week, 6))}
          </span>
          <button onClick={() => setWeek(addDaysStr(week, 7))}>›</button>
          <button className="sync-btn" onClick={save} disabled={busy || !dirty}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      {toast && <div className="card muted" style={{ marginBottom: 16 }}>{toast}</div>}

      {/* ── Ввод ── */}
      <div className="card" style={{ padding: 0 }}>
        <div className="report-wrap">
          <table className="report">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Площадка</th>
                <th>Публикации</th>
                <th>Охват</th>
                <th>Вовлечённость</th>
                <th>Подписчики</th>
                <th>Прирост</th>
                <th>Переходы</th>
                <th>Бюджет</th>
                <th style={{ textAlign: "left" }}>Заметка</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((p) => {
                const v = vals[p.key] ?? EMPTY;
                const g = growth(p.key);
                return (
                  <tr key={p.key}>
                    <td style={{ textAlign: "left" }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: p.color, marginRight: 8 }} />
                      {p.label}
                    </td>
                    {(["posts", "reach", "engagement", "followers"] as const).map((f) => (
                      <td key={f}>
                        <input type="number" inputMode="numeric" value={v[f]} onChange={(e) => setField(p.key, f, e.target.value)} style={inputStyle} />
                      </td>
                    ))}
                    <td className={g == null ? "muted" : g >= 0 ? "pos" : "neg"}>
                      {g == null ? "—" : `${g >= 0 ? "+" : ""}${num(g)}`}
                    </td>
                    {(["clicks", "spend"] as const).map((f) => (
                      <td key={f}>
                        <input type="number" inputMode="decimal" value={v[f]} onChange={(e) => setField(p.key, f, e.target.value)} style={inputStyle} />
                      </td>
                    ))}
                    <td style={{ textAlign: "left" }}>
                      <input
                        type="text"
                        value={v.note}
                        onChange={(e) => setField(p.key, "note", e.target.value)}
                        placeholder="…"
                        style={{ ...inputStyle, width: 160, textAlign: "left" }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Заявки и клиенты из соцсетей считаются автоматически в «Отчёте по каналам» — здесь их вводить не нужно.
        «Подписчики» — всего на конец недели; прирост считается к прошлой неделе.
      </div>

      {/* ── Итоги недели ── */}
      <div className="section-title">Итоги недели · {shortDate(week)}–{shortDate(addDaysStr(week, 6))}</div>
      <div className="statbar">
        <Stat label="Публикаций" value={num(tot.posts)} />
        <Stat label="Охват" value={num(tot.reach)} />
        <Stat label="Вовлечённость" value={num(tot.engagement)} />
        <Stat label="Прирост подписчиков" value={`${tot.growthSum >= 0 ? "+" : ""}${num(tot.growthSum)}`} />
        <Stat label="ER (engagement/reach)" value={tot.er != null ? `${tot.er.toFixed(1)}%` : "—"} />
        {tot.spend > 0 && <Stat label="CPM охвата" value={tot.cpm != null ? rub(tot.cpm) : "—"} />}
        {tot.spend > 0 && <Stat label="Стоимость подписчика" value={tot.costPerFollower != null ? rub(tot.costPerFollower) : "—"} />}
      </div>

      {/* ── Тренды ── */}
      <div className="section-title">Охват по неделям · 12 недель</div>
      <div className="card">
        <div className="chart-wrap" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={reachData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="week" stroke="var(--muted)" fontSize={11} />
              <YAxis stroke="var(--muted)" fontSize={11} width={54} />
              <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v: number) => num(v)} />
              <Legend />
              {PLATFORMS.filter((p) => platformsWithData.has(p.key)).map((p) => (
                <Line key={p.key} type="monotone" dataKey={p.key} name={p.label} stroke={p.color} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="section-title">Подписчики по неделям · 12 недель</div>
      <div className="card">
        <div className="chart-wrap" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={followersData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="week" stroke="var(--muted)" fontSize={11} />
              <YAxis stroke="var(--muted)" fontSize={11} width={54} />
              <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v: number) => num(v)} />
              <Legend />
              {PLATFORMS.filter((p) => platformsWithData.has(p.key)).map((p) => (
                <Line key={p.key} type="monotone" dataKey={p.key} name={p.label} stroke={p.color} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Таблица по площадкам за неделю ── */}
      <div className="section-title">По площадкам · {shortDate(week)}–{shortDate(addDaysStr(week, 6))}</div>
      <div className="card" style={{ padding: 0 }}>
        <div className="report-wrap">
          <table className="report">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Площадка</th>
                <th>Посты</th>
                <th>Охват</th>
                <th>Вовлечённость</th>
                <th>ER</th>
                <th>Подписчики</th>
                <th>Прирост</th>
                <th>Переходы</th>
                <th>Бюджет</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((p) => {
                const v = vals[p.key] ?? EMPTY;
                const reach = N(v.reach);
                const er = reach > 0 ? (N(v.engagement) / reach) * 100 : null;
                const g = growth(p.key);
                return (
                  <tr key={p.key}>
                    <td style={{ textAlign: "left" }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: p.color, marginRight: 8 }} />
                      {p.label}
                    </td>
                    <td>{num(N(v.posts))}</td>
                    <td>{num(reach)}</td>
                    <td>{num(N(v.engagement))}</td>
                    <td>{er != null ? `${er.toFixed(1)}%` : "—"}</td>
                    <td>{num(N(v.followers))}</td>
                    <td className={g == null ? "muted" : g >= 0 ? "pos" : "neg"}>{g == null ? "—" : `${g >= 0 ? "+" : ""}${num(g)}`}</td>
                    <td>{num(N(v.clicks))}</td>
                    <td>{rub(N(v.spend))}</td>
                  </tr>
                );
              })}
              <tr className="total-top">
                <td style={{ textAlign: "left" }}>Итого</td>
                <td>{num(tot.posts)}</td>
                <td>{num(tot.reach)}</td>
                <td>{num(tot.engagement)}</td>
                <td>{tot.er != null ? `${tot.er.toFixed(1)}%` : "—"}</td>
                <td>—</td>
                <td>{`${tot.growthSum >= 0 ? "+" : ""}${num(tot.growthSum)}`}</td>
                <td>{num(tot.clicks)}</td>
                <td>{rub(tot.spend)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="s-label">{label}</div>
      <div className="s-value">{value}</div>
    </div>
  );
}
