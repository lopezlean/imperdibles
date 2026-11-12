import { beforeAll, describe, expect, it } from "vitest";
import { CONFIG_LINK, setConfig } from "../../src/local/coupons/repo.js";
import { AFFILIATE_LEGEND, COUPONS_EMPTY, COUPONS_HOW_HEADING } from "../../src/output/copy.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";
import { seedCoupon } from "./support/seed-coupons.js";

const LINK = "https://meli.la/2AbCdEf";
const DAY = 24 * 60 * 60 * 1000;

describe("/cupones build", () => {
  let site: BuiltSite;
  let from: string;
  let until: string;

  beforeAll(async () => {
    const now = Date.now();
    from = new Date(now - DAY).toISOString();
    until = new Date(now + DAY).toISOString();
    site = await buildSite({
      seed: async (db) => {
        await setConfig(db, CONFIG_LINK, LINK);
        await seedCoupon(db, { code: "VIGENTE1", validFrom: from, validUntil: until, discountValue: 15, minPurchase: 50000, cap: 8000, scope: "Hogar" });
        await seedCoupon(db, { code: "LARGO1", validFrom: from, validUntil: until, scope: `Ropa ${"muy larga ".repeat(60)}FINAL` });
        await seedCoupon(db, { code: "VENCIDO1", validFrom: new Date(now - 3 * DAY).toISOString(), validUntil: new Date(now - DAY).toISOString() });
        await seedCoupon(db, { code: "RETIRADO1", status: "removed", validFrom: from, validUntil: until });
        await seedCoupon(db, { code: "PENDIENTE1", status: "pending", validFrom: from, validUntil: until });
      },
    });
  }, 120_000);

  it("renders the live coupon with its button, window and legend", () => {
    const html = site.read("cupones/index.html");
    expect(html).toContain("VIGENTE1");
    expect(html).toContain("15% OFF");
    expect(html).toContain("Compra mínima");
    expect(html).toContain("Tope de reintegro");
    expect(html).toContain("Aplica a");
    expect(html).toMatch(new RegExp(`<a[^>]*href="${LINK}"[^>]*>\\s*Usar\\s*</a>`));
    const anchor = /<a[^>]*data-copy="VIGENTE1"[^>]*>/.exec(html)![0];
    expect(anchor).toContain(`href="${LINK}"`);
    expect(anchor).toContain('rel="sponsored noopener"');
    expect(html).toContain(`data-from="${from}"`);
    expect(html).toContain(`data-until="${until}"`);
    expect(html).toContain(AFFILIATE_LEGEND);
    expect(html).toContain(COUPONS_HOW_HEADING);
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it("caps a long scope like the channel message does", () => {
    const html = site.read("cupones/index.html");
    expect(html).toContain("LARGO1");
    expect(html).not.toContain("FINAL");
  });

  it("omits expired, removed and pending coupons", () => {
    const html = site.read("cupones/index.html");
    for (const code of ["VENCIDO1", "RETIRADO1", "PENDIENTE1"]) expect(html).not.toContain(code);
  });

  it("has the canonical, the sitemap entry and a home link", () => {
    expect(site.read("cupones/index.html")).toContain('<link rel="canonical" href="https://imperdibles.com.ar/cupones/">');
    expect(site.read("sitemap-0.xml")).toContain("<loc>https://imperdibles.com.ar/cupones/</loc>");
    expect(site.read("index.html")).toContain('href="/cupones/"');
  });

  it("shows no coupons, only the empty state and the explanation, when the link is unset", async () => {
    const now = Date.now();
    const bare = await buildSite({
      seed: async (db) => {
        await seedCoupon(db, {
          code: "SINLINK1",
          validFrom: new Date(now - DAY).toISOString(),
          validUntil: new Date(now + DAY).toISOString(),
        });
      },
    });
    const html = bare.read("cupones/index.html");
    expect(html).toContain(COUPONS_EMPTY);
    expect(html).toContain(COUPONS_HOW_HEADING);
    expect(html).not.toContain("SINLINK1");
  }, 120_000);
});
