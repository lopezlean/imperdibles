export const MAX_PUBLISH_CALLS = 10;

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
  const res = await doFetch(url, { method: "POST", headers: { Authorization: `Bearer ${deps.publishNowSecret}` } });
  if (!res.ok) throw new Error(`publish-now answered ${res.status}`);
  const body = (await res.json()) as { published?: unknown };
  return Array.isArray(body.published) ? body.published.length : 0;
}

/**
 * Publishes pending deals (unless `siteOnly`), builds the static site and uploads the Worker.
 * A publish failure never stops the site deploy. Resolves with the process exit code.
 */
export async function ship(deps: ShipDeps, opts: { siteOnly: boolean }): Promise<number> {
  if (!opts.siteOnly) {
    for (let i = 1; i <= MAX_PUBLISH_CALLS; i++) {
      try {
        const published = await publishOnce(deps);
        deps.log(`publish call ${i}: ${published} published`);
        if (published === 0) break;
      } catch (e) {
        deps.log(`publish failed, continuing with the site deploy: ${errText(e)}`);
        break;
      }
    }
  }

  const failed = (step: string): number => {
    deps.log(`${step} failed.${opts.siteOnly ? "" : " Telegram posts already went out."}`);
    return 1;
  };
  if ((await deps.exec("pnpm", ["exec", "astro", "build"])) !== 0) return failed("Site build");
  if ((await deps.exec("pnpm", ["exec", "wrangler", "deploy"])) !== 0) return failed("Worker upload");
  return 0;
}
