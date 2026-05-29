import Link from "next/link";
import { Database, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--color-background-primary)",
    }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: "2rem" }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 48,
          height: 48,
          borderRadius: "var(--border-radius-lg)",
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          marginBottom: "1.5rem",
        }}>
          <Database size={20} color="var(--color-text-tertiary)" />
        </div>

        <div style={{
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-tertiary)",
          marginBottom: 12,
          letterSpacing: "0.05em",
        }}>
          404
        </div>

        <h1 style={{
          fontSize: 22,
          fontWeight: 500,
          margin: "0 0 10px",
          letterSpacing: "-0.01em",
        }}>
          Page not found
        </h1>

        <p style={{
          fontSize: 14,
          color: "var(--color-text-secondary)",
          margin: "0 0 2rem",
          lineHeight: 1.6,
        }}>
          This page does not exist or has been moved.
        </p>

        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 18px",
            background: "var(--color-text-primary)",
            color: "var(--color-background-primary)",
            borderRadius: "var(--border-radius-md)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Back to home <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
