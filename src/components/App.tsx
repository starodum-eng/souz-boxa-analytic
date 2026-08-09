"use client";

import { useState } from "react";
import Dashboard from "./Dashboard";
import Sources from "./Sources";

export default function App() {
  const [tab, setTab] = useState<"dash" | "sources">("dash");
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-logo">СБ</span>
            <div>
              <div className="brand-name">Союз Бокса</div>
              <div className="brand-sub">Сквозная аналитика</div>
            </div>
          </div>
          <nav className="tabs">
            <button className={tab === "dash" ? "tab active" : "tab"} onClick={() => setTab("dash")}>
              Дашборд
            </button>
            <button className={tab === "sources" ? "tab active" : "tab"} onClick={() => setTab("sources")}>
              Источники
            </button>
          </nav>
        </div>
      </header>
      {tab === "dash" ? <Dashboard /> : <Sources />}
    </>
  );
}
