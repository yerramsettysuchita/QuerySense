"use client";
import { useRouter } from "next/navigation";
import { RegressionQuery } from "@/lib/api";
import { TrendingUp, AlertTriangle, ChevronRight } from "lucide-react";

interface Props {
  regressions: RegressionQuery[];
}

export default function RegressionBanner({ regressions }: Props) {
  const router = useRouter();

  if (!regressions.length) return null;

  const worst = regressions[0];
  const extra = regressions.length - 1;

  return (
    <div style={{
      background: "var(--color-background-danger)",
      border: "0.5px solid var(--color-border-danger)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1rem 1.25rem",
      marginBottom: "1.5rem",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <TrendingUp size={15} color="var(--color-text-danger)" />
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-danger)" }}>
          {regressions.length} performance regression{regressions.length !== 1 ? "s" : ""} detected
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 4 }}>
          (last 24h vs 7-day baseline)
        </span>
      </div>

      {/* Regression rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {regressions.slice(0, 3).map((r) => (
          <div
            key={r.id}
            onClick={() => router.push(`/dashboard/query/${r.id}`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              background: "rgba(0,0,0,0.06)",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.12)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.06)")}
          >
            {r.is_anomaly && <AlertTriangle size={13} color="var(--color-text-danger)" style={{ flexShrink: 0 }} />}

            <code style={{
              fontSize: 11, fontFamily: "var(--font-mono)",
              color: "var(--color-text-primary)",
              flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {r.query_text.slice(0, 70)}…
            </code>

            {/* Before → After */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                {r.baseline_ms.toFixed(0)}ms
              </span>
              <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>→</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-danger)" }}>
                {r.recent_ms.toFixed(0)}ms
              </span>
            </div>

            {/* Regression badge */}
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: "var(--color-text-danger)",
              background: "var(--color-background-primary)",
              border: "0.5px solid var(--color-border-danger)",
              borderRadius: "var(--border-radius-md)",
              padding: "2px 7px",
              flexShrink: 0,
            }}>
              +{r.regression_pct}%
            </span>

            <ChevronRight size={13} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />
          </div>
        ))}
      </div>

      {extra > 0 && (
        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "8px 0 0" }}>
          +{extra} more regression{extra !== 1 ? "s" : ""}. Check the Regressions tab below.
        </p>
      )}
    </div>
  );
}
