"use client";
import { BenchmarkHistory } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface Props { data: BenchmarkHistory[] }

export default function LatencyChart({ data }: Props) {
  if (!data.length) {
    return (
      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
        No benchmark data yet
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.title.slice(0, 20),
    before: Math.round(d.before_ms),
    after: Math.round(d.after_ms),
    pct: Math.round(d.improvement_pct),
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} barGap={2} barCategoryGap="30%">
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} axisLine={false} tickLine={false} unit="ms" />
        <Tooltip
          contentStyle={{
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(val: number, name: string) => [`${val}ms`, name === "before" ? "Before" : "After"]}
        />
        <Bar dataKey="before" fill="var(--color-border-secondary)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="after" radius={[3, 3, 0, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill="var(--color-text-success)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
