"use client";
import { useEffect, useRef } from "react";

interface DataPoint {
  timestamp: number;
  value: number;
  is_anomaly?: boolean;
}

interface Series {
  id: string;
  label: string;
  color: string;
  data: DataPoint[];
}

interface Props {
  series: Series[];
  width?: number;
  height?: number;
  showGrid?: boolean;
}

export default function PerformanceTimeline({
  series,
  width = 680,
  height = 160,
  showGrid = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !series.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pad = { top: 12, right: 12, bottom: 24, left: 48 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;

    const allValues = series.flatMap((s) => s.data.map((d) => d.value));
    const allTimes = series.flatMap((s) => s.data.map((d) => d.timestamp));
    if (!allValues.length) return;

    const maxVal = Math.max(...allValues) * 1.1 || 100;
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes) || minTime + 1;

    const xScale = (t: number) => pad.left + ((t - minTime) / (maxTime - minTime || 1)) * w;
    const yScale = (v: number) => pad.top + h - (v / maxVal) * h;

    if (showGrid) {
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (h / 4) * i;
        ctx.strokeStyle = "rgba(128,128,128,0.08)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + w, y);
        ctx.stroke();

        const val = maxVal - (maxVal / 4) * i;
        ctx.fillStyle = "rgba(128,128,128,0.45)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(val >= 1000 ? `${(val / 1000).toFixed(1)}s` : `${Math.round(val)}ms`, pad.left - 4, y);
      }
    }

    for (const s of series) {
      if (s.data.length < 2) continue;

      // Anomaly highlights
      for (const point of s.data) {
        if (point.is_anomaly) {
          ctx.fillStyle = "rgba(226,75,74,0.06)";
          ctx.fillRect(xScale(point.timestamp) - 3, pad.top, 6, h);
        }
      }

      // Area
      ctx.beginPath();
      ctx.moveTo(xScale(s.data[0].timestamp), yScale(0));
      for (const p of s.data) ctx.lineTo(xScale(p.timestamp), yScale(p.value));
      ctx.lineTo(xScale(s.data[s.data.length - 1].timestamp), yScale(0));
      ctx.closePath();
      ctx.fillStyle = `${s.color}18`;
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.moveTo(xScale(s.data[0].timestamp), yScale(s.data[0].value));
      for (let i = 1; i < s.data.length; i++) {
        ctx.lineTo(xScale(s.data[i].timestamp), yScale(s.data[i].value));
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();

      // Anomaly dots
      for (const p of s.data) {
        if (p.is_anomaly) {
          ctx.beginPath();
          ctx.arc(xScale(p.timestamp), yScale(p.value), 4, 0, Math.PI * 2);
          ctx.fillStyle = "#e24b4a";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Axis
    ctx.strokeStyle = "rgba(128,128,128,0.15)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + h);
    ctx.lineTo(pad.left + w, pad.top + h);
    ctx.stroke();
  }, [series, width, height, showGrid]);

  return <canvas ref={canvasRef} style={{ borderRadius: "var(--border-radius-md)", display: "block" }} />;
}
