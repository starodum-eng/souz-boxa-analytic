"use client";

import { useEffect, useState } from "react";

interface Row {
  [k: string]: unknown;
}
interface Data {
  summary: Row;
  salesStructure: Row[];
  callList: Row[];
  atRisk: Row[];
}

const money = (v: unknown) => Number(v || 0).toLocaleString("ru-RU") + " ₽";
const dstr = (v: unknown) => (v ? String(v) : "—");
function phoneLink(p: unknown) {
  const raw = String(p ?? "").trim();
  if (!raw) return "—";
  const tel = raw.replace(/[^\d+]/g, "");
  return (
    <a href={`tel:${tel}`} style={{ color: "var(--gold, #e0a53b)", textDecoration: "none" }}>
      {raw}
    </a>
  );
}

export default function Retention() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/retention")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  const s = data?.summary ?? {};

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Удержание</h1>
          <div className="sub">Продления, отток и список «кому звонить». Основано на абонементах и визитах Fitbase.</div>
        </div>
      </div>

      {err && <div className="card" style={{ color: "#e0827b" }}>Ошибка: {err}</div>}
      {!data && !err && <div className="card muted">Загрузка…</div>}

      {data && (
        <>
          <div className="kpis">
            <div className="card kpi">
              <div className="label">Активные абонементы</div>
              <div className="value">{String(s.active ?? 0)}</div>
            </div>
            <div className="card kpi">
              <div className="label">Заканчиваются за 14 дней</div>
              <div className="value" style={{ color: "var(--gold, #e0a53b)" }}>{String(s.ending_14d ?? 0)}</div>
            </div>
            <div className="card kpi">
              <div className="label">Истекли (за 7 дней)</div>
              <div className="value" style={{ color: "#e0827b" }}>{String(s.expired_7d ?? 0)}</div>
            </div>
            <div className="card kpi">
              <div className="label">Не ходят 14+ дней</div>
              <div className="value" style={{ color: "#e0827b" }}>{String(s.no_visit_14d ?? 0)}</div>
            </div>
          </div>

          <div className="section-title">Структура продаж за 30 дней</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Тип</th>
                  <th>Кол-во</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {data.salesStructure.map((r, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: "left" }}>{String(r.status)}</td>
                    <td style={{ textAlign: "center" }}>{String(r.cnt)}</td>
                    <td style={{ textAlign: "right" }}>{money(r.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-title">📞 Кому звонить · заканчиваются / истекли ({data.callList.length})</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Клиент</th>
                  <th style={{ textAlign: "left" }}>Телефон</th>
                  <th style={{ textAlign: "left" }}>Абонемент</th>
                  <th>Окончание</th>
                  <th>Осталось дней</th>
                  <th>Последний визит</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.callList.map((r, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: "left" }}>{dstr(r.name)}</td>
                    <td style={{ textAlign: "left" }}>{phoneLink(r.phone)}</td>
                    <td style={{ textAlign: "left" }}>{dstr(r.tariff)}</td>
                    <td style={{ textAlign: "center" }}>{dstr(r.end_d)}</td>
                    <td style={{ textAlign: "center", color: Number(r.days_left) < 0 ? "#e0827b" : "inherit" }}>
                      {Number(r.days_left) < 0 ? `просрочен ${-Number(r.days_left)}` : String(r.days_left)}
                    </td>
                    <td style={{ textAlign: "center" }}>{dstr(r.last_visit_d)}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className="badge" style={{ background: r.state === "истёк" ? "#5a2620" : "#5a4620" }}>
                        {String(r.state)}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.callList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: "center" }}>Нет заканчивающихся абонементов</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="section-title">🚪 Не ходят · активный абонемент, нет визитов 14+ дней ({data.atRisk.length})</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Клиент</th>
                  <th style={{ textAlign: "left" }}>Телефон</th>
                  <th style={{ textAlign: "left" }}>Абонемент</th>
                  <th>Окончание</th>
                  <th>Последний визит</th>
                  <th>Дней без визита</th>
                </tr>
              </thead>
              <tbody>
                {data.atRisk.map((r, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: "left" }}>{dstr(r.name)}</td>
                    <td style={{ textAlign: "left" }}>{phoneLink(r.phone)}</td>
                    <td style={{ textAlign: "left" }}>{dstr(r.tariff)}</td>
                    <td style={{ textAlign: "center" }}>{dstr(r.end_d)}</td>
                    <td style={{ textAlign: "center" }}>{r.last_visit_d ? String(r.last_visit_d) : "не был(а)"}</td>
                    <td style={{ textAlign: "center", color: "#e0827b" }}>
                      {r.days_since_visit != null ? String(r.days_since_visit) : "—"}
                    </td>
                  </tr>
                ))}
                {data.atRisk.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: "center" }}>Все активные клиенты ходят</td>
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
