"use client";

import { useState, useEffect, useCallback } from "react";

/** YYYY-MM-DD → DD.MM.YYYY (null/пусто → «—»). */
function ru(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return day && m && y ? `${day}.${m}.${y}` : String(d);
}
/** ISO-время → dd.mm.yyyy HH:MM (локально). */
function ruDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
function money(v: unknown): string {
  return `${Math.round(Number(v) || 0).toLocaleString("ru-RU")} ₽`;
}
/** YYYY-MM → «Август 2025». */
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
function ruMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS[idx]} ${y}` : ym;
}

interface HistoryRow {
  filename: string | null;
  imported_at: string | null;
  range_from: string | null;
  range_to: string | null;
  rows: number;
  sum_paid: string | number;
}
interface ImportInfo {
  history: HistoryRow[];
  coverage: { from: string | null; to: string | null; days: number; total: string | number };
  byMonth: { month: string; days: number; sum: string | number }[];
}

/**
 * Импорт выручки: заливаем CSV из Fitbase «Отчёт по продажам».
 * Источник правды по кассе (с онлайн-платежами/продлениями CloudPayments).
 * Доступ закрыт логином дашборда (Basic Auth), отдельного ключа не нужно.
 */
export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ImportInfo | null>(null);

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/import-sales");
      if (res.ok) setInfo(await res.json());
    } catch {
      /* тихо — блок истории просто не покажется */
    }
  }, []);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file) {
      setError("Выбери CSV-файл выгрузки.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import-sales", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Ошибка импорта");
      else {
        setResult(json);
        loadInfo(); // обновляем историю и покрытие сразу после загрузки
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          <h1>Импорт выручки</h1>
          <div className="sub">Загрузка отчёта Fitbase «Отчёт по продажам» — источник правды по кассе.</div>
        </div>
      </div>

      <div className="card" style={{ lineHeight: 1.55, fontSize: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Откуда взять файл</div>
        <ol style={{ margin: "0 0 0 18px", display: "grid", gap: 4 }}>
          <li>Fitbase → <b>Отчёты и аналитика</b> → блок <b>Финансы</b> → <b>«Отчёт по продажам»</b>.</li>
          <li>Задай <b>период</b> в поле «Дата оплаты» (первый раз — большой, напр. 01.01.2025 — сегодня).</li>
          <li>Нажми <b>«Выгрузить в Excel» → CSV</b>.</li>
          <li>Выбери этот CSV ниже и нажми «Загрузить».</li>
        </ol>
        <div style={{ marginTop: 10, opacity: 0.75 }}>
          Формат: <b>CSV</b> (разделитель «;»). Сумма берётся из колонки «Оплачено, ₽». Повторная загрузка того же
          периода <b>не создаёт дублей</b>, так что можно грузить с запасом по датам.
        </div>
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 14, maxWidth: 520, marginTop: 18 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <span>CSV-файл «Отчёт по продажам»</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={box} />
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
          {busy ? "Загружаю…" : "Загрузить"}
        </button>
      </form>

      {error && (
        <div className="card" style={{ marginTop: 18, background: "rgba(224,39,27,0.08)", border: "1px solid rgba(224,39,27,0.35)", color: "var(--text)", fontSize: 14 }}>
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div className="card" style={{ marginTop: 18, background: "rgba(26,160,83,0.08)", border: "1px solid rgba(26,160,83,0.35)", color: "var(--text)", fontSize: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>✅ Загружено</div>
          <div>Строк: <b>{String(result.parsed_rows)}</b></div>
          <div>Сумма «Оплачено»: <b>{Number(result.sum_paid).toLocaleString("ru-RU")} ₽</b></div>
          <div>Период: <b>{String((result.date_range as any)?.from)} … {String((result.date_range as any)?.to)}</b></div>
          <div style={{ marginTop: 6 }}>По способу оплаты:</div>
          <ul style={{ margin: "4px 0 0 18px" }}>
            {Object.entries((result.by_method as Record<string, number>) || {}).map(([k, v]) => (
              <li key={k}>
                {k}: {Number(v).toLocaleString("ru-RU")} ₽
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 10, opacity: 0.85 }}>{String(result.note)}</div>
        </div>
      )}

      {/* Покрытие данных */}
      <div className="section-title" style={{ marginTop: 26 }}>Покрытие данных</div>
      <div className="card" style={{ fontSize: 14, lineHeight: 1.55 }}>
        {info && info.coverage.from ? (
          <>
            <div>
              Касса есть за период <b>{ru(info.coverage.from)} – {ru(info.coverage.to)}</b> · дней с оплатами:{" "}
              <b>{info.coverage.days}</b> · всего: <b>{money(info.coverage.total)}</b>
            </div>
            {info.byMonth.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="report">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Месяц</th>
                      <th>Дней с данными</th>
                      <th>Касса</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.byMonth.map((m) => (
                      <tr key={m.month}>
                        <td style={{ textAlign: "left" }}>{ruMonth(m.month)}</td>
                        <td>{m.days}</td>
                        <td>{money(m.sum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="muted">Ещё не загружено.</div>
        )}
      </div>

      {/* История загрузок */}
      <div className="section-title" style={{ marginTop: 26 }}>История загрузок</div>
      <div className="card" style={{ fontSize: 14 }}>
        {info && info.history.length > 0 ? (
          <div className="table-wrap">
            <table className="report">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Дата загрузки</th>
                  <th style={{ textAlign: "left" }}>Файл</th>
                  <th>Период файла</th>
                  <th>Строк</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {info.history.map((h, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: "left" }}>{ruDateTime(h.imported_at)}</td>
                    <td style={{ textAlign: "left", wordBreak: "break-all" }}>{h.filename || "—"}</td>
                    <td>{ru(h.range_from)} – {ru(h.range_to)}</td>
                    <td>{Number(h.rows).toLocaleString("ru-RU")}</td>
                    <td>{money(h.sum_paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Загрузок ещё не было.</div>
        )}
      </div>
    </div>
  );
}
