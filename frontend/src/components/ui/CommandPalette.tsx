"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Database, GitBranch, Layers, Clock, Plus } from "lucide-react";

interface Action {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  icon: React.ReactNode;
  href: string;
}

const ACTIONS: Action[] = [
  { id: "overview",  label: "Overview",      hint: "Dashboard & query universe",   shortcut: "⌘1", icon: <Activity size={14} />,  href: "/dashboard" },
  { id: "analyze",   label: "Analyze query", hint: "EXPLAIN and optimize a query", shortcut: "⌘2", icon: <Database size={14} />,  href: "/dashboard/analyze" },
  { id: "indexes",   label: "Indexes",       hint: "Stale and bloated indexes",     shortcut: "⌘3", icon: <Layers size={14} />,    href: "/dashboard/indexes" },
  { id: "cicd",      label: "CI/CD",         hint: "Query gate for deployments",    shortcut: "⌘4", icon: <GitBranch size={14} />, href: "/dashboard/ci" },
  { id: "history",   label: "History",       hint: "Benchmark history & wins",      shortcut: "⌘5", icon: <Clock size={14} />,     href: "/dashboard/history" },
  { id: "add-db",    label: "Add database",  hint: "Connect a new database",        icon: <Plus size={14} />,    href: "/onboarding" },
];

export default function CommandPalette() {
  const [open, setOpen]         = useState(false);
  const [q, setQ]               = useState("");
  const [cursor, setCursor]     = useState(0);
  const inputRef                = useRef<HTMLInputElement>(null);
  const router                  = useRouter();

  const filtered = q.trim()
    ? ACTIONS.filter(a =>
        a.label.toLowerCase().includes(q.toLowerCase()) ||
        a.hint.toLowerCase().includes(q.toLowerCase())
      )
    : ACTIONS;

  const go = (href: string) => { router.push(href); setOpen(false); };

  // Open / close
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => { if (!v) { setQ(""); setCursor(0); } return !v; });
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Arrow navigation + enter (only when open)
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      if (e.key === "Enter" && filtered[cursor]) go(filtered[cursor].href);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, filtered, cursor]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "14vh",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520,
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          border: "0.5px solid var(--color-border-secondary)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
          overflow: "hidden",
          animation: "fadeIn 0.1s ease",
          margin: "0 1rem",
        }}
      >
        {/* Input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
        }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--color-text-tertiary)" }}>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={e => { setQ(e.target.value); setCursor(0); }}
            placeholder="Jump to page or run an action..."
            style={{
              flex: 1, border: "none", outline: "none",
              fontSize: 14, background: "transparent",
              color: "var(--color-text-primary)",
            }}
          />
          <kbd style={{
            fontSize: 11, color: "var(--color-text-tertiary)",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: 4, padding: "2px 6px",
            fontFamily: "var(--font-mono)",
          }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ padding: "6px 0", maxHeight: 340, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "1.5rem", textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>
              No results for &ldquo;{q}&rdquo;
            </div>
          ) : filtered.map((a, i) => (
            <button
              key={a.id}
              onClick={() => go(a.href)}
              onMouseEnter={() => setCursor(i)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "9px 16px", border: "none", cursor: "pointer", textAlign: "left",
                background: i === cursor ? "var(--color-background-secondary)" : "transparent",
                transition: "background 0.07s",
              }}
            >
              <span style={{ color: "var(--color-text-secondary)", flexShrink: 0 }}>{a.icon}</span>
              <span style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)" }}>{a.label}</span>
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{a.hint}</span>
              {a.shortcut && (
                <kbd style={{
                  fontSize: 11, color: "var(--color-text-tertiary)",
                  background: "var(--color-background-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)",
                  borderRadius: 4, padding: "2px 6px",
                  fontFamily: "var(--font-mono)", flexShrink: 0,
                }}>{a.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: "0.5px solid var(--color-border-tertiary)",
          padding: "7px 16px",
          display: "flex", gap: 14, fontSize: 11, color: "var(--color-text-tertiary)",
          alignItems: "center",
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
          <span style={{ marginLeft: "auto", opacity: 0.7 }}>⌘K anytime</span>
        </div>
      </div>
    </div>
  );
}
