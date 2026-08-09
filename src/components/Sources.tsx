"use client";

import { useEffect, useState } from "react";
import { num } from "@/lib/format";

interface SourceItem {
  utm_source: string;
  visits: number;
  leads: number;
  touches: number;
  label: string | null;
}

export default function Sources() {
  const [items, setItems] = useState<SourceItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        const init: Record<string, string> = {};
        (d.items ?? []).forEach((it: SourceItem) => (init[it.utm_source] = it.label ?? ""));
        setDrafts(init);
      })
      .catch((e) => setError(String(e)));
  }

  useEffect(load, []);

  async function save(utm: string) {
    setSavingKey(utm);
    try {
      await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utm_source: utm, label: drafts[utm] ?? "" }),
      });
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingKey(null);
    }
  }

  const unmapped = items?.filter((i) => !i.label).length ?? 0;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Источники · справочник UTM</h1>
          <div className="sub">
            Присвойте название каналу для каждой UTM-метки — оно появится на дашборде.
            {unmapped > 0 && <span className="badge error" style={{ marginLeft: 8 }}>без названия: {unmapped}</span>}
          </div>
        </div>
        <div className="controls">
          <button onClick={load}>Обновить список</button>
        </div>
      </div>

      {error && <div className="card neg">Ошибка: {error}</div>}
      {!items && !error && <div className="card muted">Загрузка…</div>}

      {items && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>UTM-метка (utm_source)</th>
                <th>Визиты</th>
                <th>Лиды</th>
                <th>Касания</th>
                <th style={{ textAlign: "left" }}>Название канала</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.utm_source}>
                  <td style={{ fontFamily: "monospace" }}>{it.utm_source}</td>
                  <td>{num(it.visits)}</td>
                  <td>{num(it.leads)}</td>
                  <td>{num(it.touches)}</td>
                  <td style={{ textAlign: "left" }}>
                    <input
                      className="src-input"
                      value={drafts[it.utm_source] ?? ""}
                      placeholder="напр. Реклама в лифтах"
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.utm_source]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") save(it.utm_source);
                      }}
                    />
                  </td>
                  <td>
                    <button
                      className="src-save"
                      disabled={savingKey === it.utm_source || (drafts[it.utm_source] ?? "") === (it.label ?? "")}
                      onClick={() => save(it.utm_source)}
                    >
                      {savingKey === it.utm_source ? "…" : "Сохранить"}
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Пока нет UTM-меток. Они появятся здесь, как только пойдёт трафик с метками.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card muted" style={{ marginTop: 16, fontSize: 13 }}>
        Как это работает: любая метка <code>utm_source</code> из трафика и заявок попадает сюда.
        Пустое название — метка показывается на дашборде как есть. После сохранения витрина
        пересчитывается автоматически, и канал появляется на главной вкладке.
      </div>
    </div>
  );
}
