"use client";

import { useState } from "react";

export default function LoginPage() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.href = next && next.startsWith("/") ? next : "/";
      } else {
        setErr(true);
        setBusy(false);
      }
    } catch {
      setErr(true);
      setBusy(false);
    }
  }

  const inp: React.CSSProperties = {
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--panel)",
    color: "var(--text)",
    fontSize: 15,
  };

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 340, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span className="brand-logo">СБ</span>
          <div>
            <div className="brand-name">Союз Бокса</div>
            <div className="brand-sub">Сквозная аналитика</div>
          </div>
        </div>
        <input style={inp} placeholder="Логин" value={user} onChange={(e) => setUser(e.target.value)} autoFocus autoComplete="username" />
        <input
          style={inp}
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {err && <div style={{ color: "var(--red)", fontSize: 13 }}>Неверный логин или пароль</div>}
        <button
          type="submit"
          disabled={busy}
          style={{ padding: "11px 16px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
        >
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
