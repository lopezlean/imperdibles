import { afterEach, describe, expect, it, vi } from "vitest";
import type { IngestReport } from "../../../src/local/coupons/ingest.js";
import { runCouponRound, type RoundDeps } from "../../../src/local/coupons/round.js";

const REPORT: IngestReport = { posts: 3, stored: 2, extended: 1, duplicates: 0, rejected: 1, published: 2, failedPosts: 0 };

function setup(over: Partial<RoundDeps> = {}) {
  const log: string[] = [];
  const owner: string[] = [];
  let syncs = 0;
  const deps: RoundDeps = {
    ingest: async () => REPORT,
    sync: async () => {
      syncs++;
      return "unchanged";
    },
    notifyOwner: async (t) => void owner.push(t),
    log: (l) => void log.push(l),
    ...over,
  };
  return { deps, log, owner, syncs: () => syncs };
}

describe("runCouponRound", () => {
  it("logs a summary line", async () => {
    const s = setup();
    await runCouponRound(s.deps);
    const line = s.log.find((l) => l.includes("publicados 2"));
    expect(line).toBeDefined();
    expect(line).toContain("leídos 3");
    expect(line).toContain("web unchanged");
    expect(s.syncs()).toBe(1);
  });

  it('tells the owner "Falló la lectura de cupones: <message>" when ingest throws, and still syncs', async () => {
    const s = setup({
      ingest: async () => {
        throw new Error("d1 caído");
      },
    });
    await runCouponRound(s.deps);
    expect(s.owner).toEqual(["Falló la lectura de cupones: d1 caído"]);
    expect(s.syncs()).toBe(1);
  });

  it("logs and resolves when sync throws", async () => {
    const s = setup({
      sync: async () => {
        throw new Error("sync boom");
      },
    });
    await expect(runCouponRound(s.deps)).resolves.toBeUndefined();
    expect(s.log.join("\n")).toContain("sync boom");
  });

  it("never rejects, even if the owner notice fails", async () => {
    const s = setup({
      ingest: async () => {
        throw "not an error";
      },
      sync: async () => {
        throw new Error("x");
      },
      notifyOwner: async () => {
        throw new Error("tg down");
      },
    });
    await expect(runCouponRound(s.deps)).resolves.toBeUndefined();
    expect(s.log.join("\n")).toContain("tg down");
  });

  it("caps the error text sent to the owner at 500 characters", async () => {
    const s = setup({
      ingest: async () => {
        throw new Error("x".repeat(2000));
      },
    });
    await runCouponRound(s.deps);
    expect(s.owner[0]!.length).toBeLessThanOrEqual("Falló la lectura de cupones: ".length + 500);
  });

  describe("deadline", () => {
    afterEach(() => vi.useRealTimers());

    it("cuts a hung round after 10 minutes, logs, notifies the owner and resolves", async () => {
      vi.useFakeTimers();
      const s = setup({ ingest: () => new Promise<IngestReport>(() => undefined) });
      const done = runCouponRound(s.deps);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await expect(done).resolves.toBeUndefined();
      expect(s.owner).toEqual(["La ronda de cupones superó 10 minutos y se cortó."]);
      expect(s.log.join("\n")).toContain("10 minutos");
    });

    it("does not fire the deadline for a round that finishes", async () => {
      vi.useFakeTimers();
      const s = setup();
      await runCouponRound(s.deps);
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      expect(s.owner).toEqual([]);
    });
  });
});
