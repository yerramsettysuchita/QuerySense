import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";

export interface PulseData {
  timestamp: number;
  stats: {
    active: number;
    anomalies: number;
    avg_ms: number;
    max_ms: number;
    total: number;
  };
  recent: {
    id: string;
    query_fingerprint: string;
    avg_exec_time_ms: number;
    is_anomaly: boolean;
    detected_at: string;
  }[];
}

export function usePulse(intervalMs = 10000) {
  const [data, setData] = useState<PulseData | null>(null);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = async () => {
    try {
      const r = await api.get<PulseData>("/api/v1/stream/pulse");
      setData(r.data);
      setError(false);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalMs]);

  return { data, error };
}
