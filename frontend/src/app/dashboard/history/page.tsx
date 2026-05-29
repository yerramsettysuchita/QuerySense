"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBenchmarkHistory, BenchmarkHistory } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { TrendingDown, Clock, BarChart2, Search, SortAsc, SortDesc, Zap } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonMetricCards, SkeletonRow } from "@/components/ui/Skeleton";

type SortKey = "improvement_pct" | "before_ms" | "tested_at";
type SortDir = "asc" | "desc";

export default function HistoryPage() {
  const { data: history = [], isLoading: loading } = useQuery({
    queryKey: ["benchmark-history-full"],
    queryFn: () => getBenchmarkHistory(100),
    staleTime: 60_000,
  });
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("tested_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const recTypes = useMemo(() => {
    const types = [...new Set(history.map((h) => h.rec_type).filter(Boolean))];
    return ["all", ...types];
  }, [history]);

  const filtered = useMemo(() => {
    let rows = history;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.title?.toLowerCase().includes(q) ||
        r.query_text?.toLowerCase().includes(q) ||
        r.rec_type?.toLowerCase().includes(q)
      );
    }
    if (filterType !== "all") {
      rows = rows.filter((r) => r.rec_type === filterType);
    }
    return [...rows].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [history, search, filterType, sortKey, sortDir]);

  const totalSaved = history.reduce((s, h) => s + (h.before_ms - h.after_ms), 0);
  const avgImprovement = history.length
    ? Math.round(history.reduce((s, h) => s + h.improvement_pct, 0) / history.length)
    : 0;
  const bestWin = history.length ? Math.max(...history.map((h) => h.improvement_pct)) : 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null : sortDir === "asc"
      ? <SortAsc size={11} style={{ marginLeft: 3 }} />
      : <SortDesc size={11} style={{ marginLeft: 3 }} />;

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>Optimization history</h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: "0 0 1.5rem" }}>
        Every benchmark run, tracked. See what was fixed and how much was gained.
      </p>

      {/* Stats */}
      {loading ? (
        <div style={{ marginBottom: "2rem" }}><SkeletonMetricCards count={4} /></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: "2rem" }}>
          {[
            { icon: <BarChart2 size={15} />, label: "Benchmarks run", value: history.length },
            { icon: <TrendingDown size={15} />, label: "Avg improvement", value: `${avgImprovement}%` },
            { icon: <Clock size={15} />, label: "Total ms saved", value: `${Math.round(totalSaved).toLocaleString()}ms` },
            { icon: <TrendingDown size={15} />, label: "Best single win", value: `${Math.round(bestWin)}%` },
          ].map(({ icon, label, value }) => (
            <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>{icon}{label}</div>
              <div style={{ fontSize: 24, fontWeight: 500 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={13} style={{
            position: "absolute", left: 10, top: "50%",
            transform: "translateY(-50%)", color: "var(--color-text-tertiary)",
            pointerEvents: "none",
          }} />
          <input
            type="text"
            placeholder="Search by title or query…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 30 }}
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ width: "auto", minWidth: 120 }}
        >
          {recTypes.map((t) => (
            <option key={t} value={t}>{t === "all" ? "All types" : t}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "0 1rem" }}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Zap size={20} />}
          title={history.length === 0 ? "No benchmarks run yet" : "No results match your search"}
          description={
            history.length === 0
              ? "Open a slow query from the dashboard and click \"Test on shadow DB\" to run your first benchmark."
              : "Try a different search term or clear the type filter."
          }
          actions={
            history.length === 0
              ? [{ label: "View dashboard", href: "/dashboard" }]
              : [{ label: "Clear search", onClick: () => { setSearch(""); setFilterType("all"); }, variant: "secondary" }]
          }
        />
      ) : (
        <div style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                {[
                  { label: "Recommendation", key: null },
                  { label: "Type", key: null },
                  { label: "Before", key: "before_ms" as SortKey },
                  { label: "After", key: null },
                  { label: "Improvement", key: "improvement_pct" as SortKey },
                  { label: "Iterations", key: null },
                  { label: "Tested", key: "tested_at" as SortKey },
                ].map(({ label, key }) => (
                  <th
                    key={label}
                    onClick={key ? () => toggleSort(key) : undefined}
                    style={{
                      padding: "10px 14px",
                      textAlign: "left",
                      fontWeight: 400,
                      color: "var(--color-text-secondary)",
                      fontSize: 12,
                      cursor: key ? "pointer" : "default",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center" }}>
                      {label}
                      {key && <SortIcon k={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr
                  key={row.id}
                  style={{ borderBottom: i < filtered.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}
                >
                  <td style={{ padding: "10px 14px", maxWidth: 240 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)" }}>
                      {row.title}
                    </div>
                    {row.query_text && (
                      <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                        {row.query_text.slice(0, 55)}…
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" }}>
                      {row.rec_type}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--color-text-danger)", fontWeight: 500 }}>
                    {row.before_ms.toFixed(0)}ms
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--color-text-success)", fontWeight: 500 }}>
                    {row.after_ms.toFixed(0)}ms
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ height: 4, width: 72, background: "var(--color-border-tertiary)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.min(row.improvement_pct, 100)}%`,
                          background: row.improvement_pct > 70 ? "var(--color-text-success)" : row.improvement_pct > 40 ? "var(--color-text-warning)" : "var(--color-text-danger)",
                          borderRadius: 2,
                          transition: "width 0.4s ease",
                        }} />
                      </div>
                      <span style={{
                        fontSize: 13, fontWeight: 500,
                        color: row.improvement_pct > 70 ? "var(--color-text-success)" : row.improvement_pct > 40 ? "var(--color-text-warning)" : "var(--color-text-danger)",
                      }}>
                        {row.improvement_pct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)" }}>{row.iterations}×</td>
                  <td style={{ padding: "10px 14px", color: "var(--color-text-tertiary)", fontSize: 12 }}>
                    {formatDistanceToNow(new Date(row.tested_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
