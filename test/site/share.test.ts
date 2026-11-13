import { describe, expect, it } from "vitest";
import { shareText } from "../../src/output/copy.js";
import { whatsappUrl } from "../../site/lib/share.js";

describe("share", () => {
  it("shareText carries the title, the price and the discount", () => {
    const text = shareText("Robot Zeta", 329999, "17,5");
    expect(text).toContain("Robot Zeta");
    expect(text).toContain("$329.999");
    expect(text).toContain("17,5%");
  });

  it("whatsappUrl encodes the text and the page URL together", () => {
    const url = whatsappUrl("Robot & Co", "https://x.test/producto/a/");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).toContain(encodeURIComponent("Robot & Co https://x.test/producto/a/"));
    expect(url).not.toContain("& ");
  });
});
