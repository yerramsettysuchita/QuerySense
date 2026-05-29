import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/dashboard/Nav";
import AlertToast from "@/components/dashboard/AlertToast";
import AuthProvider from "@/components/AuthProvider";
import QueryProvider from "@/components/QueryProvider";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { ToastContainer } from "@/components/ui/Toast";
import CommandPalette from "@/components/ui/CommandPalette";

export const metadata: Metadata = {
  title: "QuerySense: AI Database Query Optimizer",
  description: "Detect, analyze, and fix slow database queries automatically.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
        <AuthProvider>
          <ErrorBoundary>
            <Nav />
            <main style={{ minHeight: "calc(100vh - 52px)" }}>{children}</main>
            <AlertToast />
            <CommandPalette />
          </ErrorBoundary>
        </AuthProvider>
        </QueryProvider>
        <ToastContainer />
      </body>
    </html>
  );
}
