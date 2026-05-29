"use client";
import { useState, useCallback } from "react";
import { useLiveStream, LiveStats, LiveQuery } from "@/hooks/useLiveStream";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Wifi, WifiOff, AlertTriangle, Zap } from "lucide-react";

const MAX_FEED = 30;

export default function LiveFeed() {
  const router = useRouter();
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [feed, setFeed] = useState<(LiveQuery & { seenAt: number })[]>([]);

  const onTick = useCallback((payload: any) => {
    setStats(payload.stats);
  }, []);

  const onNewQuery = useCallback((q: LiveQuery) => {
    setFeed((prev) => [{ ...q, seenAt: Date.now() }, ...prev].slice(0, MAX_FEED));
  }, []);

  const { connected, lastTick } = useLiveStream({ onTick, onNewQuery });

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: connected ? "var(--color-text-success)" : "var(--color-text-danger)",
            boxShadow: connected ? "0 0 0 2px var(--color-background-success)" : "none",
          }} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Live query feed</span>
          {connected
            ? <Wifi size={12} color="var(--color-text-success)" />
            : <WifiOff size={12} color="var(--color-text-danger)" />
          }
        </div>

        {stats && (
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--color-text-secondary)" }}>
            <span><strong style={{ color: "var(--color-text-primary)" }}>{stats.active}</strong> active</span>
            <span><strong style={{ color: stats.anomalies > 0 ? "var(--color-text-danger)" : "var(--color-text-primary)" }}>{stats.anomalies}</strong> anomalies</span>
            <span><strong style={{ color: "var(--color-text-primary)" }}>{stats.avg_ms.toFixed(0)}ms</strong> avg</span>
            <span><strong style={{ color: "var(--color-text-warning)" }}>{stats.max_ms.toFixed(0)}ms</strong> max</span>
          </div>
        )}
      </div>

      {/* Feed */}
      <div style={{ maxHeight: 340, overflowY: "auto" }}>
        {!feed.length ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
            {connected
              ? "Listening for slow queries... Celery polls every 30s."
              : "Connecting to live stream..."}
          </div>
        ) : (
          feed.map((q) => (
            <div
              key={`${q.id}-${q.seenAt}`}
              onClick={() => router.push(`/dashboard/query/${q.id}`)}
              style={{
                padding: "10px 16px",
                borderBottom: "0.5px solid var(--color-border-tertiary)",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background-secondary)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ marginTop: 2, flexShrink: 0 }}>
                {q.is_anomaly
                  ? <AlertTriangle size={13} color="var(--color-text-danger)" />
                  : <Zap size={13} color="var(--color-text-warning)" />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <code style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-secondary)",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {q.preview}
                </code>
                <div style={{ display: "flex", gap: 12, marginTop: 3, fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  <span style={{ color: q.avg_ms > 2000 ? "var(--color-text-danger)" : "var(--color-text-warning)", fontWeight: 500 }}>
                    {q.avg_ms.toFixed(0)}ms
                  </span>
                  <span>{q.calls} calls</span>
                  <span>{q.db_type}</span>
                  {q.is_anomaly && <span style={{ color: "var(--color-text-danger)" }}>anomaly</span>}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                {formatDistanceToNow(new Date(q.seenAt), { addSuffix: true })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
