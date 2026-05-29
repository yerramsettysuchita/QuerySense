"use client";
import { useEffect, useState } from "react";

interface Props {
  beforeMs: number;
  afterMs: number;
  label?: string;
  animateOnMount?: boolean;
}

function useCountUp(target: number, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay]);

  return value;
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function ImpactMeter({ beforeMs, afterMs, label, animateOnMount = true }: Props) {
  const improvement = Math.max(0, Math.round(((beforeMs - afterMs) / beforeMs) * 100));
  const displayBefore = useCountUp(animateOnMount ? beforeMs : beforeMs, 1000, 0);
  const displayAfter = useCountUp(animateOnMount ? afterMs : afterMs, 1000, 300);
  const displayPct = useCountUp(animateOnMount ? improvement : improvement, 1200, 600);

  return (
    <div style={{
      display: "flex",
      alignItems: "stretch",
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      overflow: "hidden",
    }}>
      <div style={{ flex: 1, padding: "1.25rem", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6, letterSpacing: "0.06em" }}>BEFORE</div>
        <div style={{ fontSize: 34, fontWeight: 500, fontFamily: "var(--font-mono)", color: "#e24b4a", lineHeight: 1, marginBottom: 4 }}>
          {fmt(displayBefore)}
        </div>
        {label && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{label}</div>}
      </div>

      <div style={{ padding: "0 6px", display: "flex", alignItems: "center", color: "var(--color-text-tertiary)", fontSize: 20, flexShrink: 0 }}>
        →
      </div>

      <div style={{ flex: 1, padding: "1.25rem", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6, letterSpacing: "0.06em" }}>AFTER</div>
        <div style={{ fontSize: 34, fontWeight: 500, fontFamily: "var(--font-mono)", color: "#639922", lineHeight: 1, marginBottom: 4 }}>
          {fmt(displayAfter)}
        </div>
        {label && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{label}</div>}
      </div>

      <div style={{
        background: "var(--color-background-success)",
        borderLeft: "0.5px solid var(--color-border-success)",
        padding: "1.25rem 1.75rem",
        textAlign: "center",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}>
        <div style={{ fontSize: 11, color: "var(--color-text-success)", marginBottom: 6, letterSpacing: "0.06em" }}>FASTER</div>
        <div style={{ fontSize: 34, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--color-text-success)", lineHeight: 1 }}>
          {displayPct}%
        </div>
      </div>
    </div>
  );
}
