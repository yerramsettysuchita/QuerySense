"use client";
import { BenchmarkResult } from "@/lib/api";
import { useState } from "react";
import { ChevronDown, ChevronUp, Play, CheckCheck, Loader } from "lucide-react";

interface Props {
  rec: any;
  benchmark?: BenchmarkResult;
  benchmarking: boolean;
  applying: boolean;
  onBenchmark: () => void;
  onApply: () => void;
}

export default function RecommendationCard({ rec, benchmark, benchmarking, applying, onBenchmark, onApply }: Props) {
  const [expanded, setExpanded] = useState(false);

  const riskColor = {
    low: "var(--color-text-success)",
    medium: "var(--color-text-warning)",
    high: "var(--color-text-danger)",
  }[rec.risk_level as string] ?? "var(--color-text-secondary)";

  const typeLabel = {
    index: "Index",
    rewrite: "Query rewrite",
    materialized_view: "Materialized view",
  }[rec.rec_type as string] ?? rec.rec_type;

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      marginBottom: 10,
      overflow: "hidden",
    }}>
      <div style={{ padding: "1rem 1.25rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 11,
                background: "var(--color-background-secondary)",
                color: "var(--color-text-secondary)",
                borderRadius: "var(--border-radius-md)",
                padding: "2px 8px",
              }}>{typeLabel}</span>
              <span style={{ fontSize: 11, color: riskColor }}>{rec.risk_level} risk</span>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{Math.round(rec.confidence * 100)}% confidence</span>
            </div>
            <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>{rec.title}</p>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>{rec.description}</p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 500, color: "var(--color-text-success)" }}>
              ~{Math.round(rec.estimated_improvement_pct)}%
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>estimated</div>
          </div>
        </div>

        {benchmark?.status === "complete" && (
          <div style={{
            marginTop: 12,
            background: "var(--color-background-success)",
            borderRadius: "var(--border-radius-md)",
            padding: "10px 14px",
            display: "flex",
            gap: 24,
          }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Before</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-danger)" }}>{benchmark.before_ms?.toFixed(0)}ms</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>After</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-success)" }}>{benchmark.after_ms?.toFixed(0)}ms</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Improvement</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-success)" }}>{benchmark.improvement_pct?.toFixed(1)}%</div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => setExpanded((p) => !p)}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 12, color: "var(--color-text-secondary)" }}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? "Hide SQL" : "View SQL"}
          </button>

          <button
            onClick={onBenchmark}
            disabled={benchmarking}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", cursor: benchmarking ? "not-allowed" : "pointer", fontSize: 12, color: "var(--color-text-primary)", opacity: benchmarking ? 0.6 : 1 }}
          >
            {benchmarking ? <Loader size={12} /> : <Play size={12} />}
            {benchmarking ? "Testing..." : "Test on shadow DB"}
          </button>

          <button
            onClick={onApply}
            disabled={applying}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "var(--color-background-info)", border: "0.5px solid var(--color-border-info)", borderRadius: "var(--border-radius-md)", cursor: applying ? "not-allowed" : "pointer", fontSize: 12, color: "var(--color-text-info)", opacity: applying ? 0.6 : 1 }}
          >
            {applying ? <Loader size={12} /> : <CheckCheck size={12} />}
            {applying ? "Applying..." : "Apply + copy SQL"}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", padding: "1rem 1.25rem", background: "var(--color-background-secondary)" }}>
          <pre style={{ margin: 0, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {rec.sql_fix}
          </pre>
        </div>
      )}
    </div>
  );
}
