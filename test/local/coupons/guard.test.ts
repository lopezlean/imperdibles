import { describe, expect, it } from "vitest";
import type { ExtractedCoupon } from "../../../src/contract/coupon.js";
import { containsNumber, containsToken, guardCoupon } from "../../../src/local/coupons/guard.js";
import { loadCouponPosts, postById } from "../../support/coupon-fixtures.js";

const MIN5 = 5 * 60 * 1000;

function base(over: Partial<ExtractedCoupon> = {}): ExtractedCoupon {
  return {
    code: "CHEEKY",
    discount_type: "amount",
    discount_value: 5000,
    min_purchase: null,
    cap: null,
    scope: "",
    valid_from: null,
    valid_until: null,
    ...over,
  };
}

const POST = { text: "Cupón CHEEKY $5.000 OFF", postedAt: new Date("2026-11-12T10:00:00-03:00") };
const NOW = new Date(POST.postedAt.getTime() + MIN5);

function guard(over: Partial<ExtractedCoupon>, text = POST.text, now = NOW) {
  return guardCoupon(base(over), { text, postedAt: POST.postedAt }, now);
}

function okCoupon(id: number, code: string) {
  const post = postById(id);
  const extracted = post.coupons.find((c) => c.code === code)!;
  const r = guardCoupon(extracted, post, new Date(post.postedAt.getTime() + MIN5));
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.coupon;
}

describe("guardCoupon", () => {
  it("accepts every golden coupon of every fixture post", () => {
    for (const post of loadCouponPosts()) {
      for (const c of post.coupons) {
        const r = guardCoupon(c, post, new Date(post.postedAt.getTime() + MIN5));
        expect(r, `${post.id} ${c.code}`).toMatchObject({ ok: true });
      }
    }
  });

  it("CYBERALMAX window 10:00-23:59 ART", () => {
    const c = okCoupon(2874, "CYBERALMAX");
    expect(c.valid_from).toBe("2026-11-04T13:00:00.000Z");
    expect(c.valid_until).toBe("2026-11-05T02:59:59.000Z");
  });

  it("FLASH25 without validity defaults from the post time to 23:59:59 ART of the post day", () => {
    const c = okCoupon(136, "FLASH25");
    expect(c.valid_from).toBe("2025-09-25T13:00:11.000Z");
    expect(c.valid_until).toBe("2025-09-26T02:59:59.000Z");
  });

  it("GLDY9A window", () => {
    const c = okCoupon(149, "GLDY9A");
    expect(c.valid_from).toBe("2025-09-29T15:00:00.000Z");
    expect(c.valid_until).toBe("2025-09-29T18:00:00.000Z");
  });

  it("47EXTRA10 date-only range", () => {
    const c = okCoupon(2853, "47EXTRA10");
    expect(c.valid_from).toBe("2026-11-02T03:00:00.000Z");
    expect(c.valid_until).toBe("2026-11-10T02:59:59.000Z");
  });

  it("valid_until at 00:00 is the end of the previous day", () => {
    const r = guard({ valid_from: "2026-11-12T10:00", valid_until: "2026-11-13T00:00" });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.coupon.valid_until).toBe("2026-11-13T02:59:59.000Z");
  });

  it("only an exact 23:59 valid_until gets 59 seconds", () => {
    const r = guard({ valid_from: "2026-11-12T10:00", valid_until: "2026-11-12T15:00" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.coupon.valid_until).toBe("2026-11-12T18:00:00.000Z");
    const r2 = guard({ valid_from: "2026-11-12T10:00", valid_until: "2026-11-12T23:59" });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.coupon.valid_until).toBe("2026-11-13T02:59:59.000Z");
  });

  it("a post at 23:50 ART with no validity ends that ART day, not the UTC day", () => {
    const postedAt = new Date("2026-11-12T23:50:00-03:00");
    const r = guardCoupon(base(), { text: POST.text, postedAt }, new Date(postedAt.getTime() + 60_000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.coupon.valid_until).toBe("2026-11-13T02:59:59.000Z");
  });

  it("rejects a code that is not in the text", () => {
    expect(guard({ code: "CYBERALMAX2" })).toEqual({ ok: false, reason: "code_not_in_text" });
  });

  it("rejects a code only inside a longer token", () => {
    expect(guard({ code: "CHEEKY" }, "Cupón CHEEKYS $5.000")).toEqual({ ok: false, reason: "code_not_in_text" });
    expect(guard({ code: "ABC", discount_value: 5000 }, "https://x.test/ABC1 $5.000")).toEqual({
      ok: false,
      reason: "code_not_in_text",
    });
  });

  it("is case-sensitive", () => {
    expect(guard({ code: "cheeky" })).toEqual({ ok: false, reason: "code_not_in_text" });
  });

  it("rejects when the discount, minimum or cap number is not in the text", () => {
    const text = "Cupón CHEEKY $5.000 OFF compra mínima $250.000";
    expect(guard({ discount_value: 45001 }, text)).toEqual({ ok: false, reason: "number_not_in_text" });
    expect(guard({ min_purchase: 25000 }, text)).toEqual({ ok: false, reason: "number_not_in_text" });
    expect(guard({ cap: 999 }, text)).toEqual({ ok: false, reason: "number_not_in_text" });
    expect(guard({ min_purchase: 250000 }, text)).toMatchObject({ ok: true });
  });

  it("does not satisfy a number with digits embedded in the code or a URL", () => {
    const flash = postById(136);
    const c = { ...flash.coupons[0]!, discount_value: 25 };
    expect(guardCoupon(c, flash, new Date(flash.postedAt.getTime() + MIN5))).toEqual({
      ok: false,
      reason: "number_not_in_text",
    });
    expect(guard({ discount_value: 3 }, "Cupón CHEEKY $5.000 https://tinyurl.com/yvd3x")).toEqual({
      ok: false,
      reason: "number_not_in_text",
    });
  });

  it("rejects invalid values", () => {
    for (const over of [
      { discount_value: -5 },
      { discount_value: 0 },
      { discount_type: "percent" as const, discount_value: 101 },
      { discount_value: 5000.5 },
      { code: "AB C" },
      { code: "AB" },
      { code: "ab-c" },
      { min_purchase: -1 },
      { cap: 0.5 },
    ]) {
      expect(guard(over), JSON.stringify(over)).toEqual({ ok: false, reason: "invalid_value" });
    }
  });

  it("rejects valid_until not after valid_from and unparsable dates", () => {
    expect(guard({ valid_from: "2026-11-12T15:00", valid_until: "2026-11-12T12:00" })).toEqual({
      ok: false,
      reason: "invalid_validity",
    });
    expect(guard({ valid_from: "mañana", valid_until: null })).toEqual({ ok: false, reason: "invalid_validity" });
    expect(guard({ valid_until: "2026-13-45" })).toEqual({ ok: false, reason: "invalid_validity" });
  });

  it("rejects a coupon whose valid_until is already past", () => {
    expect(guard({ valid_from: "2026-11-12T09:00", valid_until: "2026-11-12T09:30" })).toEqual({
      ok: false,
      reason: "already_expired",
    });
  });
});

describe("containsToken", () => {
  it("is whole-token and case-sensitive", () => {
    expect(containsToken("Cupón: CYBERALMAX!", "CYBERALMAX")).toBe(true);
    expect(containsToken("CHEEKYS", "CHEEKY")).toBe(false);
    expect(containsToken("xCHEEKY", "CHEEKY")).toBe(false);
    expect(containsToken("cheeky", "CHEEKY")).toBe(false);
    expect(containsToken("cheeky-sale CHEEKY-X", "CHEEKY")).toBe(false);
    expect(containsToken("X_CHEEKY_Y", "CHEEKY")).toBe(false);
    expect(containsToken("Código: CHEEKY.", "CHEEKY")).toBe(true);
  });
});

describe("containsNumber", () => {
  it("compares whole numeric tokens with thousands separators stripped", () => {
    expect(containsNumber("$20.000 OFF", 20000)).toBe(true);
    expect(containsNumber("$1.000.000", 1000000)).toBe(true);
    expect(containsNumber("$15.000", 5000)).toBe(false);
    expect(containsNumber("250,000", 250000)).toBe(true);
    expect(containsNumber("10% OFF", 10)).toBe(true);
    expect(containsNumber("$5.250", 5250)).toBe(true);
    expect(containsNumber("$5.250.", 5250)).toBe(true);
    expect(containsNumber("9,5%", 95)).toBe(false);
    expect(containsNumber("1.5", 15)).toBe(false);
    expect(containsNumber("FLASH25 y 47EXTRA10 y GLDY9A", 25)).toBe(false);
    expect(containsNumber("https://tinyurl.com/mr44da4u", 44)).toBe(false);
    expect(containsNumber("https://tinyurl.com/mr44da4u 44 cosas", 44)).toBe(true);
  });
});
