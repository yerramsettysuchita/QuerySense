import React from "react";

const shimmerStyle: React.CSSProperties = {
  background: "linear-gradient(90deg, var(--color-background-secondary) 25%, var(--color-border-tertiary) 50%, var(--color-background-secondary) 75%)",
  backgroundSize: "800px 100%",
  animation: "shimmer 1.5s infinite linear",
  borderRadius: "var(--border-radius-md)",
};

interface BoxProps {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}

export function SkeletonBox({ width = "100%", height = 16, style }: BoxProps) {
  return <div style={{ ...shimmerStyle, width, height, ...style }} />;
}

export function SkeletonCard() {
  return (
    <div style={{
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "1rem",
    }}>
      <SkeletonBox width={80} height={12} style={{ marginBottom: 12 }} />
      <SkeletonBox width={60} height={28} />
    </div>
  );
}

export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 12,
      padding: "12px 0",
      borderBottom: "0.5px solid var(--color-border-tertiary)",
    }}>
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBox key={i} height={12} width={i === 0 ? "70%" : "50%"} />
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox key={i} height={12} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

export function SkeletonCanvas({ width = "100%", height = 360 }: { width?: string | number; height?: number }) {
  return (
    <div style={{
      ...shimmerStyle,
      width,
      height,
      borderRadius: "var(--border-radius-lg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", opacity: 0.6 }}>
        Loading query universe...
      </span>
    </div>
  );
}

export function SkeletonMetricCards({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
