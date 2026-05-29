import axios, { AxiosInstance } from "axios";

// Empty string = use relative paths so the Next.js rewrite proxy handles routing.
// Set NEXT_PUBLIC_API_URL to an absolute URL only if you need direct (non-proxied) access.
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 8000,
  headers: { "Content-Type": "application/json" },
});

// Always attach the latest token from localStorage — this covers hard-navigation
// reloads where api.defaults.headers.common may not have been set yet.
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("qs_token");
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    console.error("[API Error]", err.response?.status, err.response?.data);
    return Promise.reject(err);
  }
);

export default api;


// ── Typed API calls (add to this file as phases build out) ──────────────────

export const healthCheck = () =>
  api.get<{ status: string; ai_configured: boolean }>("/health").then((r) => r.data);


// ── Phase 3 additions ─────────────────────────────────────────────────────────

export interface Issue {
  type: string;
  severity: "high" | "medium" | "low";
  table: string | null;
  message: string;
}

export interface Recommendation {
  type: "index" | "rewrite" | "materialized_view";
  title: string;
  description: string;
  sql: string;
  estimated_improvement_pct: number;
  risk: "low" | "medium" | "high";
  confidence: number;
}

export interface PlanNode {
  type: string;
  table: string | null;
  rows_estimated: number;
  rows_actual: number;
  cost: number;
}

export interface AnalyzeResult {
  fingerprint: string;
  exec_time_ms: number;
  issues: Issue[];
  recommendations: Recommendation[];
  plan_nodes: PlanNode[];
  ai_explanation?: string;
}

export interface SlowQuery {
  id: string;
  query_fingerprint: string;
  query_text: string;
  avg_exec_time_ms: number;
  max_exec_time_ms: number;
  calls: number;
  db_type: string;
  is_anomaly: boolean;
  is_resolved: boolean;
  detected_at: string;
}

export interface StaleIndex {
  schema: string;
  table: string;
  index: string;
  scans: number;
  size: string;
}

export const analyzeQuery = (query: string, slowQueryId?: string) =>
  api.post<AnalyzeResult>("/api/v1/queries/analyze", {
    query,
    slow_query_id: slowQueryId,
  }).then((r) => r.data);

export const listSlowQueries = (onlyAnomalies = false, limit = 50) =>
  api.get<SlowQuery[]>("/api/v1/queries/slow", {
    params: { only_anomalies: onlyAnomalies, limit },
  }).then((r) => r.data);

export const pollSlowQueries = () =>
  api.post<{ new: number; connections_polled: number }>("/api/v1/queries/poll")
    .then((r) => r.data);

export const getQueryDetail = (id: string) =>
  api.get(`/api/v1/queries/${id}`).then((r) => r.data);

export const resolveQuery = (id: string) =>
  api.post(`/api/v1/queries/${id}/resolve`).then((r) => r.data);

export const getStaleIndexes = () =>
  api.get<StaleIndex[]>("/api/v1/queries/meta/stale-indexes").then((r) => r.data);

export const ciAnalyze = (query: string, failOnSeqScan = true, thresholdMs = 1000) =>
  api.post("/api/v1/queries/ci/analyze", {
    query,
    fail_on_seq_scan: failOnSeqScan,
    fail_threshold_ms: thresholdMs,
  }).then((r) => r.data);


// ── Phase 4 additions ─────────────────────────────────────────────────────────

export interface BenchmarkResult {
  status: "pending" | "complete" | "not_found";
  before_ms?: number;
  after_ms?: number;
  improvement_pct?: number;
  iterations?: number;
  tested_at?: string;
  title?: string;
  rec_type?: string;
}

export interface BenchmarkHistory {
  id: string;
  before_ms: number;
  after_ms: number;
  improvement_pct: number;
  iterations: number;
  tested_at: string;
  title: string;
  rec_type: string;
  query_text: string;
}

export const runBenchmark = (payload: {
  query: string;
  recommendation_id: string;
  recommendation_sql: string;
  rec_type: string;
  tables_involved: string[];
}) => api.post<{ status: string; recommendation_id: string }>(
  "/api/v1/benchmark/run", payload
).then((r) => r.data);

export const getBenchmarkResult = (recommendationId: string) =>
  api.get<BenchmarkResult>(`/api/v1/benchmark/result/${recommendationId}`)
    .then((r) => r.data);

export const applyRecommendation = (recommendationId: string) =>
  api.post(`/api/v1/benchmark/apply/${recommendationId}`).then((r) => r.data);

export const getBenchmarkHistory = (limit = 20) =>
  api.get<BenchmarkHistory[]>("/api/v1/benchmark/history", { params: { limit } })
    .then((r) => r.data);

// ── Polling helper — auto-polls until benchmark completes ─────────────────────
export const pollBenchmarkResult = (
  recommendationId: string,
  onComplete: (result: BenchmarkResult) => void,
  intervalMs = 2000,
  maxAttempts = 30,
) => {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const result = await getBenchmarkResult(recommendationId);
      if (result.status === "complete") {
        clearInterval(interval);
        onComplete(result);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        onComplete({ status: "not_found" });
      }
    } catch {
      clearInterval(interval);
    }
  }, intervalMs);

  return () => clearInterval(interval); // return cleanup fn
};


// ── Phase 5 additions ─────────────────────────────────────────────────────────

export interface StaleIndexReport {
  postgres: {
    stale: StaleIndex[];
    bloated: StaleIndex[];
    duplicate: { table: string; index_a: string; index_b: string }[];
  };
  mysql: { stale: unknown[] };
  summary: {
    total_unused: number;
    total_bloated: number;
    total_duplicate: number;
    wasted_mb: number;
  };
}

export interface CIResult {
  passed: boolean;
  exec_time_ms: number | null;
  issues: Issue[];
  recommendations: Recommendation[];
  fail_reasons: string[];
  context: string | null;
  badge: "PASS" | "FAIL";
}

export const getStaleIndexReport = () =>
  api.get<StaleIndexReport>("/api/v1/indexes/stale").then((r) => r.data);

export const getBloatedIndexes = () =>
  api.get("/api/v1/indexes/bloated").then((r) => r.data);

export const getDropSQL = (indexName: string, schema = "public") =>
  api.get(`/api/v1/indexes/drop-sql/${indexName}`, { params: { schema } })
    .then((r) => r.data);

export const mysqlAnalyze = (query: string) =>
  api.post("/api/v1/indexes/mysql/analyze", { query }).then((r) => r.data);

export const ciCheck = (payload: {
  query: string;
  db_type?: string;
  fail_on_seq_scan?: boolean;
  fail_threshold_ms?: number;
  context?: string;
  service?: string;
}) => api.post<CIResult>("/api/v1/ci/check", payload).then((r) => r.data);


// ── Phase 8 additions ─────────────────────────────────────────────────────────

export interface QueryStats {
  queries: {
    total_slow: number;
    total_anomalies: number;
    total_resolved: number;
    avg_exec_ms: number;
    max_exec_ms: number;
    mysql_count: number;
    pg_count: number;
  };
  benchmarks: {
    total_benchmarks: number;
    avg_improvement: number;
    best_improvement: number;
    total_ms_saved: number;
  };
}

export const getQueryStats = () =>
  api.get<QueryStats>("/api/v1/queries/stats/summary").then((r) => r.data);

export const bulkResolve = (ids: string[]) =>
  api.post("/api/v1/queries/bulk/resolve", ids).then((r) => r.data);

export const deleteQuery = (id: string) =>
  api.delete(`/api/v1/queries/${id}`).then((r) => r.data);


// ── Phase 9 additions ─────────────────────────────────────────────────────────
export const getStreamPulse = () =>
  api.get("/api/v1/stream/pulse").then((r) => r.data);


// ── Regression detection ──────────────────────────────────────────────────────

export interface RegressionQuery {
  id: string;
  query_fingerprint: string;
  query_text: string;
  avg_exec_time_ms: number;
  calls: number;
  db_type: string;
  is_anomaly: boolean;
  detected_at: string;
  baseline_ms: number;
  recent_ms: number;
  regression_pct: number;
  baseline_samples: number;
  recent_samples: number;
  last_seen: string;
}

export const getRegressions = (thresholdPct = 20) =>
  api.get<RegressionQuery[]>("/api/v1/queries/regressions", {
    params: { threshold_pct: thresholdPct },
  }).then((r) => r.data);

// ── Demo ──────────────────────────────────────────────────────────────────────
export const seedDemo = () =>
  api.post<{ seeded: number; benchmarks: number }>("/api/v1/demo/seed").then((r) => r.data);

export const clearDemo = () =>
  api.delete("/api/v1/demo/clear").then((r) => r.data);
