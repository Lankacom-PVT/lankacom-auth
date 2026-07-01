import Link from "next/link";
import { ClientSession } from "./components/ClientSession";
import { ServerSession } from "./components/ServerSession";
import { SignOutButton } from "./components/SignOutButton";

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", fontFamily: "system-ui", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>@lankacom/auth demo</h1>
        <SignOutButton />
      </header>

      <nav style={{ display: "flex", gap: 16, margin: "16px 0" }}>
        <Link href="/login">Login</Link>
        <Link href="/protected-ssr">Protected (SSR)</Link>
        <Link href="/protected-csr">Protected (CSR)</Link>
      </nav>

      <p style={{ color: "#666", fontSize: 14 }}>
        The access token TTL is 30s. Reload after 30s to watch server-side
        single-flight rotation issue a fresh token (the server panel’s{" "}
        <code>tokenExpiry</code> jumps forward).
      </p>

      <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
        {/* Async server component reads on the server */}
        <ServerSession />
        {/* Client hook reads via the snapshot route */}
        <ClientSession />
      </div>
    </main>
  );
}
