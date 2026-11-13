import { describe, expect, it } from "vitest";
import { shareText } from "../../src/output/copy.js";
import { shareMessage, whatsappUrl } from "../../site/lib/share.js";

describe("share", () => {
  it("shareText carries the title, the price and the discount", () => {
    const text = shareText("Robot Zeta", 329999, "17,5");
    expect(text).toContain("Robot Zeta");
    expect(text).toContain("$329.999");
    expect(text).toContain("17,5%");
  });

  it("shareMessage puts the page URL first and the affiliate buy link below it", () => {
    const msg = shareMessage("Robot Zeta: $1.", "https://x.test/producto/a/", "https://meli.la/abc");
    expect(msg).toBe("Robot Zeta: $1.\nhttps://x.test/producto/a/\n\nComprar en Mercado Libre: https://meli.la/abc");
  });

  it("whatsappUrl encodes the whole message", () => {
    const url = whatsappUrl("Robot & Co\nhttps://x.test/p/");
    expect(url).toBe(`https://wa.me/?text=${encodeURIComponent("Robot & Co\nhttps://x.test/p/")}`);
    expect(url).not.toContain("& ");
  });
});
