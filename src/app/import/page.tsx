"use client";

import { useState } from "react";

/**
 * Страница загрузки выручки: заливаем CSV из Fitbase «Отчёт по продажам».
 * Это источник правды по кассе (с онлайн-платежами/продлениями CloudPayments).
 * Доступ закрыт логином дашборда (Basic Auth), отдельного ключа не нужно.
 */
export default function ImportPage() {
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
    background: "#1c1712",
    border: "1px solid #3a2f26",
    borderRadius: 8,
    color: "inherit",
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", color: "var(--fg, #e8e0d6)" }}>
      <a href="/" style={{ color: "var(--gold, #e0a53b)", textDecoration: "none", fontSize: 14 }}>
        ← Назад к дашборду
      </a>
      <h1 style={{ fontSize: 22, margin: "12px 0 6px" }}>Загрузка выручки из Fitbase</h1>
      <p style={{ opacity: 0.8, lineHeight: 1.5, marginBottom: 18, fontSize: 14 }}>
        Дашборд считает «Кассу за период», LTV и ROMI из этого журнала продаж. Он включает онлайн-платежи и
        продления (CloudPayments), которых нет в API Fitbase, поэтому и сходится с реальной выручкой.
      </p>

      <div
        style={{
          padding: 16,
          background: "#191410",
          border: "1px solid #3a2f26",
          borderRadius: 10,
          fontSize: 14,
          lineHeight: 1.55,
          marginBottom: 22,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Откуда взять файл</div>
        <ol style={{ margin: "0 0 0 18px", display: "grid", gap: 4 }}>
          <li>Fitbase → <b>Отчёты и аналитика</b> → блок <b>Финансы</b> → <b>«Отчёт по продажам»</b>.</li>
          <li>Задай <b>период</b> в поле «Дата оплаты» (первый раз — большой, напр. 01.01.2025 — сегодня).</li>
          <li>Нажми <b>«Выгрузить в Excel» → CSV</b>.</li>
          <li>Выбери этот CSV ниже и нажми «Загрузить».</li>
        </ol>
        <div style={{ marginTop: 10, opacity: 0.75 }}>
          Формат: <b>CSV</b> (разделитель «;»). Сумма берётся из колонки «Оплачено, ₽». Повторная загрузка того же
          периода <b>не создаёт дублей</b> (склейка по номеру чека), так что можно грузить с запасом по датам.
        </div>
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
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
        <div style={{ marginTop: 18, padding: 14, background: "#3a1512", border: "1px solid #7a2a20", borderRadius: 8, fontSize: 14 }}>
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 18, padding: 16, background: "#152012", border: "1px solid #2f5a26", borderRadius: 8, fontSize: 14 }}>
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
    </main>
  );
}
