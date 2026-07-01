import type { NextRequest } from "next/server";

/**
 * MOCK backend login modelling the real API contract:
 *  - access_token (5h) + refresh_token (7d, single-use)
 *  - tenantId on the user
 *  - mustChangePassword: no refresh token issued until password changed
 *
 * NOT part of @lankacom/auth — stands in for your real auth API.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (body.password !== "password") {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }

  const email = body.email ?? "demo@lankacom.lk";
  // "mustchange@..." simulates a user forced to change their password.
  const mustChangePassword = email.startsWith("mustchange");

  return Response.json({
    access_token: `mock-access.${Date.now()}`,
    // Real contract: no refresh token until password is changed.
    refresh_token: mustChangePassword ? null : `mock-refresh.${Date.now()}`,
    mustChangePassword,
    user: {
      id: "u_1",
      name: email.split("@")[0],
      email,
      role: email.startsWith("admin") ? "ADMIN" : "USER",
      tenantId: "tenant_lankacom",
    },
  });
}
