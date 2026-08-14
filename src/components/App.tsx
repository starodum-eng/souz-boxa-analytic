"use client";

import { useState } from "react";
import Dashboard from "./Dashboard";
import Sources from "./Sources";
import Retention from "./Retention";
import Import from "./Import";

export type TabKey = "dash" | "sources" | "retention" | "import";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dash", label: "Дашборд" },
  { key: "sources", label: "Источники" },
  { key: "retention", label: "Удержание" },
  { key: "import", label: "Импорт" },
];

export default function App({ initialTab = "dash" }: { initialTab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initialTab);
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
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? "tab active" : "tab"} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      {tab === "dash" && <Dashboard />}
      {tab === "sources" && <Sources />}
      {tab === "retention" && <Retention />}
      {tab === "import" && <Import />}
    </>
  );
}
