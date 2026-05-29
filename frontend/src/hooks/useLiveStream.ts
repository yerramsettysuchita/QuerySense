import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";

export interface LiveStats {
  active: number;
  anomalies: number;
  avg_ms: number;
  max_ms: number;
}

export interface LiveQuery {
  id: string;
  fingerprint: string;
  preview: string;
  avg_ms: number;
  calls: number;
  db_type: string;
  is_anomaly: boolean;
}

interface TickPayload {
  type: "tick" | "error";
  timestamp: number;
  stats: LiveStats;
  new_queries: LiveQuery[];
}

interface Options {
  onTick?: (payload: TickPayload) => void;
  onNewQuery?: (query: LiveQuery) => void;
  onError?: (msg: string) => void;
}

export function useLiveStream({ onTick, onNewQuery, onError }: Options) {
  const [connected, setConnected] = useState(false);
  const [lastTick, setLastTick] = useState<number | null>(null);
  const sentIdsRef = useRef<Set<string>>(new Set());
  const onTickRef = useRef(onTick);
  const onNewQueryRef = useRef(onNewQuery);
  const onErrorRef = useRef(onError);

  onTickRef.current = onTick;
  onNewQueryRef.current = onNewQuery;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const r = await api.get("/api/v1/stream/pulse");
        if (cancelled) return;
        const data = r.data;
        setConnected(true);
        setLastTick(data.timestamp);

        const newQueries: LiveQuery[] = (data.recent ?? [])
          .filter((q: any) => !sentIdsRef.current.has(q.id))
          .map((q: any) => {
            sentIdsRef.current.add(q.id);
            return {
              id: q.id,
              fingerprint: q.query_fingerprint ?? "",
              preview: (q.query_text ?? q.query_fingerprint ?? "").slice(0, 100),
              avg_ms: q.avg_exec_time_ms ?? 0,
              calls: q.calls ?? 0,
              db_type: q.db_type ?? "postgresql",
              is_anomaly: q.is_anomaly ?? false,
            };
          });

        const payload: TickPayload = {
          type: "tick",
          timestamp: data.timestamp,
          stats: {
            active: Number(data.stats.active ?? 0),
            anomalies: Number(data.stats.anomalies ?? 0),
            avg_ms: Number(data.stats.avg_ms ?? 0),
            max_ms: Number(data.stats.max_ms ?? 0),
          },
          new_queries: newQueries,
        };

        onTickRef.current?.(payload);
        newQueries.forEach((q) => onNewQueryRef.current?.(q));
      } catch {
        if (!cancelled) {
          setConnected(false);
          onErrorRef.current?.("poll_failed");
        }
      }
    };

    poll();
    const id = setInterval(poll, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { connected, lastTick };
}
