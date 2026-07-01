import type { NextRequest } from "next/server";

/**
 * MOCK backend refresh. NOT part of @lankacom/auth. Models the real contract:
 *  - single-use: every call returns a NEW access AND refresh token
 *  - the refresh response is LEAN: it returns fresh tokens but only a partial
 *    user (id), relying on the client to carry forward the rest. This exercises
 *    the library's ctx.previous carry-forward in mapTokenResponse.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
  if (!body.refreshToken) {
    return Response.json({ error: "missing refresh token" }, { status: 400 });
  }

  return Response.json({
    access_token: `mock-access.${Date.now()}`,
    refresh_token: `mock-refresh.${Date.now()}`,
    // Lean refresh: only id comes back; name/role/email/tenant carried forward.
    user: { id: "u_1" },
  });
}
