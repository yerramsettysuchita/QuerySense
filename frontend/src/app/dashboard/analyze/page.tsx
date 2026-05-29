"use client";
import { useState, useRef, useEffect } from "react";
import { analyzeQuery, AnalyzeResult, runBenchmark, pollBenchmarkResult, BenchmarkResult } from "@/lib/api";
import IssueList from "@/components/query/IssueList";
import PlanTree from "@/components/query/PlanTree";
import { Play, Loader, Upload, ImageIcon, AlertTriangle, Zap, CheckCircle, Copy } from "lucide-react";
import api from "@/lib/api";
import { toast } from "@/components/ui/Toast";

const EXAMPLES = [
  "SELECT * FROM slow_queries ORDER BY avg_exec_time_ms DESC LIMIT 50",
  "SELECT * FROM agent_decisions ORDER BY created_at DESC LIMIT 20",
  "SELECT u.name, u.email, w.name AS workspace FROM users u JOIN workspace_members wm ON u.id = wm.user_id JOIN workspaces w ON wm.workspace_id = w.id WHERE u.is_active = true",
];

function extractTables(sql: string): string[] {
  const matches = sql.match(/(?:FROM|JOIN)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/gi) ?? [];
  return [...new Set(matches.map(m => m.trim().split(/\s+/).pop()!.replace(/["'`]/g, "").toLowerCase()))];
}

interface BenchState { loading: boolean; result: BenchmarkResult | null }

export default function AnalyzePage() {
  const [query, setQuery]   = useState(EXAMPLES[0]);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [screenshotLoading,  setScreenshotLoading]  = useState(false);
  const [screenshotAnalysis, setScreenshotAnalysis] = useState<string | null>(null);
  const [screenshotError,    setScreenshotError]    = useState<string | null>(null);
  const [screenshotFile,     setScreenshotFile]     = useState<File | null>(null);
  const [visionConfigured,   setVisionConfigured]   = useState<boolean | null>(null);
  const [benchStates,        setBenchStates]        = useState<Record<number, BenchState>>({});

  useEffect(() => {
    api.get("/api/v1/vision/status")
      .then(r => setVisionConfigured(r.data.configured ?? false))
      .catch(() => setVisionConfigured(false));
  }, []);

  // Reset bench states when result changes
  useEffect(() => { setBenchStates({}); }, [result]);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(null);
    try {
      setResult(await analyzeQuery(query));
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "Analysis failed");
    } finally { setLoading(false); }
  };

  // ⌘Enter / Ctrl+Enter to run
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [query]);

  const handleBenchmark = async (idx: number) => {
    if (!result) return;
    const rec = result.recommendations[idx];
    setBenchStates(p => ({ ...p, [idx]: { loading: true, result: null } }));
    const recId = `client-${Date.now()}-${idx}`;
    try {
      await runBenchmark({
        query,
        recommendation_id: recId,
        recommendation_sql: rec.sql,
        rec_type: rec.type,
        tables_involved: extractTables(rec.sql),
      });
      pollBenchmarkResult(recId, (br) => {
        setBenchStates(p => ({ ...p, [idx]: { loading: false, result: br } }));
        if (br.status === "complete") {
          toast({ type: "success", title: `${Math.round(br.improvement_pct ?? 0)}% improvement`, message: `${br.before_ms?.toFixed(0)}ms → ${br.after_ms?.toFixed(0)}ms` });
        }
      });
    } catch {
      setBenchStates(p => ({ ...p, [idx]: { loading: false, result: { status: "not_found" } } }));
      toast({ type: "error", title: "Benchmark failed", message: "Could not run benchmark on shadow DB." });
    }
  };

  const copySQL = (sql: string) => {
    navigator.clipboard.writeText(sql);
    toast({ type: "info", title: "SQL copied to clipboard", duration: 2000 });
  };

  const handleScreenshotUpload = async (file: File) => {
    setScreenshotFile(file); setScreenshotLoading(true);
    setScreenshotAnalysis(null); setScreenshotError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/api/v1/vision/analyze-screenshot", form);
      data.error ? setScreenshotError(data.error) : setScreenshotAnalysis(data.analysis);
    } catch (e: any) {
      setScreenshotError(e.response?.data?.detail ?? "Screenshot analysis failed");
    } finally { setScreenshotLoading(false); }
  };

  const handleExtractQuery = async () => {
    if (!screenshotFile) return;
    setScreenshotLoading(true);
    try {
      const form = new FormData();
      form.append("file", screenshotFile);
      const { data } = await api.post("/api/v1/vision/extract-query", form);
      data.found && data.query ? setQuery(data.query) : setScreenshotError("No SQL query found in the screenshot.");
    } catch (e: any) {
      setScreenshotError(e.response?.data?.detail ?? "Query extraction failed");
    } finally { setScreenshotLoading(false); }
  };

  const riskColor: Record<string, string> = { low: "var(--color-text-success)", medium: "var(--color-text-warning)", high: "var(--color-text-danger)" };

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>Analyze a query</h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: "0 0 1.5rem" }}>
        Paste any SELECT query — QuerySense will EXPLAIN it, detect issues, and recommend fixes.
        <span style={{ color: "var(--color-text-tertiary)", marginLeft: 8, fontSize: 12 }}>⌘↵ to run</span>
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {EXAMPLES.map((ex, i) => (
          <button key={i} onClick={() => setQuery(ex)} style={{
            fontSize: 11, padding: "4px 10px",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-md)",
            cursor: "pointer", color: "var(--color-text-secondary)",
          }}>Example {i + 1}</button>
        ))}
      </div>

      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        rows={5}
        style={{
          width: "100%", fontFamily: "var(--font-mono)", fontSize: 13,
          padding: "12px 14px",
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-md)",
          color: "var(--color-text-primary)", resize: "vertical",
          marginBottom: 10, outline: "none",
          boxSizing: "border-box",
        }}
        placeholder="SELECT ..."
      />

      <button
        onClick={run}
        disabled={loading}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 20px",
          background: "var(--color-background-info)",
          color: "var(--color-text-info)",
          border: "0.5px solid var(--color-border-info)",
          borderRadius: "var(--border-radius-md)",
          cursor: loading ? "not-allowed" : "pointer",
          fontSize: 13, fontWeight: 500,
          opacity: loading ? 0.7 : 1,
          marginBottom: "2rem",
        }}
      >
        {loading ? <Loader size={14} /> : <Play size={14} />}
        {loading ? "Analyzing..." : "Analyze query"}
      </button>

      {error && (
        <div style={{ color: "var(--color-text-danger)", fontSize: 13, marginBottom: "1rem" }}>{error}</div>
      )}

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
          <div>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 1.5rem" }}>
              Execution time: <strong style={{ color: "var(--color-text-primary)" }}>{result.exec_time_ms.toFixed(2)}ms</strong>
              &nbsp;· Fingerprint: <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{result.fingerprint}</code>
            </p>

            {result.ai_explanation && (
              <div style={{
                background: "var(--color-background-info)",
                border: "0.5px solid var(--color-border-info)",
                borderRadius: "var(--border-radius-lg)",
                padding: "1rem 1.25rem", marginBottom: "1.5rem",
                fontSize: 14, color: "var(--color-text-info)", lineHeight: 1.6,
              }}>
                {result.ai_explanation}
              </div>
            )}

            {result.issues.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Issues</p>
                <IssueList issues={result.issues} />
              </div>
            )}

            {result.recommendations.length > 0 && (
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Recommendations</p>
                {result.recommendations.map((rec, i) => {
                  const bench = benchStates[i];
                  return (
                    <div key={i} style={{
                      background: "var(--color-background-primary)",
                      border: "0.5px solid var(--color-border-tertiary)",
                      borderRadius: "var(--border-radius-lg)",
                      padding: "1rem 1.25rem", marginBottom: 10,
                    }}>
                      {/* Header row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 10 }}>
                        <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{rec.title}</p>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-success)" }}>
                            ~{Math.round(rec.estimated_improvement_pct)}%
                          </span>
                          <span style={{ fontSize: 11, color: riskColor[rec.risk] }}>
                            {rec.risk} risk
                          </span>
                        </div>
                      </div>

                      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 10px", lineHeight: 1.5 }}>
                        {rec.description}
                      </p>

                      <pre style={{
                        margin: "0 0 12px", fontSize: 12, fontFamily: "var(--font-mono)",
                        background: "var(--color-background-secondary)",
                        padding: "10px 12px", borderRadius: "var(--border-radius-md)",
                        overflowX: "auto", color: "var(--color-text-primary)",
                        whiteSpace: "pre-wrap",
                      }}>
                        {rec.sql}
                      </pre>

                      {/* Action row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {/* Fix this button */}
                        {!bench?.result || bench.result.status !== "complete" ? (
                          <button
                            onClick={() => handleBenchmark(i)}
                            disabled={bench?.loading}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              padding: "6px 14px", fontSize: 12, fontWeight: 500,
                              background: bench?.loading ? "var(--color-background-secondary)" : "var(--color-background-success)",
                              color: bench?.loading ? "var(--color-text-secondary)" : "var(--color-text-success)",
                              border: `0.5px solid ${bench?.loading ? "var(--color-border-secondary)" : "var(--color-border-success)"}`,
                              borderRadius: "var(--border-radius-md)",
                              cursor: bench?.loading ? "not-allowed" : "pointer",
                              opacity: bench?.loading ? 0.7 : 1,
                              transition: "all 0.15s",
                            }}
                          >
                            {bench?.loading
                              ? <><Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> Benchmarking...</>
                              : <><Zap size={12} /> Fix this — benchmark it</>
                            }
                          </button>
                        ) : (
                          <div style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "6px 14px",
                            background: "var(--color-background-success)",
                            border: "0.5px solid var(--color-border-success)",
                            borderRadius: "var(--border-radius-md)",
                            fontSize: 12,
                          }}>
                            <CheckCircle size={12} color="var(--color-text-success)" />
                            <span style={{ color: "var(--color-text-success)", fontWeight: 600 }}>
                              {Math.round(bench.result.improvement_pct ?? 0)}% faster
                            </span>
                            <span style={{ color: "var(--color-text-secondary)" }}>
                              {bench.result.before_ms?.toFixed(0)}ms → {bench.result.after_ms?.toFixed(0)}ms
                            </span>
                          </div>
                        )}

                        {/* Copy SQL button */}
                        <button
                          onClick={() => copySQL(rec.sql)}
                          style={{
                            display: "flex", alignItems: "center", gap: 5,
                            padding: "6px 12px", fontSize: 12,
                            background: "none",
                            border: "0.5px solid var(--color-border-secondary)",
                            borderRadius: "var(--border-radius-md)",
                            cursor: "pointer", color: "var(--color-text-secondary)",
                          }}
                        >
                          <Copy size={11} /> Copy SQL
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Execution plan</p>
            <PlanTree nodes={result.plan_nodes} />
          </div>
        </div>
      )}

      {/* Screenshot analysis */}
      <div style={{ marginTop: "2.5rem" }}>
        <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>Analyze a screenshot</p>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 1rem" }}>
          Upload a screenshot of a slow query, EXPLAIN output, or monitoring dashboard — GPT-4o Vision identifies the bottleneck.
        </p>

        {visionConfigured === false && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", marginBottom: "1rem",
            background: "var(--color-background-warning)",
            border: "0.5px solid var(--color-border-warning)",
            borderRadius: "var(--border-radius-md)",
            fontSize: 13, color: "var(--color-text-warning)",
          }}>
            <AlertTriangle size={14} />
            Vision not configured — set <code style={{ margin: "0 4px", fontSize: 12 }}>OPENAI_API_KEY</code> in your backend environment to enable screenshot analysis.
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleScreenshotUpload(f); }}
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: "0.5px dashed var(--color-border-secondary)",
            borderRadius: "var(--border-radius-lg)",
            padding: "2rem", textAlign: "center", cursor: "pointer",
            background: "var(--color-background-secondary)",
            marginBottom: "1rem", transition: "border-color 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--color-border-primary)")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--color-border-secondary)")}
        >
          {screenshotFile ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <ImageIcon size={16} color="var(--color-text-secondary)" />
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{screenshotFile.name}</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <Upload size={20} color="var(--color-text-tertiary)" />
              <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>Click to upload (PNG, JPG, max 10MB)</span>
            </div>
          )}
        </div>

        {screenshotFile && (
          <button
            onClick={handleExtractQuery}
            disabled={screenshotLoading}
            style={{
              fontSize: 12, padding: "5px 14px", background: "none",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: screenshotLoading ? "not-allowed" : "pointer",
              color: "var(--color-text-secondary)", marginBottom: "1rem",
            }}
          >Extract SQL from screenshot → populate editor</button>
        )}

        {screenshotLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
            <Loader size={14} /> Analyzing with GPT-4o Vision...
          </div>
        )}

        {screenshotError && (
          <div style={{ fontSize: 13, color: "var(--color-text-danger)", marginTop: 8 }}>{screenshotError}</div>
        )}

        {screenshotAnalysis && (
          <div style={{
            background: "var(--color-background-info)",
            border: "0.5px solid var(--color-border-info)",
            borderRadius: "var(--border-radius-lg)",
            padding: "1rem 1.25rem", fontSize: 14,
            color: "var(--color-text-info)", lineHeight: 1.6, marginTop: 8,
          }}>{screenshotAnalysis}</div>
        )}
      </div>
    </div>
  );
}
