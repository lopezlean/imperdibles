export const MAX_PUBLISH_CALLS = 10;
export const PUBLISH_TIMEOUT_MS = 60_000;

/** Exit codes: 0 all good, 1 build or upload failed, 2 site deployed but a publish call failed. */
export const EXIT_PUBLISH_FAILED = 2;

export type ShipDeps = {
  fetch: typeof fetch;
  /** Runs a command and resolves with its exit code. */
  exec: (cmd: string, args: string[]) => Promise<number>;
  log: (line: string) => void;
  workerBaseUrl: string;
  publishNowSecret: string;
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

/**
 * Publishes pending deals (unless `siteOnly`), builds the static site and uploads the Worker.
 * A publish failure never stops the site deploy, but it is reported through the exit code:
 * 0 success, 1 build or upload failed, 2 site deployed but a publish call failed.
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

  const failed = (step: string): number => {
    deps.log(`${step} failed.${publishedTotal > 0 ? " Telegram posts already went out." : ""}`);
    return 1;
  };
  if ((await deps.exec("pnpm", ["exec", "astro", "build"])) !== 0) return failed("Site build");
  if ((await deps.exec("pnpm", ["exec", "wrangler", "deploy"])) !== 0) return failed("Worker upload");
  return publishFailed ? EXIT_PUBLISH_FAILED : 0;
}
