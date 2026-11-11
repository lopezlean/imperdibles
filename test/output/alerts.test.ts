import { describe, expect, it } from "vitest";
import { renderOwnerAlert } from "../../src/output/alerts.js";

describe("renderOwnerAlert", () => {
  it("run_failed", () => {
    expect(renderOwnerAlert({ kind: "run_failed", corrida_id: null, reason: "boom" })).toBe(
      "La corrida de hoy falló: boom. No se publicó nada.",
    );
  });
  it("run_failed truncates a huge reason under the Telegram limit", () => {
    const t = renderOwnerAlert({ kind: "run_failed", corrida_id: "c", reason: "y".repeat(5000) });
    expect(t.length).toBeLessThanOrEqual(4096);
    expect(t).toContain("…");
  });
  it("run_partial", () => {
    expect(renderOwnerAlert({ kind: "run_partial", corrida_id: "c", skipped_models: 3, reason: "r" })).toBe(
      "La corrida de hoy quedó incompleta: 3 modelos sin leer.",
    );
  });
  it("store_format_error uses the store name", () => {
    expect(renderOwnerAlert({ kind: "store_format_error", tienda: "fravega" })).toBe(
      "Cambió el formato de Frávega; no se usaron sus datos hoy.",
    );
  });
  it("ml_auth_required", () => {
    expect(renderOwnerAlert({ kind: "ml_auth_required" })).toBe(
      "Hay que volver a autorizar Mercado Libre: pnpm ml:authorize url.",
    );
  });
  it("ml_permission_denied", () => {
    expect(renderOwnerAlert({ kind: "ml_permission_denied", path: "/items/MLA1" })).toBe(
      "Mercado Libre respondió 403 en /items/MLA1. La corrida se detuvo.",
    );
  });
});
