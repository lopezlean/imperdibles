import type { LocalOutputHooks } from "../contract/local-hooks.js";
import type { SqlClient } from "../shared/db/sql-client.js";
import type { LocalEnv } from "../shared/env.js";

export type OutputHookDeps = { db: SqlClient; env: LocalEnv; now: () => Date; fetch: typeof fetch };

/** Stub: the output plan replaces this body. */
export function createOutputHooks(_deps: OutputHookDeps): LocalOutputHooks {
  const log = (method: string) => {
    process.stderr.write(`[output-hooks stub] ${method}\n`);
    return Promise.resolve();
  };
  return {
    onCandidatesReady: () => log("onCandidatesReady"),
    onRevalidated: () => log("onRevalidated"),
    notifyOwner: () => log("notifyOwner"),
  };
}
