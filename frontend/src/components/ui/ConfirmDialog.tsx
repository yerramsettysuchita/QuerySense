"use client";
import { AlertTriangle } from "lucide-react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, confirmLabel = "Confirm",
  danger = false, onConfirm, onCancel,
}: Props) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9998,
      padding: "1rem",
    }}>
      <div style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1.5rem",
        maxWidth: 400,
        width: "100%",
      }}>
        <div style={{ display: "flex", gap: 10, marginBottom: "1rem" }}>
          {danger && <AlertTriangle size={18} color="var(--color-text-danger)" style={{ flexShrink: 0, marginTop: 2 }} />}
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 6px" }}>{title}</h3>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>{message}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              background: "none",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              background: danger ? "var(--color-background-danger)" : "var(--color-text-primary)",
              color: danger ? "var(--color-text-danger)" : "var(--color-background-primary)",
              border: danger ? "0.5px solid var(--color-border-danger)" : "none",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
