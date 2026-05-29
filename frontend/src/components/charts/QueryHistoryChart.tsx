"use client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { format } from "date-fns";

interface HistoryPoint {
  exec_time_ms: number;
  recorded_at: string;
}

interface Props {
  data: HistoryPoint[];
  avgMs: number;
}

function fmtMs(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
}

export default function QueryHistoryChart({ data, avgMs }: Props) {
  if (!data.length) return null;

  // Use time-only label when all samples are on the same calendar day
  const dates = data.map((p) => new Date(p.recorded_at));
  const firstDay = format(dates[0], "MMM d");
  const allSameDay = dates.every((d) => format(d, "MMM d") === firstDay);
  const points = data.map((p, i) => ({
    ms: Math.round(p.exec_time_ms),
    time: allSameDay
      ? format(dates[i], "HH:mm")
      : format(dates[i], "MMM d HH:mm"),
  }));

  const maxMs = Math.max(...points.map((p) => p.ms));
  const minMs = Math.min(...points.map((p) => p.ms));
  const trend = points.length >= 2 ? points[points.length - 1].ms - points[0].ms : 0;
  const trendPct = points[0].ms > 0 ? (trend / points[0].ms) * 100 : 0;

  // Pad domain so the line isn't squished against top/bottom edges
  const pad = Math.max((maxMs - minMs) * 0.25, maxMs * 0.08, 50);
  const yMin = Math.max(0, Math.floor(minMs - pad));
  const yMax = Math.ceil(maxMs + pad);

  const fewSamples = points.length <= 8;

  return (
    <div>
      {/* Stats row */}
      <div style={{ display: "flex", gap: 20, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { label: "Min", value: fmtMs(minMs), color: "var(--color-text-success)" },
          { label: "Avg", value: fmtMs(Math.round(avgMs)), color: "var(--color-text-warning)" },
          { label: "Max", value: fmtMs(maxMs), color: "var(--color-text-danger)" },
          {
            label: "Trend",
            value: `${trendPct > 0 ? "+" : ""}${trendPct.toFixed(0)}%`,
            color: trendPct > 10 ? "var(--color-text-danger)" : trendPct < -10 ? "var(--color-text-success)" : "var(--color-text-secondary)",
          },
          { label: "Samples", value: String(data.length), color: "var(--color-text-primary)" },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 24 }}>
          <CartesianGrid
            strokeDasharray="0"
            vertical={false}
            stroke="var(--color-border-tertiary)"
            strokeOpacity={0.6}
          />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: "var(--color-text-tertiary)" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            angle={-30}
            textAnchor="end"
            height={36}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 9, fill: "var(--color-text-tertiary)" }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={fmtMs}
            tickCount={4}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 6,
              fontSize: 11,
              boxShadow: "var(--shadow-md)",
            }}
            formatter={(v: number) => [fmtMs(v), "Exec time"]}
            labelStyle={{ color: "var(--color-text-tertiary)", marginBottom: 4 }}
          />
          <Line
            type="monotone"
            dataKey="ms"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={fewSamples ? { r: 3, fill: "#3B82F6", strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: "#3B82F6", stroke: "#fff", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
