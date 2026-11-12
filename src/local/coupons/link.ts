import { AFFILIATE_REASON_ES, parseAffiliateLink } from "../../output/affiliate-link.js";
import type { SqlClient } from "../../shared/db/sql-client.js";
import { CONFIG_LINK, setConfig } from "./repo.js";

/** Stores the owner's fixed meli.la link verbatim; only what the affiliate-link parser accepts is saved. */
export async function runCouponsLinkCommand(
  deps: { db: SqlClient; stdout: (s: string) => void; stderr: (s: string) => void },
  url: string,
): Promise<number> {
  const parsed = parseAffiliateLink(url);
  if (!parsed.ok) {
    deps.stderr(`Enlace no válido: ${AFFILIATE_REASON_ES[parsed.reason]}. Debe ser un único enlace https://meli.la/...\n`);
    return 2;
  }
  await setConfig(deps.db, CONFIG_LINK, parsed.link);
  deps.stdout("Enlace de cupones guardado.\n");
  return 0;
}
