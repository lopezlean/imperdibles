import { describe, expect, it } from "vitest";
import { CONFIG_LINK, setConfig } from "../../src/local/coupons/repo.js";
import { loadCouponSiteData } from "../../site/lib/coupons.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { seedCoupon } from "./support/seed-coupons.js";

const NOW = new Date("2026-11-12T15:00:00.000Z");
const LINK = "https://meli.la/2AbCdEf";
const past = "2026-11-12T10:00:00.000Z";
const soon = "2026-11-12T20:00:00.000Z";
const later = "2026-11-13T02:59:59.000Z";

async function withLink() {
  const db = createSqliteClient();
  await setConfig(db, CONFIG_LINK, LINK);
  return db;
}

describe("loadCouponSiteData", () => {
  it("returns published coupons whose valid_until is after now, soonest expiry first then id", async () => {
    const db = await withLink();
    await seedCoupon(db, { code: "TARDE", validFrom: past, validUntil: later });
    await seedCoupon(db, { code: "PRONTOB", validFrom: past, validUntil: soon });
    await seedCoupon(db, { code: "PRONTOA", validFrom: past, validUntil: soon });
    const data = await loadCouponSiteData(db, NOW);
    expect(data.link).toBe(LINK);
    expect(data.coupons.map((c) => c.code)).toEqual(["PRONTOB", "PRONTOA", "TARDE"]);
    expect(Object.keys(data.coupons[0]!).sort()).toEqual([
      "cap",
      "code",
      "discount_type",
      "discount_value",
      "id",
      "min_purchase",
      "scope",
      "valid_from",
      "valid_until",
    ]);
  });

  it("excludes pending, removed and expired rows", async () => {
    const db = await withLink();
    await seedCoupon(db, { code: "OK", validFrom: past, validUntil: soon });
    await seedCoupon(db, { code: "PEND", status: "pending", validFrom: past, validUntil: soon });
    await seedCoupon(db, { code: "GONE", status: "removed", validFrom: past, validUntil: soon });
    await seedCoupon(db, { code: "OLD", validFrom: "2026-11-10T00:00:00.000Z", validUntil: "2026-11-12T14:59:59.000Z" });
    const data = await loadCouponSiteData(db, NOW);
    expect(data.coupons.map((c) => c.code)).toEqual(["OK"]);
  });

  it("keeps a coupon whose window has not started yet", async () => {
    const db = await withLink();
    await seedCoupon(db, { code: "FUTURO", validFrom: "2026-11-12T18:00:00.000Z", validUntil: later });
    const data = await loadCouponSiteData(db, NOW);
    expect(data.coupons.map((c) => c.code)).toEqual(["FUTURO"]);
  });

  it("returns link null and no coupons when coupons_affiliate_link is unset", async () => {
    const db = createSqliteClient();
    await seedCoupon(db, { code: "OK", validFrom: past, validUntil: soon });
    expect(await loadCouponSiteData(db, NOW)).toEqual({ link: null, coupons: [] });
  });

  it("returns link null and no coupons when the coupons table does not exist yet", async () => {
    const db = await withLink();
    db.raw.exec("DROP TABLE coupons");
    expect(await loadCouponSiteData(db, NOW)).toEqual({ link: null, coupons: [] });
  });

  it("still throws any other database error", async () => {
    const db = {
      all: async () => {
        throw new Error("D1 unavailable");
      },
      run: async () => ({ changes: 0 }),
    };
    await expect(loadCouponSiteData(db, NOW)).rejects.toThrow("D1 unavailable");
  });
});
