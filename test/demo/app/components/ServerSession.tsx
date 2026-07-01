import { getSession } from "@/lib/auth";

/**
 * Reads session on the SERVER via the library's getSession(). This is the
 * authoritative read — it decodes the cookie and triggers rotation if the
 * access token is expired. (Async server component.)
 */
export async function ServerSession() {
  const session = await getSession();

  // Don't render the refresh token to the page even on the server side.
  const safe = session ? { ...session, refreshToken: "<hidden>" } : null;

  return (
    <section style={card}>
      <h2 style={h2}>Server session (getSession)</h2>
      <pre style={pre}>{JSON.stringify(safe, null, 2)}</pre>
    </section>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #3a3357",
  borderRadius: 8,
  padding: 16,
  background: "#1d1830",
  color: "#ece6f7",
};
const h2: React.CSSProperties = { marginTop: 0, fontSize: 16, color: "#c4a7ff" };
const pre: React.CSSProperties = {
  fontSize: 12,
  overflow: "auto",
  background: "#120e21",
  color: "#e3d9ff",
  padding: 8,
  borderRadius: 4,
};
