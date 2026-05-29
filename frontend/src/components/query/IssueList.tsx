import { Issue } from "@/lib/api";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

export default function IssueList({ issues }: { issues: Issue[] }) {
  const iconMap = {
    high: <AlertTriangle size={13} color="var(--color-text-danger)" />,
    medium: <AlertCircle size={13} color="var(--color-text-warning)" />,
    low: <Info size={13} color="var(--color-text-info)" />,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {issues.map((issue, i) => (
        <div key={i} style={{
          display: "flex",
          gap: 10,
          padding: "10px 14px",
          background: issue.severity === "high"
            ? "var(--color-background-danger)"
            : issue.severity === "medium"
            ? "var(--color-background-warning)"
            : "var(--color-background-info)",
          borderRadius: "var(--border-radius-md)",
          fontSize: 13,
        }}>
          <div style={{ marginTop: 1, flexShrink: 0 }}>{iconMap[issue.severity]}</div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 2, color: "var(--color-text-primary)" }}>
              {issue.type.replace(/_/g, " ")}
              {issue.table && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, marginLeft: 6, color: "var(--color-text-secondary)" }}>
                  · {issue.table}
                </span>
              )}
            </div>
            <div style={{ color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{issue.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
