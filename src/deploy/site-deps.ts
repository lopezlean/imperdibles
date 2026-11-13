import { readFile } from "node:fs/promises";
import type { ShipDeps } from "./ship.js";

/** The site-related `ShipDeps` taken from the process environment (`SITE_URL`, `SITE_OUT_DIR`). */
export function siteShipDeps(env: Record<string, string | undefined> = process.env): Pick<ShipDeps, "siteUrl" | "outDir" | "readFile"> {
  return {
    siteUrl: (env.SITE_URL ?? "").replace(/\/+$/, ""),
    outDir: env.SITE_OUT_DIR ?? "./dist/site",
    readFile: (path) => readFile(path, "utf8"),
  };
}
