"use client";
import { useState } from "react";
import { SlowQuery } from "@/lib/api";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ChevronRight, ChevronUp, ChevronDown, Search, TrendingUp } from "lucide-react";

// AWS RDS db.t3.medium ≈ $0.068/hr → ~$0.00000002/ms of CPU time
const CPU_COST_PER_MS = 0.00000002;

function calcCostPerDay(avgMs: number, calls: number): number {
  return avgMs * calls * CPU_COST_PER_MS;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.01";
  if (usd < 1)    return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

type SortKey = "avg_exec_time_ms" | "calls" | "cost" | "detected_at";
type SortDir = "asc" | "desc";

interface Props {
  queries: SlowQuery[];
  onRefresh: () => void;
  regressionIds?: Set<string>;
}

export default function SlowQueryTable({ queries, onRefresh: _onRefresh, regressionIds }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [dbFilter, setDbFilter] = useState<"all" | "postgresql" | "mysql">("all");
  const [sortKey, setSortKey] = useState<SortKey>("avg_exec_time_ms");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  if (!queries.length) {
    return (
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, padding: "1rem 0" }}>
        No slow queries detected. Your database looks healthy.
      </p>
    );
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = queries
    .filter((q) => !onlyAnomalies || q.is_anomaly)
    .filter((q) => dbFilter === "all" || q.db_type === dbFilter)
    .filter((q) => !search || q.query_text.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "cost") {
        av = calcCostPerDay(a.avg_exec_time_ms, a.calls);
        bv = calcCostPerDay(b.avg_exec_time_ms, b.calls);
      } else if (sortKey === "detected_at") {
        av = new Date(a.detected_at).getTime();
        bv = new Date(b.detected_at).getTime();
      } else {
        av = a[sortKey];
        bv = b[sortKey];
      }
      return sortDir === "desc" ? bv - av : av - bv;
    });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={11} style={{ opacity: 0.3 }} />;
    return sortDir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />;
  }

  const hasDBTypes = new Set(queries.map((q) => q.db_type)).size > 1;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 160 }}>
          <Search size={13} style={{
            position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)",
            color: "var(--color-text-tertiary)", pointerEvents: "none",
          }} />
          <input
            type="text"
            placeholder="Search queries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
              fontSize: 12,
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "var(--border-radius-md)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        </div>

        <button
          onClick={() => setOnlyAnomalies((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "6px 10px",
            fontSize: 12, cursor: "pointer", borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-tertiary)",
            background: onlyAnomalies ? "var(--color-background-danger)" : "var(--color-background-secondary)",
            color: onlyAnomalies ? "var(--color-text-danger)" : "var(--color-text-secondary)",
          }}
        >
          <AlertTriangle size={12} />
          Anomalies only
        </button>

        {hasDBTypes && (
          <select
            value={dbFilter}
            onChange={(e) => setDbFilter(e.target.value as typeof dbFilter)}
            style={{
              padding: "6px 8px", fontSize: 12, cursor: "pointer",
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "var(--border-radius-md)",
              color: "var(--color-text-secondary)",
            }}
          >
            <option value="all">All DBs</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </select>
        )}

        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>
          {filtered.length} of {queries.length}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-secondary)", fontWeight: 400 }}>Query</th>
              {(["avg_exec_time_ms", "calls", "cost", "detected_at"] as SortKey[]).map((col) => {
                const labels: Record<SortKey, string> = {
                  avg_exec_time_ms: "Avg time",
                  calls: "Calls",
                  cost: "Cost/day",
                  detected_at: "Detected",
                };
                return (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    style={{
                      textAlign: "left", padding: "8px 12px",
                      color: sortKey === col ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                      fontWeight: sortKey === col ? 500 : 400,
                      cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {labels[col]} <SortIcon col={col} />
                    </span>
                  </th>
                );
              })}
              <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-secondary)", fontWeight: 400 }}>DB</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
                  No queries match the current filters.
                </td>
              </tr>
            ) : filtered.map((q) => {
              const cost = calcCostPerDay(q.avg_exec_time_ms, q.calls);
              return (
                <tr
                  key={q.id}
                  onClick={() => router.push(`/dashboard/query/${q.id}`)}
                  style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background-secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "10px 12px", maxWidth: 320 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {q.is_anomaly && <AlertTriangle size={14} color="var(--color-text-danger)" />}
                  {regressionIds?.has(q.id) && (
                    <TrendingUp size={13} color="var(--color-text-warning)" />
                  )}
                      <code style={{
                        fontSize: 12, fontFamily: "var(--font-mono)",
                        color: "var(--color-text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap", display: "block", maxWidth: 280,
                      }}>
                        {q.query_text.slice(0, 80)}...
                      </code>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{
                      color: q.avg_exec_time_ms > 2000 ? "var(--color-text-danger)"
                        : q.avg_exec_time_ms > 800 ? "var(--color-text-warning)"
                        : "var(--color-text-success)",
                      fontWeight: 500,
                    }}>
                      {q.avg_exec_time_ms.toFixed(0)}ms
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)" }}>{q.calls.toLocaleString()}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{
                      color: cost > 10 ? "var(--color-text-danger)"
                        : cost > 1 ? "var(--color-text-warning)"
                        : "var(--color-text-secondary)",
                      fontWeight: cost > 1 ? 500 : 400,
                      fontSize: 12,
                    }}>
                      {formatCost(cost)}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)" }}>
                    {formatDistanceToNow(new Date(q.detected_at), { addSuffix: true })}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{
                      background: q.db_type === "mysql" ? "var(--color-background-warning)" : "var(--color-background-info)",
                      color: q.db_type === "mysql" ? "var(--color-text-warning)" : "var(--color-text-info)",
                      borderRadius: "var(--border-radius-md)",
                      padding: "2px 8px", fontSize: 11,
                    }}>
                      {q.db_type}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <ChevronRight size={14} color="var(--color-text-tertiary)" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
