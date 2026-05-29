"use client";
import { useEffect, useState } from "react";
import api from "@/lib/api";
import { CheckCircle, AlertTriangle, Loader } from "lucide-react";

interface HealthCheck {
  name: string;
  status: string;
  latency_ms?: number;
  workers?: number;
  error?: string;
}

interface HealthData {
  status: string;
  version: string;
  environment: string;
  ai_configured: boolean;
  slack_enabled: boolean;
  checks?: HealthCheck[];
}

export default function SystemHealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get("/health/deep", { timeout: 12000 })
      .then((r) => { setHealth(r.data); setError(false); })
      .catch(() => {
        // Fall back to simple health check
        api.get("/health", { timeout: 5000 })
          .then((r) => setHealth({ ...r.data, checks: [] }))
          .catch(() => setError(true));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "1rem", fontSize: 13, color: "var(--color-text-tertiary)", display: "flex", alignItems: "center", gap: 6 }}>
        <Loader size={12} />
        Checking system health...
      </div>
    );
  }

  if (!health) {
    return (
      <div style={{ padding: "1rem", fontSize: 13, color: error ? "var(--color-text-danger)" : "var(--color-text-secondary)" }}>
        {error ? "Could not reach backend — check that the server is running." : "Checking..."}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--color-background-secondary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1rem",
        marginTop: 8,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {health.checks?.map((check) => (
          <div
            key={check.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              background: "var(--color-background-primary)",
              borderRadius: "var(--border-radius-md)",
              fontSize: 12,
              border: `0.5px solid ${
                check.status === "ok"
                  ? "var(--color-border-success, #22c55e)"
                  : "var(--color-border-danger, #ef4444)"
              }`,
            }}
          >
            {check.status === "ok" ? (
              <CheckCircle size={11} color="var(--color-text-success, #22c55e)" />
            ) : (
              <AlertTriangle size={11} color="var(--color-text-danger, #ef4444)" />
            )}
            <span style={{ color: "var(--color-text-primary)" }}>{check.name}</span>
            {check.latency_ms !== undefined && (
              <span style={{ color: "var(--color-text-tertiary)" }}>{check.latency_ms}ms</span>
            )}
            {check.workers !== undefined && (
              <span style={{ color: "var(--color-text-tertiary)" }}>{check.workers} workers</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-text-tertiary)" }}>
        AI: {health.ai_configured ? "configured" : "not configured"} ·{" "}
        Slack: {health.slack_enabled ? "enabled" : "disabled"} ·{" "}
        {process.env.NEXT_PUBLIC_PROMETHEUS_URL && (
          <a
            href={process.env.NEXT_PUBLIC_PROMETHEUS_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--color-text-info, #3b82f6)", marginLeft: 4 }}
          >
            Prometheus →
          </a>
        )}
      </div>
    </div>
  );
}
