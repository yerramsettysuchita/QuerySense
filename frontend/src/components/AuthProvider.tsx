"use client";
import { AuthCtx, useAuthState } from "@/hooks/useAuth";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthState();
  return <AuthCtx.Provider value={auth}>{children}</AuthCtx.Provider>;
}
