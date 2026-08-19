"use client";

import { useState } from "react";
import Dashboard from "./Dashboard";
import Sources from "./Sources";
import Retention from "./Retention";
import Import from "./Import";
import Glossary from "./Glossary";
import Targets from "./Targets";

export type TabKey = "dash" | "targets" | "sources" | "retention" | "import" | "help";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dash", label: "Дашборд" },
  { key: "targets", label: "Цели" },
  { key: "sources", label: "Источники" },
  { key: "retention", label: "Удержание" },
  { key: "import", label: "Импорт" },
  { key: "help", label: "Справка" },
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
      {tab === "dash" && <Dashboard onGoTargets={() => setTab("targets")} />}
      {tab === "targets" && <Targets />}
      {tab === "sources" && <Sources />}
      {tab === "retention" && <Retention />}
      {tab === "import" && <Import />}
      {tab === "help" && <Glossary />}
    </>
  );
}
