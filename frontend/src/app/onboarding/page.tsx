"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { testConnection, saveConnection } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import { CheckCircle, XCircle, AlertTriangle, Loader, Database, ArrowRight, Info, Zap } from "lucide-react";

type Step = "connect" | "testing" | "result" | "saving" | "done";

const EXAMPLE_URLS = [
  "postgresql://user:password@localhost:5432/mydb",
  "postgresql://readonly:pass@db.example.com:5432/production",
  "mysql://user:password@localhost:3306/mydb",
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const [step, setStep] = useState<Step>("connect");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  if (authLoading || !user) return null;

  const runTest = async () => {
    if (!url.trim()) return;
    setStep("testing");
    setError(null);
    try {
      const result = await testConnection(url);
      setTestResult(result);
      setStep("result");
      if (!name && result.database) setName(result.database);
    } catch {
      setError("Could not reach the server. Is QuerySense backend running?");
      setStep("connect");
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setStep("saving");
    try {
      await saveConnection(name, url);
      setStep("done");
      // Hard reload so React Query starts fresh — no stale cache on arrival
      setTimeout(() => { window.location.href = "/dashboard"; }, 1500);
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "Failed to save connection");
      setStep("result");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: "var(--border-radius-md)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{ maxWidth: 580, margin: "4rem auto", padding: "0 2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Database size={18} color="var(--color-text-success)" />
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Step 1 of 1</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 6px" }}>Connect your database</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
          QuerySense only needs SELECT + EXPLAIN access. Your credentials are encrypted at rest and never shared.
        </p>
      </div>

      {/* Step: Connect / Testing */}
      {(step === "connect" || step === "testing") && (
        <div style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.5rem",
        }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>
            Connection URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runTest()}
            placeholder={EXAMPLE_URLS[0]}
            disabled={step === "testing"}
            style={{ ...inputStyle, marginBottom: 8 }}
          />

          <div style={{ marginBottom: "1rem" }}>
            <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "0 0 4px" }}>Quick examples:</p>
            {EXAMPLE_URLS.map((ex) => (
              <button key={ex} onClick={() => setUrl(ex)} style={{
                display: "block", background: "none", border: "none",
                cursor: "pointer", color: "var(--color-text-tertiary)",
                fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 0", textAlign: "left",
              }}>
                {ex}
              </button>
            ))}
          </div>

          <div style={{
            display: "flex", gap: 6, alignItems: "flex-start",
            padding: "10px 12px",
            background: "var(--color-background-info)",
            borderRadius: "var(--border-radius-md)",
            fontSize: 12, color: "var(--color-text-info)", marginBottom: "1rem",
          }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            We recommend a read-only user. QuerySense never writes to your database during analysis.
          </div>

          {error && (
            <div style={{
              display: "flex", gap: 6, padding: "8px 12px", marginBottom: 12,
              background: "var(--color-background-danger)",
              color: "var(--color-text-danger)",
              borderRadius: "var(--border-radius-md)", fontSize: 13,
            }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {error}
            </div>
          )}

          <button
            onClick={runTest}
            disabled={step === "testing" || !url.trim()}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 20px",
              background: "var(--color-text-primary)", color: "var(--color-background-primary)",
              border: "none", borderRadius: "var(--border-radius-md)",
              cursor: step === "testing" || !url.trim() ? "not-allowed" : "pointer",
              fontSize: 14, fontWeight: 500,
              opacity: step === "testing" || !url.trim() ? 0.7 : 1,
            }}
          >
            {step === "testing"
              ? <><Loader size={14} /> Testing connection...</>
              : <>Test connection <ArrowRight size={14} /></>
            }
          </button>
        </div>
      )}

      {/* Step: Result */}
      {step === "result" && testResult && (
        <div>
          {/* Status banner */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "1rem 1.25rem",
            background: testResult.success ? "var(--color-background-success)" : "var(--color-background-danger)",
            border: `0.5px solid ${testResult.success ? "var(--color-border-success)" : "var(--color-border-danger)"}`,
            borderRadius: "var(--border-radius-lg)", marginBottom: "1rem",
          }}>
            {testResult.success
              ? <CheckCircle size={18} color="var(--color-text-success)" />
              : <XCircle size={18} color="var(--color-text-danger)" />
            }
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: testResult.success ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
                {testResult.success ? "Connection successful" : "Connection failed"}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {testResult.success
                  ? `${testResult.host}:${testResult.port}/${testResult.database}`
                  : testResult.error
                }
              </div>
            </div>
            {testResult.latency_ms != null && (
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
                {testResult.latency_ms}ms
              </div>
            )}
          </div>

          {testResult.success && (
            <>
              {/* Capability checks */}
              <div style={{
                background: "var(--color-background-primary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-lg)",
                padding: "1rem 1.25rem",
                marginBottom: "1rem",
              }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 10px" }}>Capability check</p>
                {[
                  {
                    label: "Read access",
                    ok: testResult.permissions?.can_read,
                    detail: testResult.permissions?.can_read
                      ? `${testResult.permissions.table_count} tables found`
                      : "SELECT permission required",
                  },
                  {
                    label: "EXPLAIN permission",
                    ok: testResult.permissions?.can_explain,
                    detail: "Required for execution plan analysis",
                  },
                  {
                    label: "pg_stat_statements",
                    ok: testResult.pg_stat_statements?.enabled ?? null,
                    detail: testResult.pg_stat_statements?.message ?? "Not applicable for MySQL",
                  },
                  {
                    label: "Ready for monitoring",
                    ok: testResult.ready_for_monitoring,
                    detail: testResult.ready_for_monitoring ? "All checks passed" : "Some features will be limited",
                  },
                ].map(({ label, ok, detail }, i, arr) => (
                  <div key={label} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "8px 0",
                    borderBottom: i < arr.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none",
                  }}>
                    <div style={{ marginTop: 1, flexShrink: 0 }}>
                      {ok === true
                        ? <CheckCircle size={14} color="var(--color-text-success)" />
                        : ok === false
                        ? <XCircle size={14} color="var(--color-text-danger)" />
                        : <AlertTriangle size={14} color="var(--color-text-warning)" />
                      }
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{label}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}>{detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Warnings */}
              {testResult.warnings?.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  {testResult.warnings.map((w: string) => (
                    <div key={w} style={{
                      display: "flex", gap: 6, padding: "10px 12px",
                      background: "var(--color-background-secondary)",
                      borderRadius: "var(--border-radius-md)", fontSize: 12,
                      color: "var(--color-text-secondary)", marginBottom: 6,
                    }}>
                      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: "var(--color-text-warning)" }} />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Name input + save */}
              <div style={{
                background: "var(--color-background-primary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-lg)",
                padding: "1rem 1.25rem",
              }}>
                <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>
                  Name this connection
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Production DB"
                  style={{ ...inputStyle, fontFamily: "inherit", marginBottom: "1rem" }}
                />

                {error && (
                  <div style={{
                    padding: "8px 12px", marginBottom: 12,
                    background: "var(--color-background-danger)",
                    color: "var(--color-text-danger)",
                    borderRadius: "var(--border-radius-md)", fontSize: 13,
                  }}>
                    {error}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleSave}
                    disabled={!name.trim()}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "10px 20px",
                      background: "var(--color-text-primary)", color: "var(--color-background-primary)",
                      border: "none", borderRadius: "var(--border-radius-md)",
                      cursor: !name.trim() ? "not-allowed" : "pointer",
                      fontSize: 14, fontWeight: 500, opacity: !name.trim() ? 0.6 : 1,
                    }}
                  >
                    <Zap size={14} /> Save and start monitoring
                  </button>
                  <button
                    onClick={() => { setStep("connect"); setTestResult(null); setError(null); }}
                    style={{
                      padding: "10px 16px", background: "none",
                      border: "0.5px solid var(--color-border-secondary)",
                      borderRadius: "var(--border-radius-md)",
                      cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)",
                    }}
                  >
                    Try a different URL
                  </button>
                </div>
              </div>
            </>
          )}

          {!testResult.success && (
            <button
              onClick={() => { setStep("connect"); setError(null); }}
              style={{
                padding: "10px 20px", background: "none",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-md)",
                cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)",
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {/* Step: Saving */}
      {step === "saving" && (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--color-text-secondary)" }}>
          <Loader size={24} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14 }}>Saving connection and running first scan...</p>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <div style={{ textAlign: "center", padding: "3rem 0" }}>
          <CheckCircle size={32} color="var(--color-text-success)" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 16, fontWeight: 500, margin: "0 0 6px" }}>You're all set</p>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            Redirecting to your dashboard...
          </p>
        </div>
      )}
    </div>
  );
}
