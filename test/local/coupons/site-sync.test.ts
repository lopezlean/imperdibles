import { describe, expect, it } from "vitest";
import { CONFIG_FINGERPRINT, CONFIG_LINK, getConfig, setConfig } from "../../../src/local/coupons/repo.js";
import { couponFingerprint, shipWithFingerprint, syncSiteIfChanged } from "../../../src/local/coupons/site-sync.js";
import type { SqlClient } from "../../../src/shared/db/sql-client.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

const LINK = "https://meli.la/2AbC_xY?r=1/";
const NOW = new Date("2026-11-10T15:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

type Db = ReturnType<typeof createSqliteClient>;

let nextSource = 1;
function addCoupon(db: Db, code: string, over: { status?: string; until?: string } = {}) {
  db.raw
    .prepare(
      `INSERT INTO coupons (code, discount_type, discount_value, scope, valid_from, valid_until, status, source_message_id, source_text, created_at, updated_at)
       VALUES (?, 'amount', 1000, '', ?, ?, ?, ?, 'x', 'c', 'u')`,
    )
    .run(code, day(-1), over.until ?? day(1), over.status ?? "published", nextSource++);
}

async function withLink(db: Db) {
  await setConfig(db, CONFIG_LINK, LINK);
}

describe("couponFingerprint", () => {
  it('is "" without a link or without valid published coupons', async () => {
    const db = createSqliteClient();
    addCoupon(db, "AAA");
    expect(await couponFingerprint(db, NOW)).toBe("");
    await withLink(db);
    db.raw.exec("DELETE FROM coupons");
    expect(await couponFingerprint(db, NOW)).toBe("");
  });

  it("ignores pending, removed and expired rows", async () => {
    const db = createSqliteClient();
    await withLink(db);
    addCoupon(db, "P", { status: "pending" });
    addCoupon(db, "R", { status: "removed" });
    addCoupon(db, "E", { until: day(-0.5) });
    expect(await couponFingerprint(db, NOW)).toBe("");
    addCoupon(db, "OK");
    expect(await couponFingerprint(db, NOW)).toMatch(/^https:\/\/meli\.la\/2AbC_xY\?r=1\/\n\d+@/);
  });

  it("changes when a coupon expires (now moves), is removed, is extended, or the link changes", async () => {
    const db = createSqliteClient();
    await withLink(db);
    addCoupon(db, "A", { until: day(0.5) });
    addCoupon(db, "B", { until: day(2) });
    const base = await couponFingerprint(db, NOW);
    expect(base).not.toBe("");
    expect(await couponFingerprint(db, new Date(NOW.getTime() + 13 * 3_600_000))).not.toBe(base);
    db.raw.exec("UPDATE coupons SET valid_until = '2099-01-01T00:00:00.000Z' WHERE code = 'B'");
    const extended = await couponFingerprint(db, NOW);
    expect(extended).not.toBe(base);
    db.raw.exec("UPDATE coupons SET status = 'removed' WHERE code = 'B'");
    const removed = await couponFingerprint(db, NOW);
    expect(removed).not.toBe(extended);
    await setConfig(db, CONFIG_LINK, "https://meli.la/OTHER");
    expect(await couponFingerprint(db, NOW)).not.toBe(removed);
  });

  it("is stable under insertion order", async () => {
    const a = createSqliteClient();
    const b = createSqliteClient();
    await withLink(a);
    await withLink(b);
    const ins = (db: Db, code: string, id: number) =>
      db.raw
        .prepare(
          `INSERT INTO coupons (id, code, discount_type, discount_value, scope, valid_from, valid_until, status, source_message_id, source_text, created_at, updated_at)
           VALUES (?, ?, 'amount', 1000, '', ?, ?, 'published', ?, 'x', 'c', 'u')`,
        )
        .run(id, code, day(-1), day(1), id);
    ins(a, "X", 1);
    ins(a, "Y", 2);
    ins(b, "Y", 2);
    ins(b, "X", 1);
    expect(await couponFingerprint(a, NOW)).toBe(await couponFingerprint(b, NOW));
  });
});

describe("shipWithFingerprint", () => {
  async function seeded() {
    const db = createSqliteClient();
    await withLink(db);
    addCoupon(db, "A");
    return db;
  }

  it("stores the pre-ship fingerprint on exit 0 and on exit 2, not on exit 1", async () => {
    for (const [code, stored] of [[0, true], [2, true], [1, false]] as const) {
      const db = await seeded();
      const expected = await couponFingerprint(db, NOW);
      const run = shipWithFingerprint({ db, now: () => NOW }, async () => {
        // A coupon that appears while the ship runs must not be recorded as shipped.
        addCoupon(db, "LATE");
        return code;
      });
      expect(await run()).toBe(code);
      expect(await getConfig(db, CONFIG_FINGERPRINT)).toBe(stored ? expected : null);
    }
  });

  it("does not store when runShip throws (error propagates)", async () => {
    const db = await seeded();
    const run = shipWithFingerprint({ db, now: () => NOW }, async () => {
      throw new Error("boom");
    });
    await expect(run()).rejects.toThrow("boom");
    expect(await getConfig(db, CONFIG_FINGERPRINT)).toBeNull();
  });

  it("still ships when computing the fingerprint fails", async () => {
    const db = await seeded();
    const broken: SqlClient = {
      all: async () => {
        throw new Error("d1 down");
      },
      run: db.run,
    };
    let shipped = 0;
    const run = shipWithFingerprint({ db: broken, now: () => NOW }, async () => {
      shipped++;
      return 0;
    });
    expect(await run()).toBe(0);
    expect(shipped).toBe(1);
  });

  it("still returns the ship code when storing the fingerprint fails", async () => {
    const db = await seeded();
    const broken: SqlClient = {
      all: db.all,
      run: async () => {
        throw new Error("d1 down");
      },
    };
    expect(await shipWithFingerprint({ db: broken, now: () => NOW }, async () => 0)()).toBe(0);
  });
});

describe("syncSiteIfChanged", () => {
  function setup(db: Db, exit = 0) {
    const calls = { ship: 0, owner: [] as string[] };
    const deps = {
      db,
      now: () => NOW,
      runShipSiteOnly: async () => {
        calls.ship++;
        return exit;
      },
      notifyOwner: async (t: string) => void calls.owner.push(t),
    };
    return { deps, calls };
  }

  it("does nothing when the fingerprint matches (including first run with no coupons)", async () => {
    const db = createSqliteClient();
    const { deps, calls } = setup(db);
    expect(await syncSiteIfChanged(deps)).toBe("unchanged");
    expect(calls.ship).toBe(0);
  });

  it("ships --site-only exactly once when it differs and stores it", async () => {
    const db = createSqliteClient();
    await withLink(db);
    addCoupon(db, "A");
    const { deps, calls } = setup(db);
    expect(await syncSiteIfChanged(deps)).toBe("shipped");
    expect(await syncSiteIfChanged(deps)).toBe("unchanged");
    expect(calls.ship).toBe(1);
    expect(await getConfig(db, CONFIG_FINGERPRINT)).toBe(await couponFingerprint(db, NOW));
  });

  it('exit 1 returns "failed", tells the owner and keeps the old fingerprint', async () => {
    const db = createSqliteClient();
    await withLink(db);
    addCoupon(db, "A");
    const { deps, calls } = setup(db, 1);
    expect(await syncSiteIfChanged(deps)).toBe("failed");
    expect(calls.owner).toEqual(["No se pudo actualizar la web con los cupones. Se reintenta en la próxima revalidación."]);
    expect(await getConfig(db, CONFIG_FINGERPRINT)).toBeNull();
  });

  it("a throwing site-only ship is also a failure", async () => {
    const db = createSqliteClient();
    await withLink(db);
    addCoupon(db, "A");
    const { deps, calls } = setup(db);
    const result = await syncSiteIfChanged({
      ...deps,
      runShipSiteOnly: async () => {
        throw new Error("spawn");
      },
    });
    expect(result).toBe("failed");
    expect(calls.owner).toHaveLength(1);
  });

  it("no double ship: a deal ship stores the fingerprint, later changes cause exactly one more site-only ship", async () => {
    const db = createSqliteClient();
    await withLink(db);
    addCoupon(db, "A");
    let execs = 0;
    const exec = async () => {
      execs++;
      return 0;
    };
    await shipWithFingerprint({ db, now: () => NOW }, exec)();
    const { deps } = setup(db);
    expect(await syncSiteIfChanged({ ...deps, runShipSiteOnly: exec })).toBe("unchanged");
    expect(execs).toBe(1);
    addCoupon(db, "B");
    expect(await syncSiteIfChanged({ ...deps, runShipSiteOnly: exec })).toBe("shipped");
    expect(await syncSiteIfChanged({ ...deps, runShipSiteOnly: exec })).toBe("unchanged");
    expect(execs).toBe(2);
  });
});
