import { describe, it, expect } from "vitest";
import { Rotator } from "./rotation.js";

describe("Rotator single-flight", () => {
  it("runs doRotate exactly once for concurrent callers of the same token", async () => {
    const r = new Rotator<number>();
    let calls = 0;
    const work = async () => {
      calls++;
      await new Promise((res) => setTimeout(res, 10));
      return 42;
    };
    const [a, b, c] = await Promise.all([
      r.rotate("R0", work),
      r.rotate("R0", work),
      r.rotate("R0", work),
    ]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual([42, 42, 42]);
  });

  it("replays a recent result for the consumed token within the grace window", async () => {
    const r = new Rotator<number>(1000);
    let calls = 0;
    await r.rotate("R0", async () => {
      calls++;
      return 7;
    });
    // Straggler re-presents the same (consumed) token → served from cache.
    const again = await r.rotate("R0", async () => {
      calls++;
      return 999;
    });
    expect(again).toBe(7);
    expect(calls).toBe(1);
  });

  it("stops replaying once the grace window elapses", async () => {
    const r = new Rotator<number>(20);
    await r.rotate("R0", async () => 1);
    await new Promise((res) => setTimeout(res, 40));
    const next = await r.rotate("R0", async () => 2);
    expect(next).toBe(2);
  });

  it("propagates rotation failure to the awaiting caller", async () => {
    const r = new Rotator<number>();
    await expect(
      r.rotate("R0", async () => {
        throw new Error("backend down");
      }),
    ).rejects.toThrow("backend down");
    // A failed rotation is not cached → a fresh attempt runs again.
    const ok = await r.rotate("R0", async () => 5);
    expect(ok).toBe(5);
  });
});
