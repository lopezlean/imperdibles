import type { OwnerAlert } from "../contract/local-hooks.js";
import { storeName } from "./copy.js";
import { truncate } from "./format.js";

/** One short Spanish sentence per alert kind; always under Telegram's 4096-character limit. */
export function renderOwnerAlert(a: OwnerAlert): string {
  switch (a.kind) {
    case "run_failed":
      return `La corrida de hoy falló: ${truncate(a.reason, 500)}. No se publicó nada.`;
    case "run_partial":
      return `La corrida de hoy quedó incompleta: ${a.skipped_models} modelos sin leer.`;
    case "store_format_error":
      return `Cambió el formato de ${storeName(a.store)}; no se usaron sus datos hoy.`;
    case "ml_auth_required":
      return "Hay que volver a autorizar Mercado Libre: pnpm ml:authorize url.";
    case "ml_permission_denied":
      return `Mercado Libre respondió 403 en ${a.path}. La corrida se detuvo.`;
  }
}
