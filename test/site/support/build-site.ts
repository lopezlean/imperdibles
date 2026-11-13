import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { SqlClient } from "../../../src/shared/db/sql-client.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

const LOCK = join(tmpdir(), "imperdibles-astro-build.lock");

/** `astro build` writes to a shared `.astro/` directory, so concurrent builds from parallel test files must take turns. */
function withBuildLock<T>(fn: () => T): T {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 300_000) rmSync(LOCK, { recursive: true, force: true });
      } catch {}
      Atomics.wait(pause, 0, 0, 100);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

export type BuiltSite = { dir: string; read(rel: string): string; bytes(rel: string): Buffer; exists(rel: string): boolean };

/** Seeds a SQLite fixture and runs a real `astro build` against it, into a temp directory. */
export async function buildSite(opts: {
  seed: (db: SqlClient & { raw: Database.Database }) => Promise<void>;
}): Promise<BuiltSite> {
  const root = mkdtempSync(join(tmpdir(), "site-build-"));
  const db = createSqliteClient();
  await opts.seed(db);
  const fixture = join(root, "fixture.db");
  writeFileSync(fixture, db.raw.serialize());
  const dir = join(root, "out");
  withBuildLock(() =>
    execFileSync("pnpm", ["exec", "astro", "build"], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: {
        ...process.env,
        SITE_FIXTURE_DB: fixture,
        SITE_URL: "https://imperdibles.com.ar",
        TELEGRAM_CHANNEL_URL: "https://t.me/x",
        SITE_OUT_DIR: dir,
        SITE_OG_CACHE: join(root, "og-cache"),
      },
    }),
  );
  return {
    dir,
    read: (rel) => readFileSync(join(dir, rel), "utf8"),
    bytes: (rel) => readFileSync(join(dir, rel)),
    exists: (rel) => existsSync(join(dir, rel)),
  };
}
