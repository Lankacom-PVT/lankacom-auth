"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@lankacom/auth/client";

/**
 * CSR-protected page. The guard runs on the CLIENT via useSession(): while
 * status is "loading" we show a spinner; once "unauthenticated" we redirect to
 * /login. Because the layout seeds initialSession from the server, an
 * authenticated user sees no loading flash.
 */
export default function ProtectedCsr() {
  const { data, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return <main style={wrap}>Checking session…</main>;
  }
  if (status === "unauthenticated" || !data) {
    return <main style={wrap}>Redirecting to login…</main>;
  }

  return (
    <main style={wrap}>
      <h1>Protected — CSR</h1>
      <p>Guarded on the client by <code>useSession()</code>.</p>
      <p>
        Welcome, <strong>{data.user.name}</strong> ({data.user.role})
      </p>
      <pre style={{ background: "#fafafa", padding: 12, borderRadius: 8, fontSize: 12 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
      <p><Link href="/">← Home</Link></p>
    </main>
  );
}

const wrap: React.CSSProperties = {
  maxWidth: 600,
  margin: "40px auto",
  fontFamily: "system-ui",
  padding: 16,
};
