"use client";
import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Brain, CheckCircle, Loader, Wrench } from "lucide-react";

interface AgentResult {
  decision: string;
  reasoning: string;
  actions_taken: string; // JSON string array
  outcome: string;
}

interface Props {
  slowQueryId: string;
  running: boolean;
  onComplete?: (conclusion: string) => void;
}

const DECISION_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  apply:    { bg: "var(--color-background-success)", border: "var(--color-border-success)", text: "var(--color-text-success)", label: "Index Applied" },
  escalate: { bg: "var(--color-background-warning)", border: "var(--color-border-warning)", text: "var(--color-text-warning)", label: "Needs Review" },
  monitor:  { bg: "var(--color-background-info)",    border: "var(--color-border-info)",    text: "var(--color-text-info)",    label: "Monitoring" },
  analyzed: { bg: "var(--color-background-info)",    border: "var(--color-border-info)",    text: "var(--color-text-info)",    label: "Analyzed" },
};

function parseActions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return raw ? [raw] : [];
  }
}

function ToolIcon({ name }: { name: string }) {
  return <Wrench size={11} color="var(--color-text-warning)" style={{ flexShrink: 0 }} />;
}

export default function AgentTrace({ slowQueryId, running, onComplete }: Props) {
  const [result, setResult] = useState<AgentResult | null>(null);
  const [dots, setDots] = useState(".");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  // Animate the thinking dots
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 500);
    return () => clearInterval(id);
  }, [running]);

  // Load persisted result on mount
  useEffect(() => {
    api.get(`/api/v1/agent/result/${slowQueryId}`)
      .then((r) => {
        if (r.data.status === "complete" && !completedRef.current) {
          setResult(r.data);
        }
      })
      .catch(() => {});
  }, [slowQueryId]);

  // Poll while running
  useEffect(() => {
    if (!running) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    completedRef.current = false;
    let attempts = 0;

    const check = async () => {
      attempts++;
      if (attempts > 60) { // ~2 min hard stop at 2s interval
        clearInterval(pollRef.current!);
        pollRef.current = null;
        onComplete?.("Agent timed out — check results later");
        return;
      }
      try {
        const r = await api.get(`/api/v1/agent/result/${slowQueryId}`);
        if (r.data.status === "complete" && !completedRef.current) {
          completedRef.current = true;
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setResult(r.data);
          onComplete?.(r.data.reasoning || r.data.outcome || "Complete");
        }
      } catch { /* ignore */ }
    };

    // First check after 1s so fast agents reset the button quickly
    const firstCheck = setTimeout(check, 1000);
    pollRef.current = setInterval(check, 2000);

    return () => {
      clearTimeout(firstCheck);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [running, slowQueryId]);

  // Nothing to show yet
  if (!running && !result) return null;

  const decisionKey = result?.decision?.toLowerCase() ?? "analyzed";
  const colors = DECISION_COLORS[decisionKey] ?? DECISION_COLORS.analyzed;
  const actions = result ? parseActions(result.actions_taken) : [];

  return (
    <div style={{
      background: "var(--color-background-secondary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      overflow: "hidden",
      marginTop: "1.5rem",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 16px",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--color-background-primary)",
      }}>
        <Brain size={14} color="var(--color-text-info)" />
        <span style={{ fontSize: 13, fontWeight: 500 }}>Agent trace</span>
        {running ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", fontSize: 12, color: "var(--color-text-secondary)" }}>
            <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />
            thinking{dots}
          </div>
        ) : result ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 500, padding: "2px 8px",
              borderRadius: 20, background: colors.bg, color: colors.text,
              border: `0.5px solid ${colors.border}`,
            }}>
              {colors.label}
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ padding: "8px 0" }}>
        {/* Running state — animated steps */}
        {running && (
          <div style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {["Fetching query execution plan", "Checking table statistics", "Evaluating index opportunities", "Running benchmark on shadow DB"].map((step, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                  color: "var(--color-text-secondary)",
                  animation: `fadeIn 0.3s ease ${i * 0.15}s both`,
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "var(--color-text-info)",
                    animation: `pulse 1.4s ease-in-out ${i * 0.35}s infinite`,
                  }} />
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed — tool list */}
        {!running && result && actions.length > 0 && (
          <div style={{ padding: "4px 0" }}>
            {actions.map((action, i) => (
              <div key={i} style={{
                padding: "7px 16px",
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 12,
              }}>
                <ToolIcon name={action} />
                <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-warning)" }}>
                  {action}
                </code>
                <CheckCircle size={11} color="var(--color-text-success)" style={{ marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        )}

        {/* Conclusion */}
        {!running && result?.reasoning && (
          <div style={{
            margin: "8px 16px 8px",
            padding: "12px 14px",
            background: colors.bg,
            border: `0.5px solid ${colors.border}`,
            borderRadius: "var(--border-radius-md)",
            fontSize: 13,
            color: colors.text,
            lineHeight: 1.65,
            display: "flex", gap: 8,
          }}>
            <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{result.reasoning}</span>
          </div>
        )}

        {/* Outcome note */}
        {!running && result?.outcome && (
          <div style={{ padding: "0 16px 10px", fontSize: 11, color: "var(--color-text-tertiary)" }}>
            {result.outcome}
          </div>
        )}
      </div>
    </div>
  );
}
