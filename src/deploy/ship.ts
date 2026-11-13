import {
  INDEXNOW_ENDPOINT,
  buildIndexNowPayloads,
  diffSitemaps,
  parseSitemap,
  parseSitemapIndex,
} from "./indexnow.js";

export const MAX_PUBLISH_CALLS = 10;
export const PUBLISH_TIMEOUT_MS = 60_000;
export const SITEMAP_TIMEOUT_MS = 30_000;

/** Exit codes: 0 all good, 1 build or upload failed, 2 site deployed but a publish call failed. */
export const EXIT_PUBLISH_FAILED = 2;

export type ShipDeps = {
  fetch: typeof fetch;
  /** Runs a command and resolves with its exit code. */
  exec: (cmd: string, args: string[]) => Promise<number>;
  log: (line: string) => void;
  workerBaseUrl: string;
  publishNowSecret: string;
  /** Public site URL, e.g. https://imperdibles.com.ar. */
  siteUrl: string;
  /** Directory the static build writes to. */
  outDir: string;
  readFile: (path: string) => Promise<string>;
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** One publish-now call; resolves with how many deals it published. Throws on any failure. */
async function publishOnce(deps: ShipDeps): Promise<number> {
  const url = `${deps.workerBaseUrl.replace(/\/$/, "")}/internal/publish-now`;
  const doFetch = deps.fetch; // never deps.fetch(...): a foreign `this` breaks the global fetch
  const res = await doFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${deps.publishNowSecret}` },
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`publish-now answered ${res.status}`);
  const body = (await res.json()) as { published?: unknown };
  return Array.isArray(body.published) ? body.published.length : 0;
}

/** Every page URL (with lastmod) of a sitemap index and its children; `read` resolves a sitemap location to XML. */
async function collectSitemap(read: (loc: string) => Promise<string>, indexLoc: string): Promise<Map<string, string>> {
  const index = await read(indexLoc);
  const children = parseSitemapIndex(index);
  const pages = new Map<string, string>();
  for (const xml of children.length > 0 ? await Promise.all(children.map(read)) : [index]) {
    for (const [url, lastmod] of parseSitemap(xml)) pages.set(url, lastmod);
  }
  return pages;
}

/** The live sitemap, or null when it cannot be fetched or has no URLs (then everything counts as changed). */
async function liveSitemap(deps: ShipDeps): Promise<Map<string, string> | null> {
  const doFetch = deps.fetch;
  try {
    const pages = await collectSitemap(async (loc) => {
      const res = await doFetch(loc, { signal: AbortSignal.timeout(SITEMAP_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`${loc} answered ${res.status}`);
      return res.text();
    }, `${deps.siteUrl}/sitemap-index.xml`);
    return pages.size > 0 ? pages : null;
  } catch (e) {
    deps.log(`live sitemap unavailable, treating every URL as changed: ${errText(e)}`);
    return null;
  }
}

/** Children are listed by their live URL; on disk they sit next to the index under the same file name. */
const builtSitemap = (deps: ShipDeps): Promise<Map<string, string>> =>
  collectSitemap(
    (loc) => deps.readFile(`${deps.outDir}/${loc.split("/").pop()}`),
    `${deps.outDir}/sitemap-index.xml`,
  );

/** Tells IndexNow about the changed URLs. Never throws: a failure only logs a warning. */
async function notifyIndexNow(deps: ShipDeps, live: Map<string, string> | null): Promise<void> {
  try {
    const changed = diffSitemaps(live, await builtSitemap(deps));
    if (changed.length === 0) {
      deps.log("IndexNow: no changed URLs to submit");
      return;
    }
    const doFetch = deps.fetch;
    let submitted = 0;
    for (const payload of buildIndexNowPayloads(deps.siteUrl, changed)) {
      const res = await doFetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SITEMAP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`IndexNow answered ${res.status}`);
      submitted += payload.urlList.length;
    }
    deps.log(`IndexNow: submitted ${submitted} URLs`);
  } catch (e) {
    deps.log(`warning: IndexNow submit failed (the deploy is fine): ${errText(e)}`);
  }
}

/**
 * Publishes pending deals (unless `siteOnly`), builds the static site and uploads the Worker.
 * A publish failure never stops the site deploy, but it is reported through the exit code:
 * 0 success, 1 build or upload failed, 2 site deployed but a publish call failed.
 * After a successful deploy the URLs whose sitemap entry changed are sent to IndexNow; that step never alters the exit code.
 */
export async function ship(deps: ShipDeps, opts: { siteOnly: boolean }): Promise<number> {
  let publishedTotal = 0;
  let publishFailed = false;
  if (!opts.siteOnly) {
    for (let i = 1; i <= MAX_PUBLISH_CALLS; i++) {
      try {
        const published = await publishOnce(deps);
        publishedTotal += published;
        deps.log(`publish call ${i}: ${published} published`);
        if (published === 0) break;
      } catch (e) {
        publishFailed = true;
        deps.log(`publish failed, continuing with the site deploy: ${errText(e)}`);
        break;
      }
    }
  }

  const live = await liveSitemap(deps);
  const failed = (step: string): number => {
    deps.log(`${step} failed.${publishedTotal > 0 ? " Telegram posts already went out." : ""}`);
    return 1;
  };
  if ((await deps.exec("pnpm", ["exec", "astro", "build"])) !== 0) return failed("Site build");
  if ((await deps.exec("pnpm", ["exec", "wrangler", "deploy"])) !== 0) return failed("Worker upload");
  await notifyIndexNow(deps, live);
  return publishFailed ? EXIT_PUBLISH_FAILED : 0;
}
