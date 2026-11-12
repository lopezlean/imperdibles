import { describe, expect, it } from "vitest";
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
});
