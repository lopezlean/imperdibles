import { describe, expect, it } from "vitest";
import { formatDiscount, formatValidity } from "../../src/output/coupon-format.js";

describe("formatDiscount", () => {
  it("formats an amount as ARS OFF", () => {
    expect(formatDiscount({ discount_type: "amount", discount_value: 20000 })).toBe("$20.000 OFF");
  });
  it("formats a percent", () => {
    expect(formatDiscount({ discount_type: "percent", discount_value: 10 })).toBe("10% OFF");
  });
});

describe("formatValidity", () => {
  it("shows a same-day window with its start time", () => {
    expect(formatValidity("2026-11-04T13:00:00.000Z", "2026-11-05T02:59:59.000Z")).toBe(
      "Válido el 04/11 de 10:00 a 23:59 hs",
    );
  });
  it("shows only the expiry when the window starts at midnight ART", () => {
    expect(formatValidity("2026-11-04T03:00:00.000Z", "2026-11-05T02:59:59.000Z")).toBe("Vence el 04/11 a las 23:59 hs");
  });
  it("shows only the expiry when the window spans several ART days", () => {
    expect(formatValidity("2026-11-04T13:00:00.000Z", "2026-11-10T02:59:59.000Z")).toBe("Vence el 09/11 a las 23:59 hs");
  });
});
