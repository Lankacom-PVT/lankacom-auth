import { describe, it, expect } from "vitest";
import {
  chunkCookieName,
  chunkCookieValue,
  readChunkedCookie,
  MAX_COOKIE_CHUNKS,
} from "./cookie.js";

/**
 * Minimal stand-in for the Next cookie store's read surface.
 *
 * The lookup is written to return `{ value: string } | undefined` exactly —
 * indexing a Record widens to `string | undefined`, which does not satisfy the
 * store contract.
 */
const storeOf = (entries: Record<string, string>) => ({
  get: (name: string): { value: string } | undefined => {
    const value = entries[name];
    return value === undefined ? undefined : { value };
  },
});

describe("cookie chunking", () => {
  it("leaves a value that fits in one cookie untouched", () => {
    const parts = chunkCookieValue("short-session-value", 3800);
    expect(parts).toEqual(["short-session-value"]);
  });

  it("names the first chunk with the bare base name", () => {
    // Keeps the single-cookie case byte-identical to the pre-chunking format,
    // so existing cookies and the Edge presence gate keep working.
    expect(chunkCookieName("lankacom.session", 0)).toBe("lankacom.session");
    expect(chunkCookieName("lankacom.session", 1)).toBe("lankacom.session.1");
  });

  it("splits an oversized value and rejoins it exactly", () => {
    const value = "x".repeat(9000);
    const parts = chunkCookieValue(value, 3800);
    expect(parts).toHaveLength(3);
    expect(parts.join("")).toBe(value);
  });

  it("reads a chunked session back in order", () => {
    const value = "abcdefghij".repeat(500); // 5000 chars
    const parts = chunkCookieValue(value, 3800);
    const entries: Record<string, string> = {};
    parts.forEach((p, i) => {
      entries[chunkCookieName("s", i)] = p;
    });

    expect(readChunkedCookie(storeOf(entries), "s")).toBe(value);
  });

  it("returns undefined when the first chunk is missing", () => {
    // A jar holding only overflow chunks is not a session.
    expect(readChunkedCookie(storeOf({ "s.1": "orphan" }), "s")).toBeUndefined();
  });

  it("stops at the first gap rather than concatenating across it", () => {
    // A partial set cannot decrypt; joining across a hole would only produce a
    // corrupt token more slowly. Truncating keeps the failure clean.
    const entries = { s: "part0", "s.2": "part2" };
    expect(readChunkedCookie(storeOf(entries), "s")).toBe("part0");
  });

  it("never reads past the shared chunk ceiling", () => {
    const entries: Record<string, string> = { s: "0" };
    for (let i = 1; i < MAX_COOKIE_CHUNKS + 4; i += 1) entries[`s.${i}`] = "1";
    const joined = readChunkedCookie(storeOf(entries), "s");
    expect(joined).toHaveLength(MAX_COOKIE_CHUNKS);
  });
});
