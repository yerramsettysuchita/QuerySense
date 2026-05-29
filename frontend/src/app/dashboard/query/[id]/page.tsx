"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getQueryDetail, analyzeQuery, runBenchmark, pollBenchmarkResult, applyRecommendation, resolveQuery, AnalyzeResult, BenchmarkResult } from "@/lib/api";
import api from "@/lib/api";
import RecommendationCard from "@/components/query/RecommendationCard";
import PlanTree from "@/components/query/PlanTree";
import IssueList from "@/components/query/IssueList";
import AgentTrace from "@/components/agent/AgentTrace";
import QueryHistoryChart from "@/components/charts/QueryHistoryChart";
import { toast } from "@/components/ui/Toast";
import { ArrowLeft, CheckCircle, Brain, Copy } from "lucide-react";

export default function QueryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<any>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [benchmarks, setBenchmarks] = useState<Record<string, BenchmarkResult>>({});
  const [benchmarking, setBenchmarking] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
  const [migrationSQL, setMigrationSQL] = useState<string | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);

  useEffect(() => {
    getQueryDetail(id).then((d) => {
      setDetail(d);
      setLoading(false);
      return analyzeQuery(d.query_text, id);
    }).then(setAnalysis);
  }, [id]);

  const handleBenchmark = (rec: any) => {
    setBenchmarking((p) => ({ ...p, [rec.id]: true }));
    const tables = analysis?.plan_nodes.map((n) => n.table).filter(Boolean) as string[] ?? [];

    runBenchmark({
      query: detail.query_text,
      recommendation_id: rec.id,
      recommendation_sql: rec.sql_fix,
      rec_type: rec.rec_type,
      tables_involved: [...new Set(tables)],
    }).then(() => {
      const cleanup = pollBenchmarkResult(rec.id, (result) => {
        setBenchmarks((p) => ({ ...p, [rec.id]: result }));
        setBenchmarking((p) => ({ ...p, [rec.id]: false }));
        cleanup();
      });
    });
  };

  const handleApply = async (recId: string) => {
    setApplying(recId);
    try {
      const result = await applyRecommendation(recId);
      setMigrationSQL(result.migration_sql ?? null);
      setShowMigrationModal(true);
      toast({ type: "success", title: "Recommendation applied", message: result.note });
    } catch {
      toast({ type: "error", title: "Apply failed", message: "Could not apply recommendation" });
    } finally {
      setApplying(null);
      router.refresh();
    }
  };

  const handleResolve = async () => {
    await resolveQuery(id);
    router.push("/dashboard");
  };

  const handleRunAgent = async () => {
    setAgentRunning(true);
    try {
      await api.post("/api/v1/agent/run", {
        query: detail.query_text,
        slow_query_id: id,
        auto_apply: false,
      });
    } catch {
      setAgentRunning(false);
      toast({ type: "error", title: "Failed to start agent", message: "Check your connection and try again" });
    }
  };

  if (loading) {
    return <div style={{ padding: "2rem", color: "var(--color-text-secondary)" }}>Loading...</div>;
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem" }}>
        <button
          onClick={() => router.push("/dashboard")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", padding: 0, display: "flex" }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Query analysis</h1>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "2px 0 0", fontFamily: "var(--font-mono)" }}>
            {detail?.query_fingerprint}
          </p>
        </div>
        <button
          onClick={handleRunAgent}
          disabled={agentRunning}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "var(--color-background-info)",
            color: "var(--color-text-info)",
            border: "0.5px solid var(--color-border-info)",
            borderRadius: "var(--border-radius-md)",
            cursor: agentRunning ? "not-allowed" : "pointer",
            fontSize: 13,
            opacity: agentRunning ? 0.7 : 1,
          }}
        >
          <Brain size={14} />
          {agentRunning ? "Agent running..." : "Run agent"}
        </button>
        <button
          onClick={handleResolve}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "var(--color-background-success)", color: "var(--color-text-success)", border: "0.5px solid var(--color-border-success)", borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 13 }}
        >
          <CheckCircle size={14} /> Mark resolved
        </button>
      </div>

      <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 8px" }}>
          Query · avg {detail?.avg_exec_time_ms?.toFixed(0)}ms · {detail?.calls?.toLocaleString()} calls
        </p>
        <code style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {detail?.query_text}
        </code>
      </div>

      {analysis?.ai_explanation && (
        <div style={{
          background: "var(--color-background-info)",
          border: "0.5px solid var(--color-border-info)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          fontSize: 14,
          color: "var(--color-text-info)",
          lineHeight: 1.6,
        }}>
          {analysis.ai_explanation}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        <div>
          {analysis?.issues?.length ? (
            <div style={{ marginBottom: "1.5rem" }}>
              <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Issues detected</p>
              <IssueList issues={analysis.issues} />
            </div>
          ) : null}

          <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Recommendations</p>
          {(detail?.recommendations ?? []).map((rec: any) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              benchmark={benchmarks[rec.id]}
              benchmarking={!!benchmarking[rec.id]}
              applying={applying === rec.id}
              onBenchmark={() => handleBenchmark(rec)}
              onApply={() => handleApply(rec.id)}
            />
          ))}

          <AgentTrace
            slowQueryId={id}
            running={agentRunning}
            onComplete={(conclusion) => {
              setAgentRunning(false);
              getQueryDetail(id).then(setDetail);
            }}
          />
        </div>

        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Execution plan</p>
          <PlanTree nodes={analysis?.plan_nodes ?? []} />

          {detail?.history?.length > 0 && (
            <div style={{
              marginTop: "1.5rem",
              background: "var(--color-background-secondary)",
              borderRadius: "var(--border-radius-lg)",
              padding: "1rem",
            }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 10px" }}>Performance history</p>
              <QueryHistoryChart data={detail.history} avgMs={detail.avg_exec_time_ms} />
            </div>
          )}
        </div>
      </div>

      {showMigrationModal && migrationSQL && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9998, padding: "1rem",
        }}>
          <div style={{
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-lg)",
            padding: "1.5rem", maxWidth: 600, width: "100%",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Migration SQL</p>
              <button onClick={() => setShowMigrationModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer",
                         color: "var(--color-text-secondary)", fontSize: 16 }}>✕</button>
            </div>
            <pre style={{
              background: "var(--color-background-secondary)",
              padding: "1rem", borderRadius: "var(--border-radius-md)",
              fontSize: 12, fontFamily: "var(--font-mono)",
              overflowX: "auto", whiteSpace: "pre-wrap",
              color: "var(--color-text-primary)", margin: "0 0 1rem",
            }}>
              {migrationSQL}
            </pre>
            <button
              onClick={() => {
                navigator.clipboard.writeText(migrationSQL);
                toast({ type: "success", title: "Copied to clipboard" });
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", background: "var(--color-text-primary)",
                color: "var(--color-background-primary)", border: "none",
                borderRadius: "var(--border-radius-md)", cursor: "pointer",
                fontSize: 13, fontWeight: 500,
              }}
            >
              <Copy size={13} /> Copy to clipboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
