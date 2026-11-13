import type { SqlClient } from "../../shared/db/sql-client.js";
import type { StoreAdapter } from "../types.js";
import { createCarrefourAdapter } from "./carrefour.js";
import { createCetrogarAdapter } from "./cetrogar.js";
import { createCoppelAdapter } from "./coppel.js";
import { createEasyAdapter } from "./easy.js";
import { createJumboAdapter } from "./jumbo.js";
import { createNaldoAdapter } from "./naldo.js";
import { createOncityAdapter } from "./oncity.js";
import type { VtexDeps } from "./vtex.js";

/** Adapters for the rival stores compared against ML besides Frávega (the primary store), by `stores.id`. */
const SECONDARY: Record<string, (deps: VtexDeps) => StoreAdapter> = {
  carrefour: createCarrefourAdapter,
  cetrogar: createCetrogarAdapter,
  coppel: createCoppelAdapter,
  easy: createEasyAdapter,
  jumbo: createJumboAdapter,
  naldo: createNaldoAdapter,
  oncity: createOncityAdapter,
};

/** Rows of `stores` with `enabled = 1` that have an adapter here, in id order; `ml` and `fravega` are wired separately. */
export async function enabledSecondaryStores(db: SqlClient, deps: VtexDeps): Promise<StoreAdapter[]> {
  const rows = await db.all<{ id: string }>("SELECT id FROM stores WHERE enabled = 1 ORDER BY id");
  return rows.flatMap((r) => (Object.hasOwn(SECONDARY, r.id) ? [SECONDARY[r.id]!(deps)] : []));
}
