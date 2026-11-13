import type { SqlClient } from "../shared/db/sql-client.js";
import { categoryChannelKey } from "../worker/category-channels.js";
import { getConfig, setConfig } from "./coupons/repo.js";

const HANDLE = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** Stores the public Telegram handle that receives a category's posts; only configured categories are accepted. */
export async function runCategoryChannelCommand(
  deps: { db: SqlClient; stdout: (s: string) => void; stderr: (s: string) => void },
  category: string,
  handle: string,
): Promise<number> {
  const raw = await getConfig(deps.db, "categories");
  const ids = (JSON.parse(raw ?? "[]") as { id: string }[]).map((c) => c.id);
  if (!ids.includes(category)) {
    deps.stderr(`Categoría desconocida: ${category}. Disponibles: ${ids.join(", ")}.\n`);
    return 2;
  }
  if (!HANDLE.test(handle)) {
    deps.stderr("Canal no válido: debe ser el usuario público del canal, por ejemplo @imperdibles_notebooks.\n");
    return 2;
  }
  await setConfig(deps.db, categoryChannelKey(category), handle);
  deps.stdout(`Canal de ${category} guardado: ${handle}.\n`);
  return 0;
}
