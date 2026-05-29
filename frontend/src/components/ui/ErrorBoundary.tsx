"use client";
import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface State {
  hasError: boolean;
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div style={{
        padding: "3rem 2rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        textAlign: "center",
      }}>
        <AlertTriangle size={28} color="var(--color-text-danger)" />
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, margin: "0 0 6px", color: "var(--color-text-primary)" }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 13, margin: "0 0 20px", color: "var(--color-text-secondary)", maxWidth: 400 }}>
            {this.state.error?.message ?? "An unexpected error occurred in this component."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 16px",
              background: "none",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--color-text-secondary)",
            }}
          >
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      </div>
    );
  }
}
