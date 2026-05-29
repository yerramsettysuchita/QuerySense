import { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  label: string;
  value: string | number;
  danger?: boolean;
  success?: boolean;
  warning?: boolean;
}

export default function MetricCard({ icon, label, value, danger, success, warning }: Props) {
  const statusColor = danger  ? "var(--color-text-danger)"
    : success ? "var(--color-text-success)"
    : warning ? "var(--color-text-warning)"
    : "var(--color-text-primary)";

  const iconBg = danger  ? "var(--color-background-danger)"
    : success ? "var(--color-background-success)"
    : warning ? "var(--color-background-warning)"
    : "var(--color-background-primary)";

  const iconColor = danger  ? "var(--color-text-danger)"
    : success ? "var(--color-text-success)"
    : warning ? "var(--color-text-warning)"
    : "var(--color-text-secondary)";

  return (
    <div style={{
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1.25rem",
      border: "0.5px solid var(--color-border-tertiary)",
      boxShadow: "var(--shadow-sm)",
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          letterSpacing: "0.01em",
          textTransform: "uppercase",
        }}>
          {label}
        </span>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: "var(--border-radius-md)",
          background: iconBg,
          border: `0.5px solid ${danger ? "var(--color-border-danger)" : success ? "var(--color-border-success)" : warning ? "var(--color-border-warning)" : "var(--color-border-tertiary)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: iconColor,
          flexShrink: 0,
        }}>
          {icon}
        </div>
      </div>
      <div style={{
        fontSize: 32,
        fontWeight: 600,
        color: statusColor,
        lineHeight: 1,
        letterSpacing: "-0.02em",
      }}>
        {value}
      </div>
    </div>
  );
}
