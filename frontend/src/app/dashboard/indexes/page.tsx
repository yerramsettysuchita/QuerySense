"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStaleIndexReport, getBloatedIndexes, StaleIndexReport } from "@/lib/api";
import { Trash2, Copy, AlertTriangle } from "lucide-react";

type Tab = "unused" | "bloated" | "duplicate";

export default function IndexesPage() {
  const { data: report = null, isLoading: rLoading } = useQuery({
    queryKey: ["stale-index-report"],
    queryFn: getStaleIndexReport,
    staleTime: 5 * 60_000,
  });
  const { data: bloated = [], isLoading: bLoading } = useQuery({
    queryKey: ["bloated-indexes"],
    queryFn: getBloatedIndexes,
    staleTime: 5 * 60_000,
  });
  const loading = rLoading || bLoading;
  const [tab, setTab] = useState<Tab>("unused");
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (sql: string, key: string) => {
    navigator.clipboard.writeText(sql);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "unused", label: "Unused", count: report?.summary.total_unused ?? 0 },
    { key: "bloated", label: "Bloated", count: report?.summary.total_bloated ?? 0 },
    { key: "duplicate", label: "Duplicate", count: report?.summary.total_duplicate ?? 0 },
  ];

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>Index health</h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: "0 0 1.5rem" }}>
        Unused, bloated, and duplicate indexes waste disk space and slow down writes.
      </p>

      {report && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: "2rem" }}>
          {[
            { label: "Unused indexes", value: report.summary.total_unused, color: "var(--color-text-danger)" },
            { label: "Bloated indexes", value: report.summary.total_bloated, color: "var(--color-text-warning)" },
            { label: "Duplicate indexes", value: report.summary.total_duplicate, color: "var(--color-text-warning)" },
            { label: "Space wasted", value: `${report.summary.wasted_mb} MB`, color: "var(--color-text-secondary)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "1rem" }}>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 500, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem", borderBottom: "2px solid var(--color-border-tertiary)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 18px",
              background: tab === t.key ? "var(--color-background-secondary)" : "none",
              border: "none",
              borderBottom: tab === t.key ? "2px solid var(--color-text-primary)" : "2px solid transparent",
              borderRadius: "var(--border-radius-md) var(--border-radius-md) 0 0",
              cursor: "pointer",
              fontSize: 13,
              color: tab === t.key ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
              fontWeight: tab === t.key ? 600 : 400,
              marginBottom: -2,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "color 0.15s, background 0.15s",
            }}
          >
            {t.label}
            <span style={{
              fontSize: 11,
              background: t.count > 0 ? "var(--color-background-danger)" : "var(--color-background-secondary)",
              color: t.count > 0 ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
              borderRadius: 10,
              padding: "1px 6px",
              minWidth: 18,
              textAlign: "center",
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>Loading...</p>
      ) : (
        <>
          {tab === "unused" && (
            <IndexTable
              rows={report?.postgres.stale ?? []}
              emptyMsg="No unused indexes found. Your index configuration looks clean."
              onCopy={(row: any) => copy(`DROP INDEX CONCURRENTLY ${row.schema}.${row.index};`, row.index)}
              copied={copied}
            />
          )}
          {tab === "bloated" && (
            <IndexTable
              rows={bloated}
              emptyMsg="No bloated indexes found."
              onCopy={(row: any) => copy(`DROP INDEX CONCURRENTLY ${row.schema}.${row.index};`, row.index)}
              copied={copied}
            />
          )}
          {tab === "duplicate" && (
            <DuplicateTable
              rows={report?.postgres.duplicate ?? []}
              onCopy={(row: any) => copy(`DROP INDEX CONCURRENTLY ${row.index_b};`, row.index_b)}
              copied={copied}
            />
          )}
        </>
      )}

      <div style={{
        marginTop: "2rem",
        padding: "12px 16px",
        background: "var(--color-background-warning)",
        border: "0.5px solid var(--color-border-warning)",
        borderRadius: "var(--border-radius-md)",
        fontSize: 13,
        color: "var(--color-text-warning)",
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}>
        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        Always verify an index is truly unused before dropping. CONCURRENTLY avoids table locks but requires PostgreSQL 9.2+. Run during low-traffic periods.
      </div>
    </div>
  );
}

function IndexTable({ rows, emptyMsg, onCopy, copied }: any) {
  if (!rows.length) return <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>{emptyMsg}</p>;

  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
            {["Index name", "Table", "Size", "Scans", "Action"].map((h) => (
              <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 400, color: "var(--color-text-secondary)", fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, i: number) => (
            <tr key={i} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <td style={{ padding: "10px 14px" }}>
                <code style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>{row.index}</code>
              </td>
              <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)" }}>{row.table}</td>
              <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)" }}>{row.index_size}</td>
              <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)" }}>{row.scans}</td>
              <td style={{ padding: "10px 14px" }}>
                <button
                  onClick={() => onCopy(row)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 10px",
                    background: "none",
                    border: "0.5px solid var(--color-border-secondary)",
                    borderRadius: "var(--border-radius-md)",
                    cursor: "pointer",
                    fontSize: 11,
                    color: copied === row.index ? "var(--color-text-success)" : "var(--color-text-secondary)",
                  }}
                >
                  {copied === row.index ? "Copied!" : <><Copy size={11} /> Copy DROP SQL</>}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicateTable({ rows, onCopy, copied }: any) {
  if (!rows.length) return <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>No duplicate indexes found.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row: any, i: number) => (
        <div key={i} style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1rem 1.25rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Table: </span>
              <code style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{row.table}</code>
            </div>
            <button
              onClick={() => onCopy(row)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                background: "none",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-md)",
                cursor: "pointer",
                fontSize: 11,
                color: copied === row.index_b ? "var(--color-text-success)" : "var(--color-text-secondary)",
              }}
            >
              {copied === row.index_b ? "Copied!" : <><Trash2 size={11} /> Drop redundant</>}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[{ label: "Keep", def: row.def_a }, { label: "Drop", def: row.def_b }].map(({ label, def }) => (
              <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "8px 10px" }}>
                <div style={{ fontSize: 11, color: label === "Drop" ? "var(--color-text-danger)" : "var(--color-text-success)", marginBottom: 4, fontWeight: 500 }}>{label}</div>
                <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{def}</code>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
