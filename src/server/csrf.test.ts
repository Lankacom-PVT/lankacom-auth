import { describe, it, expect, vi } from "vitest";

// verifySameOrigin imports "server-only"; stub it so the module loads under vitest.
vi.mock("server-only", () => ({}));

const { verifySameOrigin } = await import("./csrf.js");

const h = (init: Record<string, string>): Headers => new Headers(init);

describe("verifySameOrigin", () => {
  it("accepts a matching Origin against the request host", () => {
    expect(
      verifySameOrigin(
        h({ origin: "https://app.example.com", host: "app.example.com", "x-forwarded-proto": "https" }),
      ),
    ).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    expect(
      verifySameOrigin(
        h({ origin: "https://evil.example.com", host: "app.example.com", "x-forwarded-proto": "https" }),
      ),
    ).toBe(false);
  });

  it("fails closed when neither Origin nor Referer is present", () => {
    expect(verifySameOrigin(h({ host: "app.example.com" }))).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      verifySameOrigin(
        h({ referer: "https://app.example.com/some/path", host: "app.example.com", "x-forwarded-proto": "https" }),
      ),
    ).toBe(true);
  });

  it("honors the trustedOrigins allowlist", () => {
    expect(
      verifySameOrigin(
        h({ origin: "https://admin.example.com", host: "app.example.com", "x-forwarded-proto": "https" }),
        { trustedOrigins: ["https://admin.example.com"] },
      ),
    ).toBe(true);
  });

  it("prefers x-forwarded-host over host for self-origin", () => {
    expect(
      verifySameOrigin(
        h({
          origin: "https://public.example.com",
          host: "internal:3000",
          "x-forwarded-host": "public.example.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a scheme mismatch (http Origin vs https host)", () => {
    expect(
      verifySameOrigin(
        h({ origin: "http://app.example.com", host: "app.example.com", "x-forwarded-proto": "https" }),
      ),
    ).toBe(false);
  });
});
