import { describe, expect, it } from "vitest";
import { buildAffiliateLink, parseAffiliateLink } from "../../src/output/affiliate-link.js";

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

describe("buildAffiliateLink", () => {
  const ids = { word: "someword", tool: "12345" };

  it("appends matt_word and matt_tool to a bare permalink", () => {
    expect(buildAffiliateLink("https://www.mercadolibre.com.ar/robot-x/p/MLA1", ids)).toBe(
      "https://www.mercadolibre.com.ar/robot-x/p/MLA1?matt_word=someword&matt_tool=12345",
    );
  });

  it("keeps other params and replaces existing affiliate params", () => {
    const out = new URL(
      buildAffiliateLink("https://www.mercadolibre.com.ar/p/MLA1?a=1&matt_word=old&matt_tool=9&b=2", ids),
    );
    expect(out.searchParams.getAll("matt_word")).toEqual(["someword"]);
    expect(out.searchParams.getAll("matt_tool")).toEqual(["12345"]);
    expect(out.searchParams.get("a")).toBe("1");
    expect(out.searchParams.get("b")).toBe("2");
  });

  it("rejects other hosts and non-https", () => {
    expect(() => buildAffiliateLink("https://www.fravega.com/p/1", ids)).toThrow();
    expect(() => buildAffiliateLink("http://www.mercadolibre.com.ar/p/1", ids)).toThrow();
    expect(() => buildAffiliateLink("https://www.mercadolibre.com.ar.evil.com/p/1", ids)).toThrow();
    expect(() => buildAffiliateLink("not a url", ids)).toThrow();
  });

  it("rejects empty ids", () => {
    expect(() => buildAffiliateLink("https://www.mercadolibre.com.ar/p/1", { word: "", tool: "1" })).toThrow();
  });
});
