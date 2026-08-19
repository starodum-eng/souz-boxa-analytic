"use client";

import { useState } from "react";

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
      else setResult(json);
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
    </div>
  );
}
