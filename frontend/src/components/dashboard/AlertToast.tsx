"use client";
import { useState, useRef } from "react";
import { useRealtimeAlerts, AlertEvent } from "@/hooks/useRealtimeAlerts";
import { AlertTriangle, Zap, CheckCircle, X } from "lucide-react";

type AlertWithId = AlertEvent & { id: number };

export default function AlertToast() {
  const [alerts, setAlerts] = useState<AlertWithId[]>([]);
  const counter = useRef(0);

  useRealtimeAlerts((event) => {
    const id = ++counter.current;
    setAlerts((prev) => [...prev.slice(-2), { ...event, id }]);
    setTimeout(() => {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    }, 6000);
  });

  const icon: Record<AlertEvent["type"], JSX.Element> = {
    anomaly_detected: <AlertTriangle size={14} color="var(--color-text-danger)" />,
    slow_query_found: <Zap size={14} color="var(--color-text-warning)" />,
    benchmark_complete: <CheckCircle size={14} color="var(--color-text-success)" />,
  };

  const bgColor: Record<AlertEvent["type"], string> = {
    anomaly_detected: "var(--color-background-danger)",
    slow_query_found: "var(--color-background-warning)",
    benchmark_complete: "var(--color-background-success)",
  };

  const borderColor: Record<AlertEvent["type"], string> = {
    anomaly_detected: "var(--color-border-danger)",
    slow_query_found: "var(--color-border-warning)",
    benchmark_complete: "var(--color-border-success)",
  };

  const label: Record<AlertEvent["type"], string> = {
    anomaly_detected: "Anomaly detected",
    slow_query_found: "Slow query found",
    benchmark_complete: "Benchmark complete",
  };

  if (!alerts.length) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      zIndex: 1000,
    }}>
      {alerts.map((alert) => (
        <div
          key={alert.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 14px",
            background: bgColor[alert.type],
            border: `0.5px solid ${borderColor[alert.type]}`,
            borderRadius: "var(--border-radius-lg)",
            minWidth: 280,
            maxWidth: 360,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ marginTop: 1, flexShrink: 0 }}>{icon[alert.type]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 2 }}>
              {label[alert.type]}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
              {alert.type === "anomaly_detected" && `Fingerprint: ${String(alert.payload.fingerprint ?? "")}`}
              {alert.type === "slow_query_found" && `${Number(alert.payload.avg_ms ?? 0).toFixed(0)}ms avg`}
              {alert.type === "benchmark_complete" && `${Number(alert.payload.improvement_pct ?? 0).toFixed(1)}% improvement`}
            </div>
          </div>
          <button
            onClick={() => setAlerts((prev) => prev.filter((a) => a.id !== alert.id))}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: 0, flexShrink: 0 }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
