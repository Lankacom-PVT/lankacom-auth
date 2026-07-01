import Link from "next/link";
import { requireSession } from "@/lib/auth";

/**
 * SSR-protected page. requireSession() runs on the server and redirects to
 * /login (the configured pages.signIn) before any HTML is sent if there is no
 * recoverable session. The guard happens server-side — no client flash.
 */
export default async function ProtectedSsr() {
  const session = await requireSession();

  return (
    <main style={{ maxWidth: 600, margin: "40px auto", fontFamily: "system-ui", padding: 16 }}>
      <h1>Protected — SSR</h1>
      <p>Guarded by <code>requireSession()</code> on the server.</p>
      <p>
        Welcome, <strong>{session.user.name}</strong> ({session.user.role})
      </p>
      <pre style={{ background: "#f5f7ff", padding: 12, borderRadius: 8, fontSize: 12 }}>
        {JSON.stringify({ ...session, refreshToken: "<hidden>" }, null, 2)}
      </pre>
      <p><Link href="/">← Home</Link></p>
    </main>
  );
}
