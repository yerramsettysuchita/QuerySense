"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { listConnections, checkConnectionHealth } from "@/lib/auth";
import api from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Database, Key, Trash2, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

export default function SettingsPage() {
  const { user, workspace, logout, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);
  const [connections, setConnections] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [healthChecking, setHealthChecking] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get("/api/v1/connections/").then((r) => r.data),
      api.get("/api/v1/auth/api-keys").then((r) => r.data),
    ]).then(([conns, keys]) => {
      setConnections(conns);
      setApiKeys(keys);
      setLoading(false);
    });
  }, []);

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const result = await api.post("/api/v1/auth/api-keys", { name: newKeyName }).then((r) => r.data);
      setCreatedKey(result.key);
      setApiKeys((prev) => [...prev, result]);
      setNewKeyName("");
      toast({ type: "success", title: "API key created", message: "Make sure to save it now as it will not be shown again." });
    } catch {
      toast({ type: "error", title: "Failed to create API key" });
    }
  };

  const revokeKey = async (id: string) => {
    await api.delete(`/api/v1/auth/api-keys/${id}`);
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
    toast({ type: "success", title: "API key revoked" });
  };

  const deleteConnection = async (id: string) => {
    await api.delete(`/api/v1/connections/${id}`);
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setConfirmDelete(null);
    toast({ type: "success", title: "Connection removed" });
  };

  const checkHealth = async (id: string) => {
    setHealthChecking(id);
    try {
      const result = await checkConnectionHealth(id);
      if (result.success) {
        toast({ type: "success", title: "Connection healthy", message: `${result.latency_ms}ms latency` });
      } else {
        toast({ type: "error", title: "Connection failed", message: result.error });
      }
      setConnections((prev) =>
        prev.map((c) => c.id === id ? { ...c, status: result.success ? "ok" : "error" } : c)
      );
    } finally {
      setHealthChecking(null);
    }
  };

  if (authLoading || !user) return null;

  if (loading) return (
    <div style={{ padding: "2rem", color: "var(--color-text-secondary)", fontSize: 14 }}>Loading...</div>
  );

  return (
    <div style={{ padding: "2rem", maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>Settings</h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: "0 0 2rem" }}>
        Workspace: <strong>{workspace?.name}</strong>
      </p>

      {/* Connections */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={15} /> Database connections
          </h2>
          <Link href="/onboarding" style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            padding: "6px 12px",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-md)",
            textDecoration: "none",
            color: "var(--color-text-primary)",
          }}>
            <Plus size={12} /> Add connection
          </Link>
        </div>

        {!connections.length ? (
          <div style={{
            padding: "2rem",
            textAlign: "center",
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-lg)",
            fontSize: 13,
            color: "var(--color-text-secondary)",
          }}>
            No connections yet.{" "}
            <Link href="/onboarding" style={{ color: "var(--color-text-info)" }}>
              Add your first database →
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {connections.map((conn) => (
              <div key={conn.id} style={{
                background: "var(--color-background-primary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-lg)",
                padding: "1rem 1.25rem",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: conn.status === "ok" ? "var(--color-text-success)" : "var(--color-text-danger)",
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{conn.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
                    {conn.db_type} · {conn.host}:{conn.port}/{conn.database}
                  </div>
                  {conn.last_checked_at && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                      Last checked {formatDistanceToNow(new Date(conn.last_checked_at), { addSuffix: true })}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => checkHealth(conn.id)}
                    disabled={healthChecking === conn.id}
                    title="Check health"
                    style={{
                      padding: "6px 10px",
                      background: "none",
                      border: "0.5px solid var(--color-border-secondary)",
                      borderRadius: "var(--border-radius-md)",
                      cursor: "pointer",
                      color: "var(--color-text-secondary)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                    }}
                  >
                    <RefreshCw size={12} />
                    {healthChecking === conn.id ? "Checking..." : "Test"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(conn.id)}
                    title="Remove connection"
                    style={{
                      padding: "6px 8px",
                      background: "none",
                      border: "0.5px solid var(--color-border-secondary)",
                      borderRadius: "var(--border-radius-md)",
                      cursor: "pointer",
                      color: "var(--color-text-danger)",
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* API Keys */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 1rem", display: "flex", alignItems: "center", gap: 8 }}>
          <Key size={15} /> API keys
        </h2>

        {createdKey && (
          <div style={{
            padding: "12px 14px",
            background: "var(--color-background-success)",
            border: "0.5px solid var(--color-border-success)",
            borderRadius: "var(--border-radius-md)",
            marginBottom: "1rem",
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 500, color: "var(--color-text-success)", marginBottom: 4 }}>
              Copy this key now as it will not be shown again
            </div>
            <code
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                background: "var(--color-background-primary)",
                padding: "6px 10px",
                borderRadius: "var(--border-radius-md)",
                display: "block",
                wordBreak: "break-all",
                cursor: "pointer",
                color: "var(--color-text-primary)",
              }}
              onClick={() => {
                navigator.clipboard.writeText(createdKey);
                toast({ type: "success", title: "Copied to clipboard" });
              }}
            >
              {createdKey}
            </code>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: "1rem" }}>
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. CI/CD pipeline)"
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === "Enter" && createApiKey()}
          />
          <button
            onClick={createApiKey}
            disabled={!newKeyName.trim()}
            style={{
              padding: "8px 16px",
              background: "var(--color-text-primary)",
              color: "var(--color-background-primary)",
              border: "none",
              borderRadius: "var(--border-radius-md)",
              cursor: !newKeyName.trim() ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 500,
              opacity: !newKeyName.trim() ? 0.6 : 1,
            }}
          >
            Create
          </button>
        </div>

        {!apiKeys.length ? (
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No API keys yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {apiKeys.map((key) => (
              <div key={key.id} style={{
                background: "var(--color-background-primary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-md)",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{key.name}</div>
                  <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>
                    {key.key_preview}
                  </code>
                  {key.last_used_at && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                      Last used {formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true })}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => revokeKey(key.id)}
                  style={{
                    padding: "5px 10px",
                    background: "none",
                    border: "0.5px solid var(--color-border-danger)",
                    borderRadius: "var(--border-radius-md)",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--color-text-danger)",
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Account */}
      <section>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 1rem" }}>Account</h2>
        <div style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1rem 1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{user?.name}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{user?.email}</div>
          </div>
          <button
            onClick={logout}
            style={{
              padding: "7px 14px",
              background: "none",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--color-text-secondary)",
            }}
          >
            Sign out
          </button>
        </div>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="Remove connection"
          message="This will stop monitoring this database. Historical data will be preserved."
          confirmLabel="Remove"
          danger
          onConfirm={() => deleteConnection(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
