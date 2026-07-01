"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <main style={{ maxWidth: 380, margin: "64px auto", fontFamily: "system-ui" }}>
      <h1>Sign in</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Mock backend: any email, password <code>password</code>.<br />
        Use an email starting with <code>admin</code> for the ADMIN role.
      </p>

      <form action={action} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Email</span>
          <input
            name="email"
            type="email"
            defaultValue="demo@lankacom.lk"
            required
            style={{ padding: 8 }}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Password</span>
          <input
            name="password"
            type="password"
            defaultValue="password"
            required
            style={{ padding: 8 }}
          />
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input name="remember" type="checkbox" defaultChecked />
          <span>Remember me (persistent cookie + refresh token)</span>
        </label>

        {state.error && (
          <p style={{ color: "crimson", margin: 0 }}>{state.error}</p>
        )}

        <button type="submit" disabled={pending} style={{ padding: 10 }}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p style={{ marginTop: 24 }}>
        <Link href="/">← Home</Link>
      </p>
    </main>
  );
}
