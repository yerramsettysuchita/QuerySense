"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Activity, Zap, Shield, GitBranch, ArrowRight, Database, TrendingDown, Clock } from "lucide-react";

const TICKER_QUERIES = [
  "SELECT u.name, COUNT(o.id) FROM users u LEFT JOIN orders o...",
  "SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days'",
  "SELECT p.name, SUM(oi.quantity) FROM products p JOIN order_items...",
  "SELECT DISTINCT u.id FROM users u JOIN orders o ON u.id = o.user_id...",
];

const STATS = [
  { value: "30s", label: "polling interval" },
  { value: "8+", label: "issue types detected" },
  { value: "3 DBs", label: "PostgreSQL · MySQL · shadow" },
  { value: "0", label: "production writes to analyze" },
];

const FEATURES = [
  {
    icon: <Activity size={18} />,
    title: "Live monitoring",
    desc: "Polls pg_stat_statements every 30 seconds. Slow queries surface automatically with no instrumentation needed.",
  },
  {
    icon: <Zap size={18} />,
    title: "EXPLAIN analysis",
    desc: "Parses execution plans. Detects seq scans, missing indexes, hash joins, stale stats, and N+1 patterns.",
  },
  {
    icon: <Database size={18} />,
    title: "Shadow DB testing",
    desc: "Benchmarks every recommendation on a real copy of your data before touching production.",
  },
  {
    icon: <TrendingDown size={18} />,
    title: "AI-powered fixes",
    desc: "Claude explains root cause in plain English. Generates CREATE INDEX CONCURRENTLY migration SQL.",
  },
  {
    icon: <Shield size={18} />,
    title: "Index health",
    desc: "Finds unused, bloated, and duplicate indexes wasting disk space and slowing down writes.",
  },
  {
    icon: <GitBranch size={18} />,
    title: "CI/CD integration",
    desc: "REST endpoint catches slow queries before they reach production. GitHub Actions snippet included.",
  },
];

export default function LandingPage() {
  const { user, logout } = useAuth();
  const [tickerIdx, setTickerIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setTickerIdx((i) => (i + 1) % TICKER_QUERIES.length);
        setVisible(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      {/* Landing header */}
      <header style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        background: "var(--color-background-primary)",
        backdropFilter: "blur(8px)",
      }}>
        <div style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "0 2rem",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginRight: 24 }}>
            <Database size={16} color="var(--color-text-success)" />
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em" }}>QuerySense</span>
          </div>

          {/* Anchor links */}
          <div style={{ display: "flex", gap: 2, flex: 1, alignItems: "center" }}>
            {[
              { href: "#features", label: "Features" },
              { href: "#how-it-works", label: "How it works" },
            ].map(({ href, label }) => (
              <a key={href} href={href} style={{
                padding: "5px 10px",
                borderRadius: "var(--border-radius-md)",
                fontSize: 13,
                textDecoration: "none",
                color: "var(--color-text-secondary)",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--color-text-primary)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--color-text-secondary)")}
              >
                {label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {user ? (
              <>
                <Link href="/dashboard" style={{
                  fontSize: 13,
                  padding: "6px 12px",
                  borderRadius: "var(--border-radius-md)",
                  textDecoration: "none",
                  color: "var(--color-text-secondary)",
                }}>
                  Dashboard
                </Link>
                <button
                  onClick={logout}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "6px 16px",
                    background: "none",
                    color: "var(--color-text-secondary)",
                    border: "0.5px solid var(--color-border-secondary)",
                    borderRadius: "var(--border-radius-md)",
                    cursor: "pointer", fontSize: 13,
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/login" style={{
                fontSize: 13,
                padding: "6px 12px",
                borderRadius: "var(--border-radius-md)",
                textDecoration: "none",
                color: "var(--color-text-secondary)",
              }}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

    <div style={{ maxWidth: 900, margin: "0 auto", padding: "4rem 2rem" }}>

      {/* Hero */}
      <div style={{
        textAlign: "center",
        marginBottom: "4rem",
        padding: "3rem 2rem 2.5rem",
        background: "linear-gradient(160deg, rgba(22,163,74,0.04) 0%, transparent 60%)",
        borderRadius: "var(--border-radius-xl)",
        border: "0.5px solid var(--color-border-tertiary)",
      }}>
        <h1 style={{
          fontSize: 48,
          fontWeight: 500,
          margin: "0 0 1rem",
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
        }}>
          Your database is slow.<br />
          <span style={{ color: "var(--color-text-secondary)" }}>QuerySense fixes it.</span>
        </h1>

        <p style={{
          fontSize: 18,
          color: "var(--color-text-secondary)",
          maxWidth: 560,
          margin: "0 auto 2rem",
          lineHeight: 1.6,
        }}>
          AI-powered query optimizer that detects slow queries, analyzes execution plans,
          benchmarks fixes on a shadow database, and generates safe migration SQL.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {user ? (
            <Link href="/dashboard" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "10px 22px",
              background: "var(--color-text-primary)",
              color: "var(--color-background-primary)",
              borderRadius: "var(--border-radius-md)",
              textDecoration: "none", fontSize: 14, fontWeight: 500,
            }}>
              Go to Dashboard <ArrowRight size={14} />
            </Link>
          ) : (
            <Link href="/login?mode=signup" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "10px 22px",
              background: "var(--color-text-primary)",
              color: "var(--color-background-primary)",
              borderRadius: "var(--border-radius-md)",
              textDecoration: "none", fontSize: 14, fontWeight: 500,
            }}>
              Get started free <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>

      {/* Live ticker */}
      <div style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1rem 1.25rem",
        marginBottom: "3rem",
        overflow: "hidden",
      }}>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8, letterSpacing: "0.05em" }}>
          EXAMPLE QUERY
        </div>
        <code style={{
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-secondary)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.3s",
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {TICKER_QUERIES[tickerIdx]}
        </code>
        <div style={{
          marginTop: 10,
          display: "flex",
          gap: 12,
          fontSize: 12,
        }}>
          <span style={{ color: "var(--color-text-danger)", fontWeight: 500 }}>2,840ms</span>
          <span style={{ color: "var(--color-text-tertiary)" }}>→</span>
          <span style={{ color: "var(--color-text-success)", fontWeight: 500 }}>180ms</span>
          <span style={{ color: "var(--color-text-tertiary)" }}>after index</span>
          <span style={{
            marginLeft: "auto",
            padding: "1px 8px",
            background: "var(--color-background-success)",
            color: "var(--color-text-success)",
            borderRadius: 10,
            fontSize: 11,
          }}>−94%</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        marginBottom: "3rem",
      }}>
        {STATS.map(({ value, label }) => (
          <div key={label} style={{
            padding: "1.5rem 1rem",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-lg)",
            boxShadow: "var(--shadow-sm)",
            textAlign: "center",
          }}>
            <div style={{
              fontSize: 30,
              fontWeight: 700,
              marginBottom: 4,
              letterSpacing: "-0.02em",
              color: "var(--color-text-primary)",
            }}>
              {value}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 500 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      <div id="features" style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 14,
        marginBottom: "3rem",
      }}>
        {FEATURES.map(({ icon, title, desc }) => (
          <div key={title} style={{
            padding: "1.5rem",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-lg)",
            boxShadow: "var(--shadow-sm)",
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: "var(--border-radius-md)",
              background: "var(--color-background-success)",
              border: "0.5px solid var(--color-border-success)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-text-success)",
              marginBottom: 14,
            }}>
              {icon}
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px", color: "var(--color-text-primary)" }}>
              {title}
            </p>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.65 }}>
              {desc}
            </p>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div id="how-it-works" style={{
        background: "var(--color-background-secondary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "2rem",
        marginBottom: "3rem",
        border: "0.5px solid var(--color-border-tertiary)",
        boxShadow: "var(--shadow-sm)",
      }}>
        <p style={{ fontSize: 11, fontWeight: 500, margin: "0 0 1.5rem", color: "var(--color-text-secondary)", letterSpacing: "0.05em" }}>
          HOW IT WORKS
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { step: "01", title: "Connect your database", detail: "Read-only access. pg_stat_statements enabled. No schema changes." },
            { step: "02", title: "Agent polls for slow queries", detail: "Every 30s, captures queries exceeding your SLA threshold." },
            { step: "03", title: "EXPLAIN plan analysis", detail: "Detects seq scans, missing indexes, stale stats, bad joins." },
            { step: "04", title: "AI generates recommendations", detail: "Claude explains the issue and ranks fixes by impact and risk." },
            { step: "05", title: "Shadow DB benchmark", detail: "Tests the fix on a real copy of your data. Shows actual before/after." },
            { step: "06", title: "One-click migration SQL", detail: "CONCURRENTLY-safe. Copy, deploy, done." },
          ].map(({ step, title, detail }, i, arr) => (
            <div key={step} style={{
              display: "flex",
              gap: 16,
              paddingBottom: i < arr.length - 1 ? "1.25rem" : 0,
              marginBottom: i < arr.length - 1 ? "1.25rem" : 0,
              borderBottom: i < arr.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none",
            }}>
              <div style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-tertiary)",
                flexShrink: 0,
                paddingTop: 2,
                width: 20,
              }}>{step}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ textAlign: "center" }}>
        <Link href={user ? "/dashboard" : "/login?mode=signup"} style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "12px 28px",
          background: "var(--color-text-primary)",
          color: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-md)",
          textDecoration: "none",
          fontSize: 15,
          fontWeight: 500,
        }}>
          {user ? "Go to Dashboard" : "Get started free"} <ArrowRight size={15} />
        </Link>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 12 }}>
          PostgreSQL · MySQL · Real-time · AI-powered
        </p>
      </div>
    </div>
    </div>
  );
}
