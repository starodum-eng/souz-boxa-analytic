"use client";

import { useState } from "react";
import Dashboard from "./Dashboard";
import Sources from "./Sources";

export default function App() {
  const [tab, setTab] = useState<"dash" | "sources">("dash");
  return (
    <>
      <div className="tabbar">
        <div className="tabbar-inner">
          <button className={tab === "dash" ? "tab active" : "tab"} onClick={() => setTab("dash")}>
            Дашборд
          </button>
          <button className={tab === "sources" ? "tab active" : "tab"} onClick={() => setTab("sources")}>
            Источники
          </button>
        </div>
      </div>
      {tab === "dash" ? <Dashboard /> : <Sources />}
    </>
  );
}
