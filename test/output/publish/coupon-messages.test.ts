import { describe, expect, it } from "vitest";
import type { Coupon } from "../../../src/contract/coupon.js";
import { AFFILIATE_LEGEND } from "../../../src/output/copy.js";
import {
  buildCouponChannelMessage,
  buildCouponOwnerNotice,
  buildCouponRejectedNotice,
  SCOPE_LIMIT,
} from "../../../src/output/publish/coupon-messages.js";

const LINK = "https://meli.la/2AbC_xY?r=1/";
const base: Coupon = {
  code: "CYBERALMAX",
  discount_type: "amount",
  discount_value: 20000,
  min_purchase: 250000,
  cap: null,
  scope: "",
  valid_from: "2026-11-04T13:00:00.000Z",
  valid_until: "2026-11-05T02:59:59.000Z",
};
const HINT = 'Para bajarlo, responder "rechazar".';

describe("buildCouponChannelMessage", () => {
  it("renders the golden message", () => {
    expect(buildCouponChannelMessage(base, LINK)).toBe(
      [
        "🎟️ Cupón de Mercado Libre: CYBERALMAX",
        "$20.000 OFF",
        "Compra mínima: $250.000",
        "Válido el 04/11 de 10:00 a 23:59 hs",
        LINK,
        "",
        AFFILIATE_LEGEND,
      ].join("\n"),
    );
  });

  it("adds the cap after the minimum and the scope after the cap when present", () => {
    const msg = buildCouponChannelMessage(
      { ...base, code: "FLASH25", discount_type: "percent", discount_value: 25, cap: 10000, scope: "Tecnología" },
      LINK,
    );
    expect(msg.split("\n").slice(0, 6)).toEqual([
      "🎟️ Cupón de Mercado Libre: FLASH25",
      "25% OFF",
      "Compra mínima: $250.000",
      "Tope de reintegro: $10.000",
      "Aplica a: Tecnología",
      "Válido el 04/11 de 10:00 a 23:59 hs",
    ]);
  });

  it("omits minimum, cap and scope lines when null or empty", () => {
    const msg = buildCouponChannelMessage({ ...base, min_purchase: null, cap: null, scope: "  " }, LINK);
    expect(msg).not.toContain("Compra mínima");
    expect(msg).not.toContain("Tope");
    expect(msg).not.toContain("Aplica a");
  });

  it("keeps the link byte for byte and the legend last under a 5000-character scope", () => {
    const msg = buildCouponChannelMessage({ ...base, scope: "x".repeat(5000) }, LINK);
    expect(msg.length).toBeLessThanOrEqual(4096);
    expect(msg).toContain(`Aplica a: ${"x".repeat(SCOPE_LIMIT - 1)}…\n`);
    expect(msg.split("\n")).toContain(LINK);
    expect(msg.endsWith(AFFILIATE_LEGEND)).toBe(true);
  });

  it("caps the scope at exactly 300 characters", () => {
    const at = buildCouponChannelMessage({ ...base, scope: "a".repeat(300) }, LINK);
    expect(at).toContain(`Aplica a: ${"a".repeat(300)}\n`);
    const over = buildCouponChannelMessage({ ...base, scope: "a".repeat(301) }, LINK);
    expect(over).toContain(`Aplica a: ${"a".repeat(299)}…\n`);
  });

  it("renders the scope as a single plain line", () => {
    const msg = buildCouponChannelMessage({ ...base, scope: "Hogar\n\n  y   jardín\r\nhttps://evil.example" }, LINK);
    expect(msg).toContain("Aplica a: Hogar y jardín https://evil.example\n");
  });
});

describe("buildCouponOwnerNotice", () => {
  it("quotes the source and ends with the reject hint", () => {
    const msg = buildCouponOwnerNotice(base, "Cupón CYBERALMAX $20.000");
    expect(msg.startsWith("Cupón publicado: CYBERALMAX ($20.000 OFF)")).toBe(true);
    expect(msg).toContain("Mensaje original:\nCupón CYBERALMAX $20.000");
    expect(msg.endsWith(HINT)).toBe(true);
  });

  it("stays within 4096 characters with a 10000-character source, keeping the hint", () => {
    const msg = buildCouponOwnerNotice(base, "y".repeat(10000));
    expect(msg.length).toBeLessThanOrEqual(4096);
    expect(msg).toContain("…");
    expect(msg.endsWith(HINT)).toBe(true);
  });
});

describe("buildCouponRejectedNotice", () => {
  const cases = [
    ["code_not_in_text", "el código no aparece en el mensaje"],
    ["number_not_in_text", "un monto o porcentaje no aparece en el mensaje"],
    ["invalid_value", "algún valor no es válido"],
    ["invalid_validity", "la vigencia no es válida"],
    ["extraction_failed", "no se pudo leer el mensaje tras 3 intentos"],
  ] as const;

  it.each(cases)("explains %s", (reason, text) => {
    const msg = buildCouponRejectedNotice({ reason, code: "ABC", sourceText: "fuente" });
    expect(msg.startsWith(`No publicado: ${text}.`)).toBe(true);
    expect(msg).toContain("Código: ABC");
    expect(msg).toContain("Mensaje original:\nfuente");
  });

  it("omits the code line when there is no code", () => {
    expect(buildCouponRejectedNotice({ reason: "extraction_failed", code: null, sourceText: "s" })).not.toContain(
      "Código:",
    );
  });

  it("stays within 4096 characters with a 10000-character source", () => {
    const msg = buildCouponRejectedNotice({ reason: "code_not_in_text", code: "ABC", sourceText: "z".repeat(10000) });
    expect(msg.length).toBeLessThanOrEqual(4096);
    expect(msg).toContain("…");
  });
});
