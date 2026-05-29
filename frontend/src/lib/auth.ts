import api from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  workspace_id: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  slug: string;
  connection_count?: number;
  member_count?: number;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  workspace: AuthWorkspace;
}

interface APIEnvelope<T> { success: boolean; data: T; timestamp: string; }

export const signup = (payload: {
  name: string;
  email: string;
  password: string;
  workspace_name: string;
}) => api.post<APIEnvelope<AuthResponse>>("/api/v1/auth/signup", payload).then((r) => r.data.data);

export const login = (email: string, password: string) =>
  api.post<APIEnvelope<AuthResponse>>("/api/v1/auth/login", { email, password }).then((r) => r.data.data);

export const getMe = () =>
  api.get<APIEnvelope<{ user: AuthUser; workspace: AuthWorkspace }>>("/api/v1/auth/me")
    .then((r) => r.data.data);

export const setToken = (token: string) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("qs_token", token);
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }
};

export const getToken = (): string | null => {
  if (typeof window !== "undefined") return localStorage.getItem("qs_token");
  return null;
};

export const clearToken = () => {
  if (typeof window !== "undefined") {
    localStorage.removeItem("qs_token");
    delete api.defaults.headers.common["Authorization"];
  }
};

export const isAuthenticated = (): boolean => !!getToken();

export const setTokenWithCookie = (token: string) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("qs_token", token);
    document.cookie = `qs_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }
};

export const clearTokenWithCookie = () => {
  if (typeof window !== "undefined") {
    localStorage.removeItem("qs_token");
    document.cookie = "qs_token=; path=/; max-age=0";
    delete api.defaults.headers.common["Authorization"];
  }
};

export const testConnection = (url: string) =>
  api.post("/api/v1/connections/test", { url }).then((r) => r.data);

export interface Connection {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: string;
  database: string;
  status: string;
  is_active: boolean;
  pg_stat_statements_enabled: boolean;
  last_checked_at: string | null;
  created_at: string;
}

export const saveConnection = (name: string, url: string) =>
  api.post<APIEnvelope<{ connection_id: string; name: string; status: string }>>("/api/v1/connections/save", { name, url }).then((r) => r.data.data);

export const listConnections = () =>
  api.get<APIEnvelope<Connection[]>>("/api/v1/connections/").then((r) => r.data.data);

export const checkConnectionHealth = (id: string) =>
  api.get(`/api/v1/connections/${id}/health`).then((r) => r.data);
