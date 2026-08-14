"use client";

import { useState } from "react";

/**
 * Страница загрузки выручки: заливаем CSV из Fitbase «Отчёт по продажам».
 * Это источник правды по кассе (с онлайн-платежами/продлениями CloudPayments).
 */
export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [secret, setSecret] = useState("");
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
      fd.append("secret", secret);
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

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px", color: "var(--fg, #e8e0d6)" }}>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Загрузка выручки из Fitbase</h1>
      <p style={{ opacity: 0.8, lineHeight: 1.5, marginBottom: 20, fontSize: 14 }}>
        В Fitbase: <b>Отчёты и аналитика → Финансы → «Отчёт по продажам»</b>. Поставь период, нажми{" "}
        <b>«Выгрузить в Excel» → CSV</b> и залей файл сюда. Повторная загрузка того же периода не создаёт дублей.
      </p>

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <span>CSV-файл отчёта по продажам</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ padding: 8, background: "#1c1712", border: "1px solid #3a2f26", borderRadius: 8, color: "inherit" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <span>Ключ (CRON_SECRET)</span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="значение CRON_SECRET из Vercel"
            style={{ padding: 10, background: "#1c1712", border: "1px solid #3a2f26", borderRadius: 8, color: "inherit" }}
          />
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
