"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Ручной ввод расходов по каналам с амортизацией по периоду (ТЗ №19).
 * Для каналов без авто-интеграции (Яндекс.Бизнес пакет, офлайн-реклама и т.п.).
 * Сумма размазывается равномерно по дням периода в витрину daily_metrics.
 */

interface CostRow {
  id: number;
  channel: string;
  amount: number;
  periodFrom: string | null;
  periodTo: string | null;
  note: string | null;
  recognizedToDate: number;
  progress: number;
}

function ru(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return day && m && y ? `${day}.${m}.${y}` : String(d);
}
function money(v: unknown): string {
  return `${Math.round(Number(v) || 0).toLocaleString("ru-RU")} ₽`;
}

export default function Costs() {
  const [items, setItems] = useState<CostRow[] | null>(null);
  const [channelHints, setChannelHints] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [channel, setChannel] = useState("");
  const [amount, setAmount] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/costs");
      const d = await res.json();
      setItems(d.items ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
    // подсказки каналов из витрины
    fetch("/api/channel-groups")
      .then((r) => r.json())
      .then((d) => {
        const chans = (d.items ?? []).map((c: { channel: string }) => c.channel);
        const parents = d.parents ?? [];
        setChannelHints([...new Set<string>([...parents, ...chans])]);
      })
      .catch(() => {});
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, amount: Number(amount), periodFrom, periodTo, note }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || "Ошибка");
      else {
        setChannel("");
        setAmount("");
        setPeriodFrom("");
        setPeriodTo("");
        setNote("");
        load();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Удалить этот расход? Он исчезнет из отчёта после пересчёта.")) return;
    setBusy(true);
    try {
      await fetch("/api/costs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = {
    padding: 10,
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Расходы вручную</h1>
          <div className="sub">
            Расход по каналам без авто-интеграции (пакет Яндекс.Бизнеса, офлайн-реклама). Сумма
            равномерно распределяется по дням периода и учитывается в любом окне дашборда.
          </div>
        </div>
      </div>

      <datalist id="cost-channels">
        {channelHints.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <form onSubmit={add} className="card" style={{ display: "grid", gap: 12, maxWidth: 640 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <span>Канал</span>
          <input
            list="cost-channels"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="напр. Яндекс.Бизнес"
            style={box}
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
            <span>Сумма, ₽</span>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={box} />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
            <span>Период с</span>
            <input type="date" value={periodFrom} max={periodTo || undefined} onChange={(e) => setPeriodFrom(e.target.value)} style={box} />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
            <span>по</span>
            <input type="date" value={periodTo} min={periodFrom || undefined} onChange={(e) => setPeriodTo(e.target.value)} style={box} />
          </label>
        </div>
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <span>Заметка</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="напр. Пакет продвижения на 3 мес" style={box} />
        </label>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "12px 18px",
            background: busy ? "#5a2620" : "#e0271b",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            justifySelf: "start",
          }}
        >
          {busy ? "…" : "Добавить"}
        </button>
        {error && <div className="neg" style={{ fontSize: 14 }}>⚠️ {error}</div>}
      </form>

      <div className="section-title" style={{ marginTop: 24 }}>Внесённые расходы</div>
      <div className="card">
        {items && items.length > 0 ? (
          <div className="table-wrap">
            <table className="report">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Канал</th>
                  <th>Сумма</th>
                  <th>Период</th>
                  <th>Признано на сегодня</th>
                  <th style={{ textAlign: "left" }}>Заметка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td style={{ textAlign: "left" }}>{c.channel}</td>
                    <td>{money(c.amount)}</td>
                    <td>{ru(c.periodFrom)} – {ru(c.periodTo)}</td>
                    <td>
                      {money(c.recognizedToDate)} <span className="muted">({c.progress}%)</span>
                    </td>
                    <td style={{ textAlign: "left" }}>{c.note || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="src-hide" disabled={busy} onClick={() => remove(c.id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Расходов ещё не добавлено.</div>
        )}
      </div>

      <div className="card muted" style={{ marginTop: 16, fontSize: 13, lineHeight: 1.5 }}>
        Как считается: сумма делится на число дней периода и каждый день добавляется в расход канала.
        В окне дашборда (напр. «7 дн.») учитывается только та часть, что пришлась на эти дни. Если у
        канала есть и авто-расход (Директ/VK), и ручной — они складываются.
      </div>
    </div>
  );
}
