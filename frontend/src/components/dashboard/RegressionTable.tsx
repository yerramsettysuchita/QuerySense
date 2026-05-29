"use client";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { RegressionQuery } from "@/lib/api";
import { TrendingUp, AlertTriangle, ChevronRight } from "lucide-react";

interface Props {
  regressions: RegressionQuery[];
}

export default function RegressionTable({ regressions }: Props) {
  const router = useRouter();

  if (!regressions.length) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
        No regressions detected in the last 24 hours.
        <br />
        <span style={{ fontSize: 11, marginTop: 4, display: "block" }}>
          Regressions appear when a query's recent avg exceeds its 7-day baseline by &gt;20%.
        </span>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
            {["Query", "Baseline", "Recent", "Regression", "Samples", "Last seen", ""].map((h) => (
              <th key={h} style={{
                textAlign: "left", padding: "8px 12px",
                color: "var(--color-text-secondary)", fontWeight: 400, fontSize: 12,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {regressions.map((r) => {
            const severity = r.regression_pct >= 100 ? "danger"
              : r.regression_pct >= 50 ? "warning"
              : "info";
            const severityColor = {
              danger:  "var(--color-text-danger)",
              warning: "var(--color-text-warning)",
              info:    "var(--color-text-info)",
            }[severity];

            return (
              <tr
                key={r.id}
                onClick={() => router.push(`/dashboard/query/${r.id}`)}
                style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {/* Query text */}
                <td style={{ padding: "10px 12px", maxWidth: 300 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {r.is_anomaly && <AlertTriangle size={13} color="var(--color-text-danger)" />}
                    <code style={{
                      fontSize: 11, fontFamily: "var(--font-mono)",
                      color: "var(--color-text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", display: "block", maxWidth: 260,
                    }}>
                      {r.query_text.slice(0, 70)}…
                    </code>
                  </div>
                </td>

                {/* Baseline */}
                <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                  {r.baseline_ms.toFixed(0)}ms
                </td>

                {/* Recent */}
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <span style={{ color: severityColor, fontWeight: 500 }}>
                    {r.recent_ms.toFixed(0)}ms
                  </span>
                </td>

                {/* Regression % badge */}
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <TrendingUp size={12} color={severityColor} />
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: severityColor,
                      background: severity === "danger" ? "var(--color-background-danger)"
                        : severity === "warning" ? "var(--color-background-warning)"
                        : "var(--color-background-info)",
                      border: `0.5px solid ${severity === "danger" ? "var(--color-border-danger)"
                        : severity === "warning" ? "var(--color-border-warning)"
                        : "var(--color-border-info)"}`,
                      borderRadius: "var(--border-radius-md)",
                      padding: "2px 7px",
                    }}>
                      +{r.regression_pct}%
                    </span>
                  </div>
                </td>

                {/* Sample counts */}
                <td style={{ padding: "10px 12px", color: "var(--color-text-tertiary)", fontSize: 11 }}>
                  {r.baseline_samples} base · {r.recent_samples} recent
                </td>

                {/* Last seen */}
                <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)", fontSize: 11 }}>
                  {formatDistanceToNow(new Date(r.last_seen), { addSuffix: true })}
                </td>

                <td style={{ padding: "10px 12px" }}>
                  <ChevronRight size={13} color="var(--color-text-tertiary)" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
