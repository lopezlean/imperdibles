/** Public by design: IndexNow verifies ownership by fetching `/<key>.txt` from the site. */
export const INDEXNOW_KEY = "8cff3afbd0aa8cb9b5527903564d4c08";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_CHUNK_SIZE = 10_000;

export type IndexNowPayload = { host: string; key: string; keyLocation: string; urlList: string[] };

/** Body of `/<key>.txt`. */
export const indexNowKeyBody = (): string => INDEXNOW_KEY;

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** `<loc>` text of each `<tag>` block; `<image:loc>` never matches because it is a different element. */
function blocks(xml: string, tag: string): { loc: string; body: string }[] {
  const out: { loc: string; body: string }[] = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))) {
    const body = m[1]!;
    const loc = /<loc>([^<]*)<\/loc>/.exec(body)?.[1];
    if (loc !== undefined) out.push({ loc: decodeXml(loc.trim()), body });
  }
  return out;
}

/** Child sitemap locations of a sitemap index; empty for anything else. */
export const parseSitemapIndex = (xml: string): string[] => blocks(xml, "sitemap").map((b) => b.loc);

/** Page URL to lastmod ("" when absent) for one urlset sitemap. */
export function parseSitemap(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { loc, body } of blocks(xml, "url")) {
    map.set(loc, decodeXml(/<lastmod>([^<]*)<\/lastmod>/.exec(body)?.[1]?.trim() ?? ""));
  }
  return map;
}

/** Built URLs that are new or whose lastmod differs from the live sitemap; all of them when `live` is null. */
export function diffSitemaps(live: Map<string, string> | null, built: Map<string, string>): string[] {
  return [...built].filter(([url, lastmod]) => live === null || live.get(url) !== lastmod).map(([url]) => url);
}

export function buildIndexNowPayloads(siteUrl: string, urls: string[]): IndexNowPayload[] {
  const base = siteUrl.replace(/\/+$/, "");
  const payloads: IndexNowPayload[] = [];
  for (let i = 0; i < urls.length; i += INDEXNOW_CHUNK_SIZE) {
    payloads.push({
      host: new URL(base).host,
      key: INDEXNOW_KEY,
      keyLocation: `${base}/${INDEXNOW_KEY}.txt`,
      urlList: urls.slice(i, i + INDEXNOW_CHUNK_SIZE),
    });
  }
  return payloads;
}
