"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SlowQuery } from "@/lib/api";

interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  query: SlowQuery;
  pulsePhase: number;
}

interface Props {
  queries: SlowQuery[];
  width?: number;
  height?: number;
}

function severityColor(q: SlowQuery): { fill: string; stroke: string; text: string; shadow: string } {
  if (q.is_anomaly)              return { fill: "#FEE2E2", stroke: "#EF4444", text: "#B91C1C", shadow: "rgba(239,68,68,0.35)" };
  if (q.avg_exec_time_ms > 2000) return { fill: "#FEF3C7", stroke: "#F59E0B", text: "#B45309", shadow: "rgba(245,158,11,0.30)" };
  if (q.avg_exec_time_ms > 800)  return { fill: "#DCFCE7", stroke: "#22C55E", text: "#15803D", shadow: "rgba(34,197,94,0.28)" };
  return                                { fill: "#DBEAFE", stroke: "#3B82F6", text: "#1D4ED8", shadow: "rgba(59,130,246,0.25)" };
}

function nodeRadius(q: SlowQuery): number {
  const base = Math.log10(Math.max(q.avg_exec_time_ms, 10)) * 15;
  return Math.min(Math.max(base, 20), 58);
}

export default function QueryUniverse({ queries, width = 680, height = 420 }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  const nodesRef    = useRef<Node[]>([]);
  const animRef     = useRef<number>(0);
  const router      = useRouter();
  const [hovered, setHovered]       = useState<SlowQuery | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const tickRef     = useRef(0);
  const [canvasW, setCanvasW]       = useState(width);

  // Respond to container resize
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w > 0) setCanvasW(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    nodesRef.current = queries.map((q, i) => {
      const angle = (i / queries.length) * Math.PI * 2;
      const dist  = 80 + Math.random() * 130;
      return {
        id: q.id,
        x: canvasW / 2 + Math.cos(angle) * dist,
        y: height / 2 + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: nodeRadius(q),
        query: q,
        pulsePhase: Math.random() * Math.PI * 2,
      };
    });
  }, [queries, canvasW, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvasW * dpr;
    canvas.height = height  * dpr;
    canvas.style.width  = `${canvasW}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const draw = () => {
      tickRef.current++;
      ctx.clearRect(0, 0, canvasW, height);

      const nodes = nodesRef.current;
      const cx = canvasW / 2;
      const cy = height  / 2;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.vx += (cx - n.x) * 0.0004;
        n.vy += (cy - n.y) * 0.0004;

        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dx = n.x - m.x, dy = n.y - m.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minD = n.radius + m.radius + 18;
          if (dist < minD) {
            const f = ((minD - dist) / dist) * 0.09;
            n.vx += dx * f; n.vy += dy * f;
            m.vx -= dx * f; m.vy -= dy * f;
          }
        }

        n.vx *= 0.91; n.vy *= 0.91;
        n.x = Math.max(n.radius + 10, Math.min(canvasW - n.radius - 10, n.x + n.vx));
        n.y = Math.max(n.radius + 10, Math.min(height  - n.radius - 10, n.y + n.vy));
      }

      // Soft connector lines between anomalies
      const anomalies = nodes.filter(n => n.query.is_anomaly);
      if (anomalies.length > 1) {
        for (let i = 0; i < anomalies.length - 1; i++) {
          const a = anomalies[i], b = anomalies[i + 1];
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(239,68,68,${0.10 + 0.06 * Math.sin(tickRef.current * 0.03 + i)})`;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      for (const node of nodes) {
        const { fill, stroke, text, shadow } = severityColor(node.query);
        const isHovered = hovered?.id === node.query.id;
        const isAnomaly = node.query.is_anomaly;
        const isSlow    = node.query.avg_exec_time_ms > 2000;

        const pulse = isAnomaly
          ? 0.93 + 0.07 * Math.sin(tickRef.current * 0.06 + node.pulsePhase)
          : isSlow
          ? 0.96 + 0.04 * Math.sin(tickRef.current * 0.04 + node.pulsePhase)
          : 1;

        const r = node.radius * pulse;

        // Outer glow / shadow
        const glowR = r + (isAnomaly ? 14 : 10) + 4 * Math.sin(tickRef.current * 0.05 + node.pulsePhase);
        const grd = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, glowR);
        grd.addColorStop(0, shadow);
        grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Ball with gradient (light at top-left)
        const ballGrd = ctx.createRadialGradient(
          node.x - r * 0.28, node.y - r * 0.28, r * 0.05,
          node.x, node.y, r
        );
        ballGrd.addColorStop(0, "#ffffff");
        ballGrd.addColorStop(0.35, fill);
        ballGrd.addColorStop(1, lighten(fill, -18));
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = ballGrd;
        ctx.fill();

        // Border
        ctx.strokeStyle = isHovered ? stroke : stroke + "bb";
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.stroke();

        // Highlight gloss
        const gloss = ctx.createRadialGradient(
          node.x - r * 0.25, node.y - r * 0.35, r * 0.02,
          node.x - r * 0.1,  node.y - r * 0.1,  r * 0.65
        );
        gloss.addColorStop(0, "rgba(255,255,255,0.55)");
        gloss.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = gloss;
        ctx.fill();

        // Label text
        ctx.fillStyle = text;
        ctx.font = `600 ${Math.max(10, r * 0.34)}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = node.query.avg_exec_time_ms >= 1000
          ? `${(node.query.avg_exec_time_ms / 1000).toFixed(1)}s`
          : `${Math.round(node.query.avg_exec_time_ms)}ms`;
        ctx.fillText(label, node.x, node.y);

        // Anomaly badge
        if (isAnomaly) {
          const bx = node.x + r * 0.58, by = node.y - r * 0.58;
          ctx.beginPath();
          ctx.arc(bx, by, 7, 0, Math.PI * 2);
          ctx.fillStyle = "#EF4444";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.font = "bold 9px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("!", bx, by);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [queries, canvasW, height, hovered]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = nodesRef.current.find(n => {
      const dx = mx - n.x, dy = my - n.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius;
    });
    setHovered(hit?.query ?? null);
    setTooltipPos({ x: mx, y: my });
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = nodesRef.current.find(n => {
      const dx = mx - n.x, dy = my - n.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius;
    });
    if (hit) router.push(`/dashboard/query/${hit.query.id}`);
  }, [router]);

  if (!queries.length) return null;

  return (
    <div ref={wrapRef} className="qs-universe-wrap" style={{ position: "relative", width: "100%", height }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        onClick={handleClick}
        style={{ cursor: hovered ? "pointer" : "default", borderRadius: "var(--border-radius-lg)", display: "block" }}
      />

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 10, left: 12,
        display: "flex", gap: 12, fontSize: 11,
        color: "var(--color-text-tertiary)", flexWrap: "wrap", alignItems: "center",
      }}>
        {[
          { fill: "#FEE2E2", stroke: "#EF4444", label: "Anomaly" },
          { fill: "#FEF3C7", stroke: "#F59E0B", label: ">2000ms" },
          { fill: "#DCFCE7", stroke: "#22C55E", label: ">800ms"  },
          { fill: "#DBEAFE", stroke: "#3B82F6", label: "Slow"    },
        ].map(({ fill, stroke, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 11, height: 11, borderRadius: "50%",
              background: fill, border: `1.5px solid ${stroke}`,
              boxShadow: `0 0 4px ${stroke}55`,
            }} />
            <span>{label}</span>
          </div>
        ))}
        <span style={{ opacity: 0.6 }}>· size = exec time · click to analyze</span>
      </div>

      {/* Tooltip */}
      {hovered && (
        <div style={{
          position: "absolute",
          left: Math.min(tooltipPos.x + 14, canvasW - 220),
          top: Math.max(tooltipPos.y - 100, 4),
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: "10px 14px",
          fontSize: 12,
          pointerEvents: "none",
          minWidth: 200,
          zIndex: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#0f172a", fontSize: 13 }}>
            {hovered.is_anomaly && <span style={{ color: "#EF4444", marginRight: 5 }}>⚠</span>}
            {hovered.query_fingerprint}
          </div>
          <div style={{ color: "#475569", lineHeight: 1.75, fontSize: 12 }}>
            <div>Avg: <strong style={{ color: "#0f172a" }}>{hovered.avg_exec_time_ms.toFixed(0)} ms</strong></div>
            <div>Calls: <strong style={{ color: "#0f172a" }}>{hovered.calls.toLocaleString()}</strong></div>
            <div>DB: <strong style={{ color: "#0f172a" }}>{hovered.db_type}</strong></div>
            {hovered.is_anomaly && (
              <div style={{ color: "#EF4444", marginTop: 4, fontWeight: 500 }}>⚠ Anomaly detected</div>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>Click to analyze →</div>
        </div>
      )}
    </div>
  );
}

// Slightly darken a hex color for the gradient bottom
function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
