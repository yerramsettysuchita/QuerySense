import { useState } from "react";
import { PlanNode } from "@/lib/api";

const NODE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Seq Scan":       { bg: "var(--color-background-danger)",  text: "var(--color-text-danger)",  border: "var(--color-border-danger)" },
  "Hash Join":      { bg: "var(--color-background-warning)", text: "var(--color-text-warning)", border: "var(--color-border-warning)" },
  "Sort":           { bg: "var(--color-background-warning)", text: "var(--color-text-warning)", border: "var(--color-border-warning)" },
  "HashAggregate":  { bg: "var(--color-background-warning)", text: "var(--color-text-warning)", border: "var(--color-border-warning)" },
  "Index Scan":     { bg: "var(--color-background-success)", text: "var(--color-text-success)", border: "var(--color-border-success)" },
  "Index Only Scan":{ bg: "var(--color-background-success)", text: "var(--color-text-success)", border: "var(--color-border-success)" },
};
const DEFAULT_COLOR = { bg: "var(--color-background-secondary)", text: "var(--color-text-secondary)", border: "var(--color-border-tertiary)" };

const BAR_COLORS: Record<string, string> = {
  "Seq Scan":        "var(--color-text-danger)",
  "Hash Join":       "var(--color-text-warning)",
  "Sort":            "var(--color-text-warning)",
  "HashAggregate":   "#f59e0b",
  "Index Scan":      "var(--color-text-success)",
  "Index Only Scan": "var(--color-text-success)",
};

export default function PlanTree({ nodes }: { nodes: PlanNode[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!nodes.length) return null;

  const sorted = [...nodes].sort((a, b) => b.cost - a.cost);
  const maxCost = sorted[0].cost || 1;
  const totalCost = sorted.reduce((s, n) => s + n.cost, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {nodes.length} plan nodes · total cost {totalCost.toFixed(0)}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          width ∝ cost
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sorted.map((node, i) => {
          const colors = NODE_COLORS[node.type] ?? DEFAULT_COLOR;
          const barColor = BAR_COLORS[node.type] ?? "var(--color-text-info)";
          const pct = (node.cost / maxCost) * 100;
          const costShare = totalCost > 0 ? ((node.cost / totalCost) * 100).toFixed(0) : "0";
          const isHot = ["Seq Scan", "Hash Join", "Sort", "HashAggregate"].includes(node.type);
          const mismatch = node.rows_estimated > 0 && node.rows_actual > 0 &&
            Math.max(node.rows_estimated, node.rows_actual) /
            Math.min(node.rows_estimated, node.rows_actual) > 5;
          const isHovered = hoveredIdx === i;

          return (
            <div
              key={i}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                border: `0.5px solid ${isHovered ? colors.border : "var(--color-border-tertiary)"}`,
                borderRadius: "var(--border-radius-md)",
                overflow: "hidden",
                transition: "border-color 0.15s",
                cursor: "default",
              }}
            >
              {/* Flame bar */}
              <div style={{ position: "relative", height: 4, background: "var(--color-background-secondary)" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, height: "100%",
                  width: `${pct}%`,
                  background: barColor,
                  transition: "width 0.3s ease",
                }} />
              </div>

              {/* Node content */}
              <div style={{
                padding: "8px 12px",
                background: isHovered ? colors.bg : "transparent",
                transition: "background 0.15s",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{
                      fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 500,
                      color: isHot ? colors.text : "var(--color-text-primary)",
                    }}>
                      {node.type}
                    </code>
                    {node.table && (
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                        on {node.table}
                      </span>
                    )}
                    {isHot && (
                      <span style={{
                        fontSize: 10, padding: "1px 5px",
                        background: colors.bg, color: colors.text,
                        borderRadius: 4, border: `0.5px solid ${colors.border}`,
                      }}>
                        slow
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: barColor, fontWeight: 500 }}>
                      {costShare}% of cost
                    </span>
                    <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                      {node.cost.toFixed(0)}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  <span>est {node.rows_estimated.toLocaleString()} rows</span>
                  {node.rows_actual > 0 && (
                    <span style={{ color: mismatch ? "var(--color-text-warning)" : "inherit" }}>
                      actual {node.rows_actual.toLocaleString()}
                      {mismatch && " ⚠"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        {[
          { label: "Seq scan (slow)", color: "var(--color-text-danger)" },
          { label: "Hash / Sort", color: "var(--color-text-warning)" },
          { label: "Index scan (fast)", color: "var(--color-text-success)" },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
