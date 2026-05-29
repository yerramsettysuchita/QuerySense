"use client";
import { useEffect, useRef, useState } from "react";
import { wsClient } from "@/lib/ws";
import { formatDistanceToNow } from "date-fns";
import api from "@/lib/api";

interface FeedItem {
  id: number;
  type: "tool_call" | "conclusion" | "anomaly" | "query_found" | "benchmark";
  text: string;
  detail?: string;
  timestamp: number;
  severity: "info" | "warning" | "danger" | "success";
}

interface ToolCallPayload { tool?: string; slow_query_id?: string }
interface ConclusionPayload { content?: unknown }
interface AnomalyPayload { ms?: number; fingerprint?: string }
interface SlowQueryPayload { avg_ms?: number; query_preview?: unknown }
interface BenchmarkPayload { improvement_pct?: number; before_ms?: number; after_ms?: number }

let counter = 0;

const TOOL_LABELS: Record<string, string> = {
  run_explain_analysis: "Running EXPLAIN ANALYZE",
  get_table_stats: "Checking table statistics",
  check_column_selectivity: "Analyzing index selectivity",
  benchmark_on_shadow: "Benchmarking on shadow DB",
  apply_index: "Applying index to production",
  monitor_query_performance: "Verifying post-fix performance",
  save_agent_decision: "Recording decision",
};

const PREFIX: Record<FeedItem["type"], string> = {
  tool_call: "→",
  conclusion: "✓",
  anomaly: "⚠",
  query_found: "↓",
  benchmark: "⚡",
};

const DOT_COLOR: Record<FeedItem["severity"], string> = {
  info: "var(--color-text-info)",
  warning: "var(--color-text-warning)",
  danger: "var(--color-text-danger)",
  success: "var(--color-text-success)",
};

const DECISION_SEVERITY: Record<string, FeedItem["severity"]> = {
  fix_immediately: "success",
  investigate:     "warning",
  flag_for_review: "warning",
  skip:            "info",
};

export default function AgentActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const add = (item: Omit<FeedItem, "id" | "timestamp">, ts?: number) =>
    setItems((prev) => [...prev.slice(-49), { ...item, id: ++counter, timestamp: ts ?? Date.now() }]);

  // ── Load existing agent decisions; fall back to recent slow queries ──
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/api/v1/agent/history", { params: { limit: 20 } });
        const rows: any[] = r.data ?? [];
        if (rows.length > 0) {
          const seeded: FeedItem[] = [...rows].reverse().map((row) => ({
            id: ++counter,
            type: "conclusion" as FeedItem["type"],
            text: `Agent: ${row.decision?.replace(/_/g, " ") ?? "decision"}`,
            detail: row.outcome?.slice(0, 100) ?? row.reasoning?.slice(0, 100),
            timestamp: new Date(row.created_at).getTime(),
            severity: DECISION_SEVERITY[row.decision] ?? "info",
          }));
          setItems(seeded);
          return;
        }
      } catch {}

      // Fallback: seed with recent slow queries when no agent history
      try {
        const sq = await api.get("/api/v1/queries/slow", { params: { limit: 15 } });
        const queries: any[] = sq.data ?? [];
        if (queries.length > 0) {
          const fallback: FeedItem[] = [...queries].reverse().map((q) => ({
            id: ++counter,
            type: "query_found" as FeedItem["type"],
            text: `Slow query detected: ${Number(q.avg_exec_time_ms ?? 0).toFixed(0)}ms avg`,
            detail: (q.query_text ?? q.query_fingerprint ?? "").slice(0, 80),
            timestamp: new Date(q.detected_at ?? Date.now()).getTime(),
            severity: (q.is_anomaly ? "danger" : "warning") as FeedItem["severity"],
          }));
          setItems(fallback);
        }
      } catch {}
    })();
  }, []);

  // ── Live WebSocket events ──────────────────────────────────
  useEffect(() => {
    wsClient.connect("global");

    wsClient.on("agent_tool_call", (d) => {
      const p = d as ToolCallPayload;
      add({ type: "tool_call", text: TOOL_LABELS[p.tool ?? ""] ?? (p.tool ?? "unknown"), detail: p.slow_query_id, severity: "info" });
    });

    wsClient.on("agent_conclusion", (d) => {
      const p = d as ConclusionPayload;
      add({ type: "conclusion", text: "Agent concluded", detail: String(p.content ?? "").slice(0, 120), severity: "success" });
    });

    wsClient.on("anomaly_detected", (d) => {
      const p = d as AnomalyPayload;
      add({ type: "anomaly", text: `Anomaly detected: ${Number(p.ms ?? 0).toFixed(0)}ms`, detail: p.fingerprint, severity: "danger" });
    });

    wsClient.on("slow_query_found", (d) => {
      const p = d as SlowQueryPayload;
      add({ type: "query_found", text: `Slow query detected at ${Number(p.avg_ms ?? 0).toFixed(0)}ms avg`, detail: String(p.query_preview ?? "").slice(0, 80), severity: "warning" });
    });

    wsClient.on("benchmark_complete", (d) => {
      const p = d as BenchmarkPayload;
      add({ type: "benchmark", text: `Benchmark: ${Number(p.improvement_pct ?? 0).toFixed(1)}% improvement`, detail: `${Number(p.before_ms ?? 0).toFixed(0)}ms → ${Number(p.after_ms ?? 0).toFixed(0)}ms`, severity: "success" });
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  return (
    <div style={{
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-lg)",
      overflow: "hidden",
      height: 280,
      display: "flex",
      flexDirection: "column",
      border: "0.5px solid var(--color-border-tertiary)",
    }}>
      <div style={{
        padding: "10px 14px",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        background: "var(--color-background-primary)",
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--color-text-success)",
          animation: "pulse 2s ease-in-out infinite",
        }} />
        <span style={{ fontSize: 12, fontWeight: 500 }}>Agent activity</span>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>
          {items.length} events
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {items.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
            Waiting for agent activity...
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} style={{ padding: "5px 14px", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{
                color: DOT_COLOR[item.severity], flexShrink: 0,
                fontFamily: "var(--font-mono)", fontSize: 11, paddingTop: 1,
              }}>
                {PREFIX[item.type]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{item.text}</span>
                {item.detail && (
                  <div style={{
                    color: "var(--color-text-tertiary)", fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {item.detail}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", flexShrink: 0, paddingTop: 2 }}>
                {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
