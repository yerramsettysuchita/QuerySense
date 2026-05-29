"use client";
import { usePulse } from "@/hooks/usePulse";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw } from "lucide-react";

export default function PulseBar() {
  const { data, error } = usePulse(10000);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 20,
      padding: "8px 16px",
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-md)",
      fontSize: 12,
      color: "var(--color-text-secondary)",
      marginBottom: "1.5rem",
    }}>
      <RefreshCw size={12} style={{ flexShrink: 0 }} />

      {error ? (
        <span style={{ color: "var(--color-text-danger)" }}>Pulse unavailable</span>
      ) : !data ? (
        <span>Connecting...</span>
      ) : (
        <>
          <span>
            <strong style={{ color: "var(--color-text-primary)" }}>{data.stats.total}</strong> total queries tracked
          </span>
          <span>
            <strong style={{ color: "var(--color-text-danger)" }}>{data.stats.anomalies}</strong> anomalies
          </span>
          <span>
            <strong style={{ color: "var(--color-text-warning)" }}>{data.stats.avg_ms.toFixed(0)}ms</strong> avg
          </span>
          <span>
            Last updated {formatDistanceToNow(new Date(data.timestamp), { addSuffix: true })}
          </span>

          {data.recent.filter((r) => r.is_anomaly).slice(0, 2).map((r) => (
            <span key={r.id} style={{
              padding: "2px 8px",
              background: "var(--color-background-danger)",
              color: "var(--color-text-danger)",
              borderRadius: "var(--border-radius-md)",
              fontSize: 11,
            }}>
              {r.query_fingerprint} · {r.avg_exec_time_ms.toFixed(0)}ms
            </span>
          ))}
        </>
      )}
    </div>
  );
}
