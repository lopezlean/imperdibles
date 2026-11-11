import { describe, expect, it } from "vitest";
import { parseAffiliateLink } from "../../src/output/affiliate-link.js";

describe("parseAffiliateLink", () => {
  it("accepts a meli.la link and returns the exact trimmed substring", () => {
    expect(parseAffiliateLink("  https://meli.la/2AbC_xY?r=1/  ")).toEqual({ ok: true, link: "https://meli.la/2AbC_xY?r=1/" });
  });

  it("stores the link as typed, not normalized", () => {
    expect(parseAffiliateLink("https://MELI.LA/Xy")).toEqual({ ok: true, link: "https://MELI.LA/Xy" });
  });

  it.each([
    ["Acá está: https://meli.la/x", "not_single_url"],
    ["https://meli.la/a https://meli.la/b", "not_single_url"],
    ["http://meli.la/x", "not_https"],
    ["https://www.meli.la/x", "wrong_host"],
    ["https://meli.la.evil.com/x", "wrong_host"],
    ["https://xmeli.la/x", "wrong_host"],
    ["https://articulo.mercadolibre.com.ar/MLA-1", "wrong_host"],
    ["", "empty"],
    ["   ", "empty"],
    ["https://", "wrong_host"],
  ])("rejects %s", (text, reason) => {
    expect(parseAffiliateLink(text)).toEqual({ ok: false, reason });
  });
});
