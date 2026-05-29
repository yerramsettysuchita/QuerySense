"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, signup } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import {
  Database, Eye, EyeOff, CheckCircle,
  Activity, Zap, Shield, TrendingDown, ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: <Activity size={14} />,
    title: "Live query monitoring",
    desc: "Automatically surfaces slow queries every 30 seconds with no extra instrumentation required.",
  },
  {
    icon: <Zap size={14} />,
    title: "Execution plan analysis",
    desc: "Detects full table scans, bad joins, stale statistics, and repeated query patterns.",
  },
  {
    icon: <Shield size={14} />,
    title: "Shadow database benchmarking",
    desc: "Validates every fix on a real copy of your data before anything touches production.",
  },
  {
    icon: <TrendingDown size={14} />,
    title: "Regression detection",
    desc: "Compares the last 24 hours against your 7-day baseline to catch performance regressions early.",
  },
];

function LoginForm() {
  const router      = useRouter();
  const params      = useSearchParams();
  const { login: authLogin, user, loading: authLoading } = useAuth();

  const [mode, setMode]             = useState<"login" | "signup">("login");
  const [showPw, setShowPw]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [signupDone, setSignupDone] = useState(false);
  const [form, setForm]             = useState({ name: "", email: "", password: "", workspace_name: "" });

  // Prevents the "already logged-in" redirect from firing after a form login,
  // which would race with router.push and leave the user stuck on this page.
  const formNavigating = useRef(false);

  useEffect(() => {
    if (params.get("mode") === "signup") setMode("signup");
  }, [params]);

  // Only redirect if the user was already logged in when they arrived here
  // (e.g. typed /login in the address bar while authenticated).
  useEffect(() => {
    if (!authLoading && user && !formNavigating.current) {
      router.replace("/dashboard");
    }
  }, [user, authLoading, router]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signup(form);
        setSignupDone(true);
        setMode("login");
        setForm(p => ({ ...p, password: "" }));
      } else {
        const res = await login(form.email, form.password);
        formNavigating.current = true;   // block the useEffect redirect
        authLogin(res.token, res.user, res.workspace);
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      formNavigating.current = false;
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: "login" | "signup") => {
    setMode(m);
    setError(null);
    setSignupDone(false);
  };

  return (
    <div className="auth-split">

      {/* ── LEFT PANEL ────────────────────────────────────────── */}
      <div className="auth-left" style={{
        background: "linear-gradient(150deg, #f0fdf4 0%, #e0f2fe 100%)",
        padding: "2.75rem 3rem",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}>

        {/* Decorative blobs */}
        <div style={{
          position: "absolute", top: -100, right: -100,
          width: 320, height: 320, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(22,163,74,0.13) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -80, left: -80,
          width: 260, height: 260, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(56,189,248,0.11) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: "40%", right: "5%",
          width: 140, height: 140, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(22,163,74,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: "3.5rem" }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: "#16a34a",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(22,163,74,0.3)",
          }}>
            <Database size={16} color="#fff" />
          </div>
          <span style={{
            fontSize: 17, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em",
          }}>
            QuerySense
          </span>
        </div>

        {/* Headline */}
        <div style={{ flex: 1 }}>
          <h2 style={{
            fontSize: 34, fontWeight: 800, color: "#0f172a",
            margin: "0 0 12px", lineHeight: 1.15, letterSpacing: "-0.03em",
          }}>
            Stop guessing.<br />
            <span style={{ color: "#16a34a" }}>Start optimizing.</span>
          </h2>
          <p style={{
            fontSize: 14, color: "#475569", margin: "0 0 2.5rem", lineHeight: 1.75,
          }}>
            AI-powered query optimizer that surfaces slow queries, explains
            root causes in plain English, and ships safe index migrations.
          </p>

          {/* Feature list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {FEATURES.map(({ icon, title, desc }) => (
              <div key={title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: "rgba(22,163,74,0.1)",
                  border: "1px solid rgba(22,163,74,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#16a34a",
                }}>
                  {icon}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 2 }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.55 }}>
                    {desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats footer */}
        <div style={{
          display: "flex", gap: 28, marginTop: "3rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid rgba(15,23,42,0.07)",
        }}>
          {[
            { value: "8+",  label: "Issue types detected" },
            { value: "94%", label: "Average speedup"      },
            { value: "3",   label: "Database engines"     },
          ].map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em" }}>
                {value}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500, marginTop: 1 }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL ───────────────────────────────────────── */}
      <div style={{
        flex: 1,
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem 2rem",
        position: "relative",
      }}>

        {/* Subtle dot pattern */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "radial-gradient(circle, #e2e8f0 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          opacity: 0.45,
        }} />

        <div style={{ width: "100%", maxWidth: 400, position: "relative" }}>

          {/* Card */}
          <div style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: "2rem",
            boxShadow: "0 4px 24px rgba(15,23,42,0.07), 0 1px 4px rgba(15,23,42,0.04)",
          }}>

            {/* Heading */}
            <div style={{ marginBottom: "1.5rem" }}>
              <h1 style={{
                fontSize: 22, fontWeight: 700, color: "#0f172a",
                margin: "0 0 5px", letterSpacing: "-0.02em",
              }}>
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h1>
              <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                {mode === "login"
                  ? "Sign in to your workspace to continue"
                  : "Get started free. It takes under a minute."}
              </p>
            </div>

            {/* Success banner */}
            {signupDone && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                marginBottom: "1.25rem", padding: "11px 13px",
                background: "#f0fdf4", border: "1px solid #bbf7d0",
                borderRadius: 10, fontSize: 13, color: "#15803d",
              }}>
                <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Account created. Sign in below to connect your database.</span>
              </div>
            )}

            {/* Tab toggle */}
            <div style={{
              display: "flex", background: "#f1f5f9",
              borderRadius: 10, padding: 3, marginBottom: "1.5rem",
            }}>
              {(["login", "signup"] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  style={{
                    flex: 1, padding: "7px 0",
                    background: mode === m ? "#ffffff" : "transparent",
                    border: "none", borderRadius: 8, cursor: "pointer",
                    fontSize: 13, fontWeight: mode === m ? 600 : 400,
                    color: mode === m ? "#0f172a" : "#64748b",
                    boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    transition: "all 0.15s",
                  }}
                >
                  {m === "login" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={submit}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {mode === "signup" && (
                  <>
                    <div>
                      <label style={{
                        fontSize: 12, fontWeight: 600, color: "#374151",
                        display: "block", marginBottom: 5,
                      }}>
                        Full name
                      </label>
                      <input
                        type="text" value={form.name} onChange={set("name")}
                        required placeholder="Ada Lovelace"
                        style={{ width: "100%", padding: "10px 13px", fontSize: 13 }}
                      />
                    </div>
                    <div>
                      <label style={{
                        fontSize: 12, fontWeight: 600, color: "#374151",
                        display: "block", marginBottom: 5,
                      }}>
                        Workspace name
                      </label>
                      <input
                        type="text" value={form.workspace_name} onChange={set("workspace_name")}
                        required placeholder="My Team"
                        style={{ width: "100%", padding: "10px 13px", fontSize: 13 }}
                      />
                    </div>
                  </>
                )}

                <div>
                  <label style={{
                    fontSize: 12, fontWeight: 600, color: "#374151",
                    display: "block", marginBottom: 5,
                  }}>
                    Email address
                  </label>
                  <input
                    type="email" value={form.email} onChange={set("email")}
                    required placeholder="you@company.com"
                    style={{ width: "100%", padding: "10px 13px", fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{
                    fontSize: 12, fontWeight: 600, color: "#374151",
                    display: "block", marginBottom: 5,
                  }}>
                    Password
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPw ? "text" : "password"}
                      value={form.password} onChange={set("password")}
                      required placeholder="Minimum 8 characters" minLength={8}
                      style={{ width: "100%", padding: "10px 40px 10px 13px", fontSize: 13 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      style={{
                        position: "absolute", right: 11,
                        top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer",
                        color: "#94a3b8", padding: 0, display: "flex",
                      }}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div style={{
                    padding: "10px 13px",
                    background: "#fef2f2", border: "1px solid #fecaca",
                    borderRadius: 9, fontSize: 13, color: "#dc2626",
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: "100%", padding: "11px",
                    background: loading ? "#94a3b8" : "#0f172a",
                    color: "#ffffff", border: "none", borderRadius: 10,
                    cursor: loading ? "not-allowed" : "pointer",
                    fontSize: 14, fontWeight: 600, marginTop: 2,
                    letterSpacing: "-0.01em",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#1e293b"; }}
                  onMouseLeave={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#0f172a"; }}
                >
                  {loading
                    ? "Please wait..."
                    : mode === "login"
                    ? <><span>Sign in to QuerySense</span><ArrowRight size={14} /></>
                    : <><span>Create account</span><ArrowRight size={14} /></>
                  }
                </button>
              </div>
            </form>
          </div>

          {/* Footer */}
          <p style={{
            textAlign: "center", fontSize: 12, color: "#94a3b8", marginTop: "1.25rem",
          }}>
            By continuing, you agree to our{" "}
            <span style={{ color: "#64748b", textDecoration: "underline", cursor: "pointer" }}>
              Terms of Service
            </span>{" "}
            and{" "}
            <span style={{ color: "#64748b", textDecoration: "underline", cursor: "pointer" }}>
              Privacy Policy
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
