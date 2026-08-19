"use client";

import { useEffect, useState } from "react";
import { num } from "@/lib/format";

interface SourceItem {
  utm_source: string;
  visits: number;
  leads: number;
  touches: number;
  label: string | null;
  ignored: number;
  effective: string | null; // текущий канал (ручной или авто)
  kind: "manual" | "auto" | null;
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

  async function post(payload: Record<string, unknown>, key: string) {
    setSavingKey(key);
    try {
      await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingKey(null);
    }
  }
  const save = (utm: string) => post({ utm_source: utm, label: drafts[utm] ?? "" }, utm);
  const hide = (utm: string) => post({ utm_source: utm, ignored: true }, utm);
  const unhide = (utm: string) => post({ utm_source: utm, ignored: false, label: "" }, utm);

  const active = items?.filter((i) => !i.ignored) ?? [];
  const hidden = items?.filter((i) => i.ignored) ?? [];
  // «без названия» — только те, у кого нет ни ручного названия, ни авто-канала
  const unmapped = active.filter((i) => !i.effective).length;

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
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>UTM-метка (utm_source)</th>
                <th>Визиты</th>
                <th>Лиды</th>
                <th>Касания</th>
                <th style={{ textAlign: "left" }}>Канал (текущий)</th>
                <th style={{ textAlign: "left" }}>Название канала</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((it) => (
                <tr key={it.utm_source}>
                  <td style={{ fontFamily: "monospace" }}>{it.utm_source}</td>
                  <td>{num(it.visits)}</td>
                  <td>{num(it.leads)}</td>
                  <td>{num(it.touches)}</td>
                  <td style={{ textAlign: "left" }}>
                    {it.effective ? (
                      <span>
                        {it.effective}
                        {it.kind === "auto" && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>авто</span>}
                      </span>
                    ) : (
                      <span className="badge error">без названия</span>
                    )}
                  </td>
                  <td style={{ textAlign: "left" }}>
                    <input
                      className="src-input"
                      value={drafts[it.utm_source] ?? ""}
                      placeholder={it.kind === "auto" ? `по умолчанию: ${it.effective}` : "напр. Реклама в лифтах"}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.utm_source]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") save(it.utm_source);
                      }}
                    />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="src-save"
                      disabled={savingKey === it.utm_source || (drafts[it.utm_source] ?? "") === (it.label ?? "")}
                      onClick={() => save(it.utm_source)}
                    >
                      {savingKey === it.utm_source ? "…" : "Сохранить"}
                    </button>
                    <button
                      className="src-hide"
                      disabled={savingKey === it.utm_source}
                      onClick={() => hide(it.utm_source)}
                      title="Убрать метку из списка (мусор/тест) — уйдёт в «Сайт (прочее)»"
                    >
                      Скрыть
                    </button>
                  </td>
                </tr>
              ))}
              {active.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Пока нет UTM-меток. Они появятся здесь, как только пойдёт трафик с метками.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {hidden.length > 0 && (
        <>
          <div className="section-title">Скрытые метки ({hidden.length})</div>
          <div className="card">
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>UTM-метка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {hidden.map((it) => (
                  <tr key={it.utm_source}>
                    <td style={{ fontFamily: "monospace" }} className="muted">{it.utm_source}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="src-save" disabled={savingKey === it.utm_source} onClick={() => unhide(it.utm_source)}>
                        Вернуть
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      <div className="card muted" style={{ marginTop: 16, fontSize: 13 }}>
        Как это работает: любая метка <code>utm_source</code> из трафика и заявок попадает сюда.
        Пустое название — метка показывается на дашборде как есть. После сохранения витрина
        пересчитывается автоматически, и канал появляется на главной вкладке.
      </div>
    </div>
  );
}
