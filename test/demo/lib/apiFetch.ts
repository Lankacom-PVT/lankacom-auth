import "server-only";
import { authHeaders, forceRefresh } from "./auth";

/**
 * Server-side authenticated fetch implementing the API's 401-retry checklist:
 *
 *   1. attach Bearer <accessToken> + tenantId
 *   2. on 401 → forceRefresh() (single-flight server-side rotation, swaps in
 *      the new token pair) → retry ONCE with the fresh headers
 *   3. still 401 → caller treats it as auth failure → redirect to login
 *
 * The library owns the token swap; this helper just retries the request.
 */
export async function apiFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const withAuth = async (): Promise<Response> => {
    const headers = { ...(init.headers ?? {}), ...(await authHeaders()) };
    return fetch(url, { ...init, headers, cache: "no-store" });
  };

  let res = await withAuth();
  if (res.status !== 401) return res;

  // Token rejected early — force a rotation, then retry once.
  const rotated = await forceRefresh();
  if (!rotated || rotated.error) return res; // rotation failed → original 401
  res = await withAuth();
  return res;
}
