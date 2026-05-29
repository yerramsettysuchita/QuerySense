"use client";
import { useEffect, useState } from "react";
import { listConnections } from "@/lib/auth";

interface Connection {
  id: string;
  name: string;
  db_type: string;
  host: string;
  status: string;
}

export default function ConnectionHealthBar() {
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    listConnections()
      .then(setConnections)
      .catch(() => {});

    const interval = setInterval(() => {
      listConnections().then(setConnections).catch(() => {});
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  if (!connections.length) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>DBs:</span>
      {connections.map((conn) => {
        const isOk = conn.status === "ok";
        const color = isOk ? "var(--color-text-success)" : "var(--color-text-danger)";
        return (
          <div
            key={conn.id}
            title={`${conn.name} on ${conn.host}: ${conn.status}`}
            style={{ display: "flex", alignItems: "center", gap: 4, cursor: "default" }}
          >
            <div style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: color,
              boxShadow: isOk ? `0 0 4px ${color}` : "none",
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              {conn.name.length > 12 ? conn.name.slice(0, 12) + "…" : conn.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
