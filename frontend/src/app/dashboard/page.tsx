"use client";
import { useEffect, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  listSlowQueries, getBenchmarkHistory, getStaleIndexReport,
  getQueryStats, getRegressions, pollSlowQueries, seedDemo, clearDemo,
  SlowQuery, BenchmarkHistory, RegressionQuery,
} from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { wsClient } from "@/lib/ws";
import MetricCard from "@/components/dashboard/MetricCard";
import SlowQueryTable from "@/components/dashboard/SlowQueryTable";
import RegressionTable from "@/components/dashboard/RegressionTable";
import RegressionBanner from "@/components/dashboard/RegressionBanner";
import LatencyChart from "@/components/charts/LatencyChart";
import StaleIndexPanel from "@/components/dashboard/StaleIndexPanel";
import LiveFeed from "@/components/dashboard/LiveFeed";
import PulseBar from "@/components/dashboard/PulseBar";
import QueryUniverse from "@/components/viz/QueryUniverse";
import ImpactMeter from "@/components/viz/ImpactMeter";
import AgentActivityFeed from "@/components/viz/AgentActivityFeed";
import SystemHealthPanel from "@/components/dashboard/SystemHealthPanel";
import QueryCostBreakdown from "@/components/dashboard/QueryCostBreakdown";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonMetricCards, SkeletonCanvas, SkeletonRow } from "@/components/ui/Skeleton";
import { Activity, AlertTriangle, Database, Zap, PlugZap, DollarSign, TrendingUp, ArrowRight, RefreshCw, Trash2, CheckCircle2, XCircle, PlusCircle } from "lucide-react";
import { listConnections, Connection } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import Link from "next/link";

const CPU_COST_PER_MS = 0.00000002;
function fmtCost(usd: number) {
  if (usd < 0.001) return "<$0.01";
  if (usd < 1)    return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

type QueryTab = "all" | "regressions";

export default function DashboardPage() {
  const { loading: authLoading } = useAuth();
  const [liveAlert, setLiveAlert] = useState<string | null>(null);
  const [queryTab, setQueryTab] = useState<QueryTab>("all");
  const [syncing, setSyncing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const { data: queries = [], isLoading: qLoading, refetch: refetchQueries } = useQuery<SlowQuery[]>({
    queryKey: ["slow-queries"],
    queryFn: () => listSlowQueries(false, 50),
    refetchInterval: 60_000,
  });

  const { data: history = [], isLoading: hLoading } = useQuery<BenchmarkHistory[]>({
    queryKey: ["benchmark-history"],
    queryFn: () => getBenchmarkHistory(20),
    refetchInterval: 120_000,
  });

  const { data: staleReport = null, isLoading: sLoading } = useQuery({
    queryKey: ["stale-report"],
    queryFn: getStaleIndexReport,
    staleTime: 5 * 60_000,
  });

  const { data: realStats = null, isLoading: statsLoading } = useQuery({
    queryKey: ["query-stats"],
    queryFn: getQueryStats,
    refetchInterval: 60_000,
  });

  const { data: regressions = [], isLoading: rLoading } = useQuery<RegressionQuery[]>({
    queryKey: ["regressions"],
    queryFn: () => getRegressions(),
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const { data: connections = [], isLoading: cLoading, isFetching: cFetching, isError: cError, error: cErrorObj, refetch: refetchConnections } = useQuery<Connection[], Error>({
    queryKey: ["connections"],
    queryFn: listConnections,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
    enabled: !authLoading,
  });

  const [deletingConn, setDeletingConn] = useState<string | null>(null);

  const handleDeleteConnection = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Remove "${name}" from QuerySense? This cannot be undone.`)) return;
    setDeletingConn(id);
    try {
      await api.delete(`/api/v1/connections/${id}`);
      await refetchConnections();
      toast({ type: "success", title: "Connection removed", message: `${name} has been disconnected.` });
    } catch {
      toast({ type: "error", title: "Could not remove connection", message: "Try again or remove it from Settings." });
    } finally {
      setDeletingConn(null);
    }
  }, [refetchConnections]);

  const loading = qLoading || hLoading || sLoading || statsLoading;

  const bestWin = history.length
    ? history.reduce((best, h) => (h.improvement_pct > best.improvement_pct ? h : best), history[0])
    : null;

  const handleSyncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await pollSlowQueries();
      await refetchQueries();
      setLastSynced(new Date());
      if (result.new > 0) {
        toast({ type: "info", title: `${result.new} new ${result.new === 1 ? "query" : "queries"} detected`, duration: 3500 });
      } else {
        toast({ type: "success", title: "Up to date", message: "No new slow queries found.", duration: 2500 });
      }
    } catch {
      toast({ type: "error", title: "Sync failed", message: "Could not reach your database." });
    } finally { setSyncing(false); }
  }, [syncing, refetchQueries]);

  const handleSeedDemo = useCallback(async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const result = await seedDemo() as any;
      await refetchQueries();
      await refetchConnections();
      setLastSynced(new Date());
      const msg = result.seeded > 0
        ? `${result.seeded} queries · ${result.recommendations ?? 0} recs · ${result.benchmarks ?? 0} benchmarks · ${result.history_points ?? 0} history points`
        : "Demo data already loaded — all pages are populated.";
      toast({ type: "success", title: "Demo data loaded", message: msg });
    } catch {
      toast({ type: "error", title: "Seed failed", message: "Could not load demo data." });
    } finally { setSeeding(false); }
  }, [seeding, refetchQueries, refetchConnections]);

  const handleClearDemo = useCallback(async () => {
    if (!window.confirm("Remove all demo data? This will delete the Demo Database connection and all its queries.")) return;
    setClearing(true);
    try {
      await clearDemo();
      await refetchQueries();
      await refetchConnections();
      toast({ type: "success", title: "Demo data cleared" });
    } catch {
      toast({ type: "error", title: "Clear failed", message: "Could not remove demo data." });
    } finally { setClearing(false); }
  }, [refetchQueries, refetchConnections]);

  // R key = sync now (when not typing in an input)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "r" || e.key === "R") handleSyncNow();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleSyncNow]);

  // Poll connected databases for slow queries (runs without Celery/Redis)
  useEffect(() => {
    const run = async () => {
      try {
        const result = await pollSlowQueries();
        await refetchQueries();
        setLastSynced(new Date());
        if (result.new > 0) {
          toast({ type: "info", title: `${result.new} new ${result.new === 1 ? "slow query" : "slow queries"} detected`, duration: 4000 });
        }
      } catch {}
    };
    run();
    const id = setInterval(run, 20_000);
    return () => clearInterval(id);
  }, [refetchQueries]);

  useEffect(() => {
    wsClient.connect("global");

    wsClient.on("anomaly_detected", (data) => {
      setLiveAlert(`Anomaly detected: ${String(data.fingerprint ?? "")}`);
      setTimeout(() => setLiveAlert(null), 6000);
      refetchQueries();
    });

    wsClient.on("slow_query_found", () => {
      refetchQueries();
    });
  }, [refetchQueries]);

  const anomalies = queries.filter((q) => q.is_anomaly);
  const totalDailyCostUsd = queries.reduce((sum, q) => sum + q.avg_exec_time_ms * q.calls * CPU_COST_PER_MS, 0);
  const avgImprovement = history.length
    ? Math.round(history.reduce((s, h) => s + h.improvement_pct, 0) / history.length)
    : 0;

  // Wait for auth to initialise before we attempt any authenticated requests
  if (authLoading) {
    return (
      <div style={{
        minHeight: "calc(100vh - 54px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading...</span>
      </div>
    );
  }

  // Hold until we know connection state — prevents flash of dashboard content
  if (cLoading || cFetching) {
    return (
      <div style={{
        minHeight: "calc(100vh - 54px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading...</span>
      </div>
    );
  }

  // Error state — don't show "connect DB" if it was a fetch failure (auth error, network, etc.)
  if (cError) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (cErrorObj as any)?.response?.status;
    const detail = status ? `(${status})` : "";
    return (
      <div style={{
        minHeight: "calc(100vh - 54px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--color-text-danger)", marginBottom: 8 }}>
            Could not load connections {detail} — try refreshing.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 16px", background: "none",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)",
            }}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // Gate: no connection added yet
  if (connections.length === 0) {
    return (
      <div style={{
        minHeight: "calc(100vh - 54px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}>
        <div style={{
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
        }}>
          {/* Icon */}
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 1.5rem",
            boxShadow: "var(--shadow-sm)",
          }}>
            <Database size={28} color="var(--color-text-tertiary)" />
          </div>

          <h1 style={{
            fontSize: 22, fontWeight: 600, margin: "0 0 10px",
            letterSpacing: "-0.02em", color: "var(--color-text-primary)",
          }}>
            Connect your database first
          </h1>
          <p style={{
            fontSize: 14, color: "var(--color-text-secondary)",
            lineHeight: 1.7, margin: "0 0 2rem",
          }}>
            QuerySense needs a database connection to monitor slow queries,
            analyze execution plans, and generate index recommendations.
            Add one to unlock the full dashboard.
          </p>

          {/* Steps */}
          <div style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-lg)",
            padding: "1.25rem",
            textAlign: "left",
            marginBottom: "1.75rem",
          }}>
            {[
              { n: "01", text: "Paste your PostgreSQL or MySQL connection URL" },
              { n: "02", text: "QuerySense tests the connection and checks pg_stat_statements" },
              { n: "03", text: "Slow queries start appearing here automatically every 30 seconds" },
            ].map(({ n, text }) => (
              <div key={n} style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                padding: "8px 0",
                borderBottom: n !== "03" ? "0.5px solid var(--color-border-tertiary)" : "none",
              }}>
                <span style={{
                  fontSize: 11, fontFamily: "var(--font-mono)",
                  color: "var(--color-text-tertiary)", flexShrink: 0,
                  paddingTop: 2, width: 20,
                }}>{n}</span>
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                  {text}
                </span>
              </div>
            ))}
          </div>

          <Link href="/onboarding" style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "11px 24px",
            background: "var(--color-text-primary)",
            color: "#ffffff",
            borderRadius: "var(--border-radius-md)",
            textDecoration: "none",
            fontSize: 14, fontWeight: 600,
            letterSpacing: "-0.01em",
          }}>
            Add your database <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>

      {liveAlert && (
        <div style={{
          background: "var(--color-background-danger)",
          color: "var(--color-text-danger)",
          border: "0.5px solid var(--color-border-danger)",
          borderRadius: "var(--border-radius-md)",
          padding: "12px 16px",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          animation: "fadeIn 0.2s ease",
        }}>
          <AlertTriangle size={16} />
          {liveAlert}
        </div>
      )}

      {/* Regression banner — shown only when regressions exist */}
      {!rLoading && regressions.length > 0 && (
        <RegressionBanner regressions={regressions} />
      )}

      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Overview</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: "4px 0 0" }}>
            AI-powered database query optimizer
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
          {lastSynced && (
            <span
              key={lastSynced.getTime()}
              style={{ fontSize: 12, color: "var(--color-text-tertiary)", animation: "fadeIn 0.4s ease" }}
            >
              Synced {formatDistanceToNow(lastSynced, { addSuffix: true })}
            </span>
          )}
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px",
              fontSize: 12, fontWeight: 500,
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: syncing ? "not-allowed" : "pointer",
              color: syncing ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
              opacity: syncing ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          >
            <RefreshCw size={12} style={{ animation: syncing ? "spin 1s linear infinite" : undefined }} />
            {syncing ? "Syncing..." : "Sync now"}
          </button>

          {/* Demo data controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 6,
            padding: "2px 4px 2px 10px",
            background: "var(--color-background-info)",
            border: "0.5px solid var(--color-border-info)",
            borderRadius: "var(--border-radius-md)",
          }}>
            <span style={{ fontSize: 11, color: "var(--color-text-info)", fontWeight: 500 }}>Demo</span>
            <button
              onClick={handleSeedDemo}
              disabled={seeding}
              title="Load full demo data across all pages"
              style={{
                padding: "4px 10px", fontSize: 11, fontWeight: 500,
                background: "var(--color-text-info)", color: "#fff",
                border: "none", borderRadius: "var(--border-radius-md)",
                cursor: seeding ? "not-allowed" : "pointer",
                opacity: seeding ? 0.6 : 1,
              }}
            >
              {seeding ? "Loading..." : "Load"}
            </button>
            <button
              onClick={handleClearDemo}
              disabled={clearing}
              title="Remove all demo data"
              style={{
                padding: "4px 10px", fontSize: 11,
                background: "none", color: "var(--color-text-info)",
                border: "none", borderRadius: "var(--border-radius-md)",
                cursor: clearing ? "not-allowed" : "pointer",
                opacity: clearing ? 0.6 : 1,
              }}
            >
              {clearing ? "Clearing..." : "Clear"}
            </button>
          </div>
        </div>
      </div>

      <PulseBar />

      {/* Metric cards */}
      {loading ? (
        <div style={{ marginBottom: "2rem" }}>
          <SkeletonMetricCards count={6} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: "2rem" }}>
          <MetricCard icon={<Activity size={16} />} label="Slow queries" value={realStats?.queries.total_slow ?? queries.length} />
          <MetricCard
            icon={<AlertTriangle size={16} />} label="Anomalies"
            value={realStats?.queries.total_anomalies ?? anomalies.length}
            danger={(realStats?.queries.total_anomalies ?? anomalies.length) > 0}
          />
          <MetricCard
            icon={<TrendingUp size={16} />} label="Regressions"
            value={regressions.length}
            danger={regressions.length > 0}
          />
          <MetricCard
            icon={<Zap size={16} />} label="Avg improvement"
            value={`${Math.round(realStats?.benchmarks.avg_improvement ?? avgImprovement)}%`}
            success={(realStats?.benchmarks.avg_improvement ?? avgImprovement) > 50}
          />
          <MetricCard
            icon={<Database size={16} />} label="Wasted index space"
            value={`${staleReport?.summary.wasted_mb ?? 0} MB`}
            warning={(staleReport?.summary.wasted_mb ?? 0) > 50}
          />
          <MetricCard
            icon={<DollarSign size={16} />} label="Est. daily DB cost"
            value={fmtCost(totalDailyCostUsd)}
            danger={totalDailyCostUsd > 10}
            warning={totalDailyCostUsd > 1 && totalDailyCostUsd <= 10}
          />
        </div>
      )}

      {/* HERO: Query Universe + Agent Activity Feed */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, marginBottom: "1.5rem" }}>
        <div style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.25rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Query universe</p>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              {queries.length} {queries.length === 1 ? "query" : "queries"} · size = exec time
            </span>
          </div>
          {loading ? (
            <SkeletonCanvas height={420} />
          ) : queries.length > 0 ? (
            <ErrorBoundary>
              <QueryUniverse queries={queries} height={420} />
            </ErrorBoundary>
          ) : (
            <div>
              <EmptyState
                icon={<PlugZap size={20} />}
                title="No slow queries yet"
                description="Connect a database and QuerySense will detect slow queries automatically. Or load demo data to explore all features right now."
                actions={[
                  { label: "Connect a database", href: "/onboarding" },
                  { label: "Analyze a query", href: "/dashboard/analyze", variant: "secondary" },
                ]}
              />
              <div style={{ textAlign: "center", marginTop: "1rem" }}>
                <button
                  onClick={handleSeedDemo}
                  disabled={seeding}
                  style={{
                    padding: "8px 20px", fontSize: 13, fontWeight: 500,
                    background: "var(--color-background-info)",
                    border: "0.5px solid var(--color-border-info)",
                    borderRadius: "var(--border-radius-md)",
                    color: "var(--color-text-info)",
                    cursor: seeding ? "not-allowed" : "pointer",
                    opacity: seeding ? 0.6 : 1,
                    transition: "opacity 0.15s",
                  }}
                >
                  {seeding ? "Loading..." : "Try with demo data →"}
                </button>
              </div>
            </div>
          )}
        </div>
        <AgentActivityFeed />
      </div>

      {/* Impact meter — only visible after at least one benchmark */}
      {bestWin && (
        <div style={{ marginBottom: "1.5rem" }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 10px" }}>Best optimization this session</p>
          <ImpactMeter
            beforeMs={bestWin.before_ms}
            afterMs={bestWin.after_ms}
            label={bestWin.title?.slice(0, 32)}
          />
        </div>
      )}

      {/* Live feed */}
      <div style={{ marginBottom: "1.5rem" }}>
        <LiveFeed />
      </div>

      {/* Charts + stale indexes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, marginBottom: "1.5rem" }}>
        <div style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.25rem",
        }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 1rem" }}>Optimization impact</p>
          <LatencyChart data={history} />
        </div>
        <StaleIndexPanel report={staleReport} />
      </div>

      {/* Cost breakdown */}
      {queries.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <QueryCostBreakdown queries={queries} />
        </div>
      )}

      {/* Slow queries / Regressions tabbed panel */}
      <div style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
        overflow: "hidden",
      }}>
        {/* Tab bar */}
        <div style={{
          display: "flex",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          padding: "0 1.25rem",
        }}>
          {([
            { key: "all" as QueryTab,         label: "All queries",   count: queries.length },
            { key: "regressions" as QueryTab, label: "Regressions",   count: regressions.length, danger: regressions.length > 0 },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setQueryTab(tab.key)}
              style={{
                background: "none", border: "none",
                borderBottom: queryTab === tab.key
                  ? "2px solid var(--color-text-primary)"
                  : "2px solid transparent",
                padding: "10px 0",
                marginRight: 20,
                cursor: "pointer",
                fontSize: 13,
                color: queryTab === tab.key ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                fontWeight: queryTab === tab.key ? 500 : 400,
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: -1,
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  fontSize: 11,
                  background: tab.danger ? "var(--color-background-danger)" : "var(--color-background-secondary)",
                  color: tab.danger ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                  borderRadius: 10,
                  padding: "1px 6px",
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: "1.25rem" }}>
          {queryTab === "all" && (
            loading ? (
              <div>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}</div>
            ) : queries.length === 0 ? (
              <EmptyState
                icon={<Activity size={18} />}
                title="No slow queries detected"
                description="Run some queries on your connected database or paste one into the Analyze page."
                actions={[{ label: "Analyze a query", href: "/dashboard/analyze" }]}
              />
            ) : (
              <SlowQueryTable
                queries={queries}
                onRefresh={() => refetchQueries()}
                regressionIds={new Set(regressions.map((r) => r.id))}
              />
            )
          )}

          {queryTab === "regressions" && (
            rLoading ? (
              <div>{Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}</div>
            ) : (
              <RegressionTable regressions={regressions} />
            )
          )}
        </div>
      </div>

      {/* Connected databases */}
      <div style={{ marginTop: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Connected databases</p>
          <Link href="/onboarding" style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 12, color: "var(--color-text-secondary)",
            textDecoration: "none",
          }}>
            <PlusCircle size={13} /> Add database
          </Link>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {connections.map((conn) => (
            <div key={conn.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px",
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "var(--border-radius-md)",
            }}>
              <Database size={14} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{conn.name}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 8 }}>{conn.db_type} · {conn.host}:{conn.port}</span>
              </div>
              {conn.status === "ok" ? (
                <CheckCircle2 size={13} color="var(--color-text-success)" style={{ flexShrink: 0 }} />
              ) : (
                <XCircle size={13} color="var(--color-text-danger)" style={{ flexShrink: 0 }} />
              )}
              <button
                onClick={() => handleDeleteConnection(conn.id, conn.name)}
                disabled={deletingConn === conn.id}
                title="Remove connection"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 10px",
                  background: "none",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: "var(--border-radius-md)",
                  cursor: deletingConn === conn.id ? "not-allowed" : "pointer",
                  fontSize: 11,
                  color: "var(--color-text-danger)",
                  opacity: deletingConn === conn.id ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                <Trash2 size={11} />
                {deletingConn === conn.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "1.5rem", marginBottom: "1.5rem" }}>
        <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 12px" }}>System health</p>
        <SystemHealthPanel />
      </div>
    </div>
  );
}
