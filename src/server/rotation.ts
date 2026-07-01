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
import { createHash } from "node:crypto";

/**
 * Default grace window: how long a just-rotated result is replayable for the
 * OLD (consumed) token. Should be <= the backend's refresh-token grace window
 * so a straggler request that still carries the old token never re-presents it
 * after the backend has stopped tolerating reuse. Backends commonly grant 30s.
 */
const DEFAULT_RECENT_TTL_MS = 30 * 1000;

/**
 * Safety cap on the `recent` map. Entries expire lazily (only swept on a hit
 * for the same key), so a stream of never-re-queried tokens would otherwise
 * grow the map without bound — a slow memory-exhaustion lever. When the cap is
 * hit we sweep expired entries and, if still over, drop the oldest.
 */
const MAX_RECENT_ENTRIES = 10_000;

/**
 * Key the caches by SHA-256 of the token rather than the raw token, so live
 * refresh tokens are never held verbatim as Map keys in a process-global
 * structure. Cheap and synchronous via Node's crypto; returns hex.
 */
const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export class Rotator<R> {
  private readonly inFlight = new Map<string, Promise<R>>();
  private readonly recent = new Map<string, { result: R; at: number }>();
  private readonly recentTtlMs: number;

  /** @param recentTtlMs grace window in ms (default 30s). */
  constructor(recentTtlMs: number = DEFAULT_RECENT_TTL_MS) {
    this.recentTtlMs = recentTtlMs;
  }

  /** Drop expired entries, then bound the map to MAX_RECENT_ENTRIES. */
  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.recent) {
      if (now - v.at > this.recentTtlMs) this.recent.delete(k);
    }
    // Map preserves insertion order → the first keys are the oldest.
    while (this.recent.size > MAX_RECENT_ENTRIES) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined) break;
      this.recent.delete(oldest);
    }
  }

  /** Return a recently-rotated result for a consumed token, if still fresh. */
  getRecent(oldToken: string): R | undefined {
    const key = hashToken(oldToken);
    const hit = this.recent.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.recentTtlMs) {
      this.recent.delete(key);
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
    const key = hashToken(oldToken);

    const recent = this.getRecent(oldToken);
    if (recent !== undefined) return recent;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const result = await doRotate();
      this.recent.set(key, { result, at: Date.now() });
      this.sweep();
      return result;
    })();

    this.inFlight.set(key, promise);
    // Drop the in-flight entry once settled so the next legitimate rotation
    // starts fresh. The trailing catch swallows rejection on THIS bookkeeping
    // chain only — the awaiting caller still observes the original error.
    promise
      .finally(() => {
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key);
        }
      })
      .catch(() => {});

    return promise;
  }
}
