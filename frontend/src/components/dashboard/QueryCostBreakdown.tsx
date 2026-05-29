"use client";
import { SlowQuery } from "@/lib/api";

const CPU_COST_PER_MS = 0.00000002;

function calcCostPerDay(avgMs: number, calls: number) {
  return avgMs * calls * CPU_COST_PER_MS;
}
function fmtCost(usd: number) {
  if (usd < 0.001) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(1)}`;
}

interface Props {
  queries: SlowQuery[];
}

export default function QueryCostBreakdown({ queries }: Props) {
  const ranked = [...queries]
    .map((q) => ({ ...q, cost: calcCostPerDay(q.avg_exec_time_ms, q.calls) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  if (!ranked.length) return null;

  const maxCost = ranked[0].cost;

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1.25rem",
    }}>
      <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 1rem" }}>Top queries by cost</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ranked.map((q, i) => {
          const pct = maxCost > 0 ? (q.cost / maxCost) * 100 : 0;
          const isAnomaly = q.is_anomaly;
          const barColor = isAnomaly
            ? "var(--color-text-danger)"
            : q.cost > 10
            ? "var(--color-text-warning)"
            : "var(--color-text-info)";

          return (
            <div key={q.id}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-secondary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: "70%",
                }}>
                  #{i + 1} {q.query_text.slice(0, 50)}...
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, color: barColor, flexShrink: 0 }}>
                  {fmtCost(q.cost)}/day
                </span>
              </div>
              <div style={{
                height: 6, borderRadius: 3,
                background: "var(--color-background-secondary)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: barColor,
                  borderRadius: 3,
                  transition: "width 0.4s ease",
                }} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                  {q.avg_exec_time_ms.toFixed(0)}ms avg · {q.calls.toLocaleString()} calls
                </span>
                {isAnomaly && (
                  <span style={{ fontSize: 10, color: "var(--color-text-danger)" }}>⚠ anomaly</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
