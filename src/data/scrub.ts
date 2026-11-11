import type { SqlClient } from "../shared/db/sql-client.js";
import type { LocalEnv } from "../shared/env.js";

export type Scrubber = {
  /** Remembers a secret value; empty and nullish values are ignored. */
  hold(value: string | null | undefined): void;
  /** Also remembers the stored ML token pair. D1 being unreachable is not an error here. */
  holdStoredTokens(): Promise<void>;
  /** Replaces every held secret, and any Telegram bot URL, so the text is safe to log, print or send. */
  scrub(text: string): string;
};

/** Every secret this process holds: env values (unset ones are skipped) and the stored ML token pair. */
export function createScrubber(db: SqlClient, env: LocalEnv): Scrubber {
  const held = new Set<string>();
  const hold = (value: string | null | undefined) => {
    if (value) held.add(value);
  };
  for (const value of [env.mlClientSecret, env.cfApiToken, env.telegramBotToken, env.publishNowSecret]) hold(value);
  return {
    hold,
    async holdStoredTokens() {
      try {
        const rows = await db.all<{ access_token: string; refresh_token: string }>("SELECT access_token, refresh_token FROM tokens_ml WHERE id = 1");
        hold(rows[0]?.access_token);
        hold(rows[0]?.refresh_token);
      } catch {
        // D1 unreachable: the values already held still apply.
      }
    },
    scrub: (text) =>
      [...held]
        .sort((x, y) => y.length - x.length)
        .reduce((acc, secret) => acc.split(secret).join("[redacted]"), text)
        .replace(/\/bot\d+:[A-Za-z0-9_-]+/g, "/bot[redacted]"),
  };
}
