"use client";
import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

let toastCounter = 0;
let globalAddToast: ((toast: Omit<ToastMessage, "id">) => void) | null = null;

export function toast(payload: Omit<ToastMessage, "id">) {
  globalAddToast?.(payload);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    globalAddToast = (payload) => {
      const id = ++toastCounter;
      setToasts((prev) => [...prev, { ...payload, id }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, payload.duration ?? 4000);
    };
    return () => { globalAddToast = null; };
  }, []);

  const remove = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const icon = {
    success: <CheckCircle size={16} color="var(--color-text-success)" />,
    error: <XCircle size={16} color="var(--color-text-danger)" />,
    warning: <AlertTriangle size={16} color="var(--color-text-warning)" />,
    info: <Info size={16} color="var(--color-text-info)" />,
  };

  const bg = {
    success: "var(--color-background-success)",
    error: "var(--color-background-danger)",
    warning: "var(--color-background-warning)",
    info: "var(--color-background-info)",
  };

  const border = {
    success: "var(--color-border-success)",
    error: "var(--color-border-danger)",
    warning: "var(--color-border-warning)",
    info: "var(--color-border-info)",
  };

  if (!toasts.length) return null;

  return (
    <div style={{
      position: "fixed",
      top: 24,
      right: 24,
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      maxWidth: 360,
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          display: "flex",
          gap: 10,
          padding: "12px 14px",
          background: bg[t.type],
          border: `0.5px solid ${border[t.type]}`,
          borderRadius: "var(--border-radius-lg)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          animation: "slideIn 0.2s ease",
        }}>
          <div style={{ flexShrink: 0, marginTop: 1 }}>{icon[t.type]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
              {t.title}
            </div>
            {t.message && (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.4 }}>
                {t.message}
              </div>
            )}
          </div>
          <button
            onClick={() => remove(t.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: 0, flexShrink: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
