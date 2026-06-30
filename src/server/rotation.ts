/**
 * Single source of truth for refresh-token rotation. Ported from the
 * battle-tested athenaSMS-fe-admin src/ssr/session.ts. Two caches:
 *
 *  1. inFlight  — concurrent server requests for the SAME expired refresh token
 *     share ONE rotation call. Single-use refresh tokens cannot tolerate two
 *     parallel rotators; without this they each present R0, the backend rotates
 *     it multiple times, and an orphaned-but-valid token presented later trips
 *     reuse detection and revokes the family.
 *
 *  2. recent    — settled results keyed by the OLD (consumed) token, kept for a
 *     short TTL. cookies().set() silently no-ops in RSC render contexts, so the
 *     rotated cookie can be lost and the NEXT request reads the SAME old token.
 *     Re-presenting a consumed token is exactly what trips reuse detection. The
 *     recent cache hands stragglers the already-rotated result instead.
 *
 * Generic over the rotation result `R` so the engine owns the locking and the
 * caller owns what a rotation produces (new claims + encoded cookie).
 */

const RECENT_TTL_MS = 60 * 1000;

export class Rotator<R> {
  private readonly inFlight = new Map<string, Promise<R>>();
  private readonly recent = new Map<string, { result: R; at: number }>();

  /** Return a recently-rotated result for a consumed token, if still fresh. */
  getRecent(oldToken: string): R | undefined {
    const hit = this.recent.get(oldToken);
    if (!hit) return undefined;
    if (Date.now() - hit.at > RECENT_TTL_MS) {
      this.recent.delete(oldToken);
      return undefined;
    }
    return hit.result;
  }

  /**
   * Rotate `oldToken` exactly once across concurrent callers. `doRotate` is the
   * real work (backend call + re-encode); it runs at most once per in-flight
   * window. The result is remembered in `recent` for stragglers.
   */
  async rotate(oldToken: string, doRotate: () => Promise<R>): Promise<R> {
    const recent = this.getRecent(oldToken);
    if (recent !== undefined) return recent;

    const existing = this.inFlight.get(oldToken);
    if (existing) return existing;

    const promise = (async () => {
      const result = await doRotate();
      this.recent.set(oldToken, { result, at: Date.now() });
      return result;
    })();

    this.inFlight.set(oldToken, promise);
    // Drop the in-flight entry once settled so the next legitimate rotation
    // starts fresh. The trailing catch swallows rejection on THIS bookkeeping
    // chain only — the awaiting caller still observes the original error.
    promise
      .finally(() => {
        if (this.inFlight.get(oldToken) === promise) {
          this.inFlight.delete(oldToken);
        }
      })
      .catch(() => {});

    return promise;
  }
}
