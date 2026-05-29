"use client";
import { useState, useEffect, createContext, useContext } from "react";
import { AuthUser, AuthWorkspace, getMe, getToken, setTokenWithCookie, clearTokenWithCookie } from "@/lib/auth";
import api from "@/lib/api";

const USER_KEY = "qs_user_cache";
const WS_KEY   = "qs_ws_cache";

function readCache(): { user: AuthUser | null; workspace: AuthWorkspace | null } {
  try {
    const u = localStorage.getItem(USER_KEY);
    const w = localStorage.getItem(WS_KEY);
    return { user: u ? JSON.parse(u) : null, workspace: w ? JSON.parse(w) : null };
  } catch { return { user: null, workspace: null }; }
}

function writeCache(user: AuthUser, workspace: AuthWorkspace) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(WS_KEY,   JSON.stringify(workspace));
  } catch {}
}

function clearCache() {
  try {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(WS_KEY);
  } catch {}
}

export interface AuthContextValue {
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  loading: boolean;
  login: (token: string, user: AuthUser, workspace: AuthWorkspace) => void;
  logout: () => void;
}

export const AuthCtx = createContext<AuthContextValue>({
  user: null,
  workspace: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

export function useAuthState(): AuthContextValue {
  const [user, setUser]           = useState<AuthUser | null>(null);
  const [workspace, setWorkspace] = useState<AuthWorkspace | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }

    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    // ── Instant restore from cache — no API wait ──────────────
    const cached = readCache();
    if (cached.user && cached.workspace) {
      setUser(cached.user);
      setWorkspace(cached.workspace);
      setLoading(false);
      // Silent background re-validation
      getMe().then((data) => {
        setUser(data.user);
        setWorkspace(data.workspace);
        writeCache(data.user, data.workspace);
      }).catch(() => {
        // Token expired — clear and let guards redirect
        clearTokenWithCookie();
        clearCache();
        setUser(null);
        setWorkspace(null);
      });
      return;
    }

    // ── No cache — fetch normally (first load after login) ────
    getMe()
      .then((data) => {
        setUser(data.user);
        setWorkspace(data.workspace);
        writeCache(data.user, data.workspace);
      })
      .catch(() => { clearTokenWithCookie(); clearCache(); })
      .finally(() => setLoading(false));
  }, []);

  // ── Keep-alive: ping /health every 14 min to prevent Render cold starts ──
  useEffect(() => {
    const ping = () => fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/health`).catch(() => {});
    ping(); // warm up immediately on first load
    const id = setInterval(ping, 14 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const login = (token: string, u: AuthUser, w: AuthWorkspace) => {
    setTokenWithCookie(token);
    writeCache(u, w);
    setUser(u);
    setWorkspace(w);
  };

  const logout = () => {
    clearTokenWithCookie();
    clearCache();
    setUser(null);
    setWorkspace(null);
    window.location.replace("/");
  };

  return { user, workspace, loading, login, logout };
}
