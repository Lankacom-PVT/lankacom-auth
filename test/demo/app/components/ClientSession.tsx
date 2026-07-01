"use client";

import { useSession } from "@lankacom/auth/client";

/** Reads session on the CLIENT via the library's useSession() hook. */
export function ClientSession() {
  // No generic needed — the user type comes from lankacom-auth.d.ts (Register).
  const { data, status } = useSession();

  return (
    <section style={card}>
      <h2 style={h2}>Client session (useSession)</h2>
      <p>
        status: <strong>{status}</strong>
      </p>
      <pre style={pre}>{JSON.stringify(data, null, 2)}</pre>
    </section>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #2e3a52",
  borderRadius: 8,
  padding: 16,
  background: "#16202e",
  color: "#e6edf3",
};
const h2: React.CSSProperties = { marginTop: 0, fontSize: 16, color: "#7fd1ff" };
const pre: React.CSSProperties = {
  fontSize: 12,
  overflow: "auto",
  background: "#0d1420",
  color: "#d6e2ff",
  padding: 8,
  borderRadius: 4,
};
