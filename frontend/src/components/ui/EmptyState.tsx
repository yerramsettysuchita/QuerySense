import React from "react";
import Link from "next/link";

interface Action {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}

interface Props {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions?: Action[];
}

export default function EmptyState({ icon, title, description, actions }: Props) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "3rem 2rem",
      textAlign: "center",
      gap: 0,
    }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 16,
        color: "var(--color-text-tertiary)",
      }}>
        {icon}
      </div>
      <p style={{ fontSize: 15, fontWeight: 500, margin: "0 0 8px", color: "var(--color-text-primary)" }}>
        {title}
      </p>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 24px", maxWidth: 360, lineHeight: 1.6 }}>
        {description}
      </p>
      {actions && actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {actions.map((action) => {
            const buttonStyle: React.CSSProperties = action.variant === "secondary" ? {
              padding: "8px 18px",
              background: "none",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--color-text-secondary)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            } : {
              padding: "8px 18px",
              background: "var(--color-text-primary)",
              border: "none",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-background-primary)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            };

            if (action.href) {
              return (
                <Link key={action.label} href={action.href} style={buttonStyle}>
                  {action.label}
                </Link>
              );
            }
            return (
              <button key={action.label} onClick={action.onClick} style={buttonStyle}>
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
