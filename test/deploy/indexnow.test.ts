import { describe, expect, it } from "vitest";
import {
  INDEXNOW_CHUNK_SIZE,
  INDEXNOW_KEY,
  buildIndexNowPayloads,
  diffSitemaps,
  indexNowKeyBody,
  parseSitemap,
  parseSitemapIndex,
} from "../../src/deploy/indexnow.js";

const urlset = (items: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${items}</urlset>`;

describe("INDEXNOW_KEY", () => {
  it("is 32 hex characters", () => {
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is served as the whole body of its own file", () => {
    expect(indexNowKeyBody()).toBe(INDEXNOW_KEY);
  });
});

describe("parseSitemapIndex", () => {
  it("returns the child sitemap locations, ignoring the index's own lastmod", () => {
    const xml =
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://x.test/sitemap-0.xml</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod></sitemap><sitemap><loc>https://x.test/sitemap-1.xml</loc></sitemap></sitemapindex>';
    expect(parseSitemapIndex(xml)).toEqual(["https://x.test/sitemap-0.xml", "https://x.test/sitemap-1.xml"]);
  });

  it("returns an empty list for a plain urlset", () => {
    expect(parseSitemapIndex(urlset("<url><loc>https://x.test/</loc></url>"))).toEqual([]);
  });
});

describe("parseSitemap", () => {
  it("maps loc to lastmod and skips image:loc entries", () => {
    const xml = urlset(
      "<url><loc>https://x.test/a/</loc><lastmod>2026-11-12T12:00:00.000Z</lastmod><image:image><image:loc>https://img.test/1.jpg</image:loc></image:image></url>" +
        "<url><loc>https://x.test/b/</loc></url>",
    );
    expect([...parseSitemap(xml)]).toEqual([
      ["https://x.test/a/", "2026-11-12T12:00:00.000Z"],
      ["https://x.test/b/", ""],
    ]);
  });

  it("decodes XML entities in locations", () => {
    const map = parseSitemap(urlset("<url><loc>https://x.test/?a=1&amp;b=2</loc></url>"));
    expect([...map.keys()]).toEqual(["https://x.test/?a=1&b=2"]);
  });

  it("returns an empty map for text that is not a sitemap", () => {
    expect(parseSitemap("<html>nope</html>").size).toBe(0);
  });
});

describe("diffSitemaps", () => {
  const built = new Map([
    ["https://x.test/a/", "1"],
    ["https://x.test/b/", "2"],
    ["https://x.test/c/", "3"],
  ]);

  it("returns new urls and urls whose lastmod changed, in built order", () => {
    const live = new Map([
      ["https://x.test/a/", "1"],
      ["https://x.test/b/", "old"],
      ["https://x.test/gone/", "9"],
    ]);
    expect(diffSitemaps(live, built)).toEqual(["https://x.test/b/", "https://x.test/c/"]);
  });

  it("returns nothing when the sitemaps match", () => {
    expect(diffSitemaps(new Map(built), built)).toEqual([]);
  });

  it("returns every built url when there is no live sitemap", () => {
    expect(diffSitemaps(null, built)).toEqual([...built.keys()]);
  });
});

describe("buildIndexNowPayloads", () => {
  const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://imperdibles.com.ar/p/${i}/`);

  it("builds one payload with host, key, keyLocation and urlList", () => {
    expect(buildIndexNowPayloads("https://imperdibles.com.ar", urls(2))).toEqual([
      {
        host: "imperdibles.com.ar",
        key: INDEXNOW_KEY,
        keyLocation: `https://imperdibles.com.ar/${INDEXNOW_KEY}.txt`,
        urlList: urls(2),
      },
    ]);
  });

  it("chunks the list at 10000 urls", () => {
    expect(INDEXNOW_CHUNK_SIZE).toBe(10_000);
    const payloads = buildIndexNowPayloads("https://imperdibles.com.ar", urls(10_001));
    expect(payloads.map((p) => p.urlList.length)).toEqual([10_000, 1]);
  });

  it("builds nothing for an empty list", () => {
    expect(buildIndexNowPayloads("https://imperdibles.com.ar", [])).toEqual([]);
  });
});
