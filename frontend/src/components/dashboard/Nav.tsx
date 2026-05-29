"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Database, GitBranch, Layers, Clock, LogOut, User, Plus, Settings } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ConnectionHealthBar from "@/components/dashboard/ConnectionHealthBar";
import { useQuery } from "@tanstack/react-query";
import { getQueryStats } from "@/lib/api";

const links = [
  { href: "/dashboard",         label: "Overview", icon: <Activity size={14} /> },
  { href: "/dashboard/analyze", label: "Analyze",  icon: <Database size={14} /> },
  { href: "/dashboard/indexes", label: "Indexes",  icon: <Layers size={14} /> },
  { href: "/dashboard/ci",      label: "CI/CD",    icon: <GitBranch size={14} /> },
  { href: "/dashboard/history", label: "History",  icon: <Clock size={14} /> },
];

export default function Nav() {
  const path = usePathname();
  const { user, logout } = useAuth();

  const isAuthPage = path === "/login" || path === "/onboarding" || path === "/";

  const { data: navStats } = useQuery({
    queryKey: ["nav-stats"],
    queryFn: getQueryStats,
    staleTime: 30_000,
    enabled: !isAuthPage && !!user,
  });

  const anomalyCount = navStats?.queries.total_anomalies ?? 0;

  if (isAuthPage) return null;

  return (
    <nav style={{
      height: 54,
      borderBottom: "1px solid var(--color-border-tertiary)",
      display: "flex",
      alignItems: "center",
      padding: "0 1.75rem",
      gap: 2,
      background: "var(--color-background-secondary)",
      boxShadow: "var(--shadow-xs)",
      flexShrink: 0,
      position: "sticky",
      top: 0,
      zIndex: 40,
    }}>
      {/* Brand */}
      <Link href="/" style={{
        fontSize: 15,
        fontWeight: 600,
        color: "var(--color-text-primary)",
        textDecoration: "none",
        marginRight: 20,
        flexShrink: 0,
        letterSpacing: "-0.02em",
        display: "flex",
        alignItems: "center",
        gap: 7,
      }}>
        <div style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          background: "var(--color-text-success)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Database size={12} color="#fff" />
        </div>
        QuerySense
      </Link>

      {/* Nav links */}
      <div style={{ display: "flex", gap: 1, flex: 1, alignItems: "center" }}>
        {links.map((l) => {
          const active = l.href === "/dashboard" ? path === "/dashboard" : path.startsWith(l.href);
          const showBadge = l.href === "/dashboard" && anomalyCount > 0;
          return (
            <Link key={l.href} href={l.href} style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 11px",
              borderRadius: "var(--border-radius-md)",
              fontSize: 13,
              fontWeight: active ? 500 : 400,
              textDecoration: "none",
              color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              background: active ? "var(--color-background-primary)" : "transparent",
              border: active ? "0.5px solid var(--color-border-tertiary)" : "0.5px solid transparent",
              transition: "background 0.15s, color 0.15s",
              whiteSpace: "nowrap",
            }}>
              {l.icon}
              <span>{l.label}</span>
              {showBadge && (
                <span style={{
                  fontSize: 10, fontWeight: 600, lineHeight: "16px",
                  minWidth: 16, height: 16, padding: "0 4px",
                  background: "var(--color-text-danger)",
                  color: "#fff",
                  borderRadius: 8,
                  textAlign: "center",
                }}>
                  {anomalyCount > 9 ? "9+" : anomalyCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Right side */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <ConnectionHealthBar />

        <kbd
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
          style={{
            fontSize: 11, color: "var(--color-text-tertiary)",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: 5, padding: "3px 7px",
            fontFamily: "var(--font-mono)", cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          title="Open command palette"
        >⌘K</kbd>

        <Link href="/settings" style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          borderRadius: "var(--border-radius-md)",
          color: path === "/settings" ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          background: path === "/settings" ? "var(--color-background-primary)" : "transparent",
          textDecoration: "none",
          transition: "background 0.15s, color 0.15s",
        }}>
          <Settings size={14} />
        </Link>

        <Link href="/onboarding" style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "5px 12px",
          background: "var(--color-background-success)",
          border: "0.5px solid var(--color-border-success)",
          borderRadius: "var(--border-radius-md)",
          fontSize: 12,
          fontWeight: 500,
          color: "var(--color-text-success)",
          textDecoration: "none",
        }}>
          <Plus size={12} /> Add DB
        </Link>

        {user && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "var(--color-background-info)",
                border: "0.5px solid var(--color-border-info)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-text-info)",
                flexShrink: 0,
              }}>
                {user.name?.[0]?.toUpperCase() ?? <User size={12} />}
              </div>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 500 }}>
                {user.name?.split(" ")[0]}
              </span>
            </div>
            <button
              onClick={logout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                background: "none",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-md)",
                cursor: "pointer",
                color: "var(--color-text-secondary)",
                fontSize: 12,
              }}
            >
              <LogOut size={12} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
