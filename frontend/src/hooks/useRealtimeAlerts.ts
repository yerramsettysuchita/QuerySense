import { useEffect, useRef } from "react";
import { wsClient } from "@/lib/ws";

export type AlertEvent = {
  type: "anomaly_detected" | "slow_query_found" | "benchmark_complete";
  payload: Record<string, unknown>;
  timestamp: number;
};

type Handler = (event: AlertEvent) => void;

export function useRealtimeAlerts(onAlert: Handler) {
  const handlerRef = useRef(onAlert);
  handlerRef.current = onAlert;

  useEffect(() => {
    const handleAnomaly = (data: Record<string, unknown>) => {
      handlerRef.current({ type: "anomaly_detected", payload: data, timestamp: Date.now() });
    };
    const handleSlowQuery = (data: Record<string, unknown>) => {
      handlerRef.current({ type: "slow_query_found", payload: data, timestamp: Date.now() });
    };
    const handleBenchmark = (data: Record<string, unknown>) => {
      handlerRef.current({ type: "benchmark_complete", payload: data, timestamp: Date.now() });
    };

    wsClient.connect("global");
    wsClient.on("anomaly_detected", handleAnomaly);
    wsClient.on("slow_query_found", handleSlowQuery);
    wsClient.on("benchmark_complete", handleBenchmark);

    return () => {
      wsClient.off("anomaly_detected", handleAnomaly);
      wsClient.off("slow_query_found", handleSlowQuery);
      wsClient.off("benchmark_complete", handleBenchmark);
    };
  }, []);
}
