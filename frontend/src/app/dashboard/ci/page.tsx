"use client";
import { useState } from "react";
import { ciCheck, CIResult } from "@/lib/api";
import { CheckCircle, XCircle, Play, Loader, Copy } from "lucide-react";

const GITHUB_SNIPPET = `# .github/workflows/query-check.yml
name: QuerySense CI Check
on: [pull_request]
jobs:
  query-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check query performance
        run: |
          curl -sf -X POST \${{ secrets.QUERYSENSE_URL }}/api/v1/ci/check \\
            -H "Content-Type: application/json" \\
            -d '{"query":"YOUR_QUERY_HERE","fail_on_seq_scan":true}' \\
            | python3 -c "
          import json,sys
          r=json.load(sys.stdin)
          print('Badge:', r['badge'])
          sys.exit(0 if r['passed'] else 1)
          "`;

export default function CIPage() {
  const [query, setQuery] = useState("SELECT u.name, u.email, w.name AS workspace FROM users u JOIN workspace_members wm ON u.id = wm.user_id JOIN workspaces w ON wm.workspace_id = w.id WHERE u.is_active = true");
  const [dbType, setDbType] = useState("postgresql");
  const [failSeqScan, setFailSeqScan] = useState(true);
  const [failMissingIndex, setFailMissingIndex] = useState(true);
  const [thresholdMs, setThresholdMs] = useState(1000);
  const [context, setContext] = useState("PR-001");
  const [result, setResult] = useState<CIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await ciCheck({
        query,
        db_type: dbType,
        fail_on_seq_scan: failSeqScan,
        fail_threshold_ms: thresholdMs,
        context,
      });
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(GITHUB_SNIPPET);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>CI/CD integration</h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: "0 0 2rem" }}>
        Catch slow queries before they reach production. Integrate with any CI pipeline via REST.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Config panel */}
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 1rem" }}>Check configuration</p>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Query</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                padding: "10px 12px",
                background: "var(--color-background-secondary)",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-md)",
                color: "var(--color-text-primary)",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Database type</label>
              <select
                value={dbType}
                onChange={(e) => setDbType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--color-background-secondary)",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: "var(--border-radius-md)",
                  color: "var(--color-text-primary)",
                  fontSize: 13,
                }}
              >
                <option value="postgresql">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Context (PR / branch)</label>
              <input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--color-background-secondary)",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: "var(--border-radius-md)",
                  color: "var(--color-text-primary)",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
              Threshold: {thresholdMs}ms
            </label>
            <input
              type="range"
              min={100}
              max={5000}
              step={100}
              value={thresholdMs}
              onChange={(e) => setThresholdMs(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--color-text-info)" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.5rem" }}>
            {[
              { label: "Fail on full table scan", value: failSeqScan, set: setFailSeqScan },
              { label: "Fail on missing index", value: failMissingIndex, set: setFailMissingIndex },
            ].map(({ label, value, set }) => (
              <label key={label} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                  style={{ accentColor: "var(--color-text-info)", width: 14, height: 14 }}
                />
                <span style={{ color: "var(--color-text-primary)" }}>{label}</span>
              </label>
            ))}
          </div>

          <button
            onClick={run}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 20px",
              background: "var(--color-background-info)",
              color: "var(--color-text-info)",
              border: "0.5px solid var(--color-border-info)",
              borderRadius: "var(--border-radius-md)",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 500,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? <Loader size={14} /> : <Play size={14} />}
            {loading ? "Running check..." : "Run CI check"}
          </button>
        </div>

        {/* Result panel */}
        <div>
          {result ? (
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 1rem" }}>Result</p>

              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 18px",
                background: result.passed ? "var(--color-background-success)" : "var(--color-background-danger)",
                border: `0.5px solid ${result.passed ? "var(--color-border-success)" : "var(--color-border-danger)"}`,
                borderRadius: "var(--border-radius-lg)",
                marginBottom: "1rem",
              }}>
                {result.passed
                  ? <CheckCircle size={20} color="var(--color-text-success)" />
                  : <XCircle size={20} color="var(--color-text-danger)" />
                }
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: result.passed ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
                    {result.badge}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {result.exec_time_ms != null ? `${result.exec_time_ms.toFixed(2)}ms` : "N/A"} · context: {result.context}
                  </div>
                </div>
              </div>

              {result.fail_reasons.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 6px" }}>Fail reasons</p>
                  {result.fail_reasons.map((r) => (
                    <div key={r} style={{
                      padding: "6px 12px",
                      background: "var(--color-background-danger)",
                      color: "var(--color-text-danger)",
                      borderRadius: "var(--border-radius-md)",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                      marginBottom: 4,
                    }}>
                      {r}
                    </div>
                  ))}
                </div>
              )}

              {result.issues.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 6px" }}>Issues ({result.issues.length})</p>
                  {result.issues.map((issue, i) => (
                    <div key={i} style={{
                      padding: "8px 12px",
                      background: "var(--color-background-secondary)",
                      borderRadius: "var(--border-radius-md)",
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      marginBottom: 4,
                      lineHeight: 1.5,
                    }}>
                      <span style={{ color: issue.severity === "high" ? "var(--color-text-danger)" : "var(--color-text-warning)", fontWeight: 500 }}>
                        {issue.severity.toUpperCase()}
                      </span>{" "}
                      {issue.message}
                    </div>
                  ))}
                </div>
              )}

              {result.recommendations.length > 0 && (
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {result.recommendations.length} recommendation{result.recommendations.length > 1 ? "s" : ""} available.{" "}
                  <a href="/dashboard/analyze" style={{ color: "var(--color-text-info)" }}>View in Analyze</a>
                </p>
              )}
            </div>
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>
              Run a check to see results
            </div>
          )}
        </div>
      </div>

      {/* GitHub Actions snippet */}
      <div style={{ marginTop: "2.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>GitHub Actions integration</p>
          <button
            onClick={copySnippet}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 12px",
              background: "none",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
              fontSize: 12,
              color: copied ? "var(--color-text-success)" : "var(--color-text-secondary)",
            }}
          >
            <Copy size={12} />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre style={{
          margin: 0,
          padding: "1rem 1.25rem",
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-secondary)",
          overflowX: "auto",
          whiteSpace: "pre",
          lineHeight: 1.6,
        }}>
          {GITHUB_SNIPPET}
        </pre>
      </div>

      {/* Slack setup */}
      <div style={{ marginTop: "2.5rem" }}>
        <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 1rem" }}>Slack integration</p>
        <div style={{
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.25rem",
        }}>
          {[
            { step: "1", text: "Create a Slack app at api.slack.com/apps" },
            { step: "2", text: "Add Incoming Webhooks → copy URL to SLACK_WEBHOOK_URL in .env" },
            { step: "3", text: "Add Slash Commands → set request URL to /api/v1/slack/command" },
            { step: "4", text: "Add Interactivity → set request URL to /api/v1/slack/interact" },
            { step: "5", text: "Use /querysense status · /querysense top · /querysense ask <question>" },
          ].map(({ step, text }) => (
            <div key={step} style={{
              display: "flex",
              gap: 12,
              padding: "8px 0",
              borderBottom: step !== "5" ? "0.5px solid var(--color-border-tertiary)" : "none",
              fontSize: 13,
            }}>
              <span style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-tertiary)",
                flexShrink: 0,
                paddingTop: 1,
                width: 16,
              }}>{step}</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
