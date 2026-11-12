import type { SqlClient } from "../../shared/db/sql-client.js";
import { CONFIG_FINGERPRINT, CONFIG_LINK, getConfig, setConfig } from "./repo.js";

/** `ship` exit codes after which the site is deployed: 0 all good, 2 a publish call failed. */
const SITE_DEPLOYED_EXITS = [0, 2];

const SITE_UPDATE_FAILED = "No se pudo actualizar la web con los cupones. Se reintenta en la próxima revalidación.";

/**
 * What the built site shows about coupons. "" when the link is unset or nothing is valid; otherwise the link
 * followed by the sorted `${id}@${valid_until}` of every published coupon still valid at `now`.
 */
export async function couponFingerprint(db: SqlClient, now: Date): Promise<string> {
  const link = (await getConfig(db, CONFIG_LINK))?.trim() ?? "";
  if (link === "") return "";
  const rows = await db.all<{ id: number; valid_until: string }>(
    "SELECT id, valid_until FROM coupons WHERE status = 'published' AND valid_until > ?",
    [now.toISOString()],
  );
  if (rows.length === 0) return "";
  const entries = rows.map((r) => `${r.id}@${r.valid_until}`).sort();
  return `${link}\n${entries.join("\n")}`;
}

/**
 * Wraps the full ship: the fingerprint is computed BEFORE it runs, so a coupon that appears meanwhile is not
 * recorded as shipped. Stored only when the site was deployed; a D1 failure never blocks or changes the ship.
 */
export function shipWithFingerprint(deps: { db: SqlClient; now: () => Date }, runShip: () => Promise<number>): () => Promise<number> {
  return async () => {
    let fingerprint: string | null = null;
    try {
      fingerprint = await couponFingerprint(deps.db, deps.now());
    } catch {
      // Not recording is safe: the next coupon round just ships site-only once more.
    }
    const code = await runShip();
    if (fingerprint !== null && SITE_DEPLOYED_EXITS.includes(code)) {
      try {
        await setConfig(deps.db, CONFIG_FINGERPRINT, fingerprint);
      } catch {
        // Same: worst case is one redundant site-only ship.
      }
    }
    return code;
  };
}

/** Ships `--site-only` when the coupon fingerprint differs from the one stored by the last ship. */
export async function syncSiteIfChanged(deps: {
  db: SqlClient;
  now: () => Date;
  runShipSiteOnly: () => Promise<number>;
  notifyOwner: (text: string) => Promise<void>;
}): Promise<"unchanged" | "shipped" | "failed"> {
  const current = await couponFingerprint(deps.db, deps.now());
  const stored = (await getConfig(deps.db, CONFIG_FINGERPRINT)) ?? "";
  if (current === stored) return "unchanged";

  let code: number;
  try {
    code = await deps.runShipSiteOnly();
  } catch {
    code = 1;
  }
  if (code !== 0) {
    await deps.notifyOwner(SITE_UPDATE_FAILED);
    return "failed";
  }
  await setConfig(deps.db, CONFIG_FINGERPRINT, current);
  return "shipped";
}
