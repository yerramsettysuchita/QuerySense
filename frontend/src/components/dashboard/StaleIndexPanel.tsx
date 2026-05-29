import { StaleIndexReport } from "@/lib/api";
import { Trash2 } from "lucide-react";

interface Props { report: StaleIndexReport | null }

export default function StaleIndexPanel({ report }: Props) {
  if (!report) return null;
  const { summary, postgres } = report;

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1.25rem",
    }}>
      <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 1rem" }}>Index health</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: "1rem" }}>
        {[
          { label: "Unused", value: summary.total_unused, color: "var(--color-text-danger)" },
          { label: "Bloated", value: summary.total_bloated, color: "var(--color-text-warning)" },
          { label: "Duplicate", value: summary.total_duplicate, color: "var(--color-text-warning)" },
          { label: "Wasted MB", value: summary.wasted_mb, color: "var(--color-text-secondary)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color }}>{value}</div>
          </div>
        ))}
      </div>

      {postgres.stale.slice(0, 4).map((idx) => (
        <div key={idx.index} style={{
          borderTop: "0.5px solid var(--color-border-tertiary)",
          padding: "8px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}>
          <div style={{ minWidth: 0 }}>
            <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {idx.index}
            </code>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{idx.table} · {idx.size}</span>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(`DROP INDEX CONCURRENTLY ${idx.index};`)}
            title="Copy DROP INDEX SQL"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: 4, flexShrink: 0 }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
