import { describe, expect, it } from "vitest";
import { runCouponsLinkCommand } from "../../../src/local/coupons/link.js";
import { CONFIG_LINK, getConfig } from "../../../src/local/coupons/repo.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

function setup() {
  const db = createSqliteClient();
  const out: string[] = [];
  const err: string[] = [];
  const deps = { db, stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s) };
  return { db, deps, out, err };
}

describe("runCouponsLinkCommand", () => {
  it("stores a valid link byte for byte and exits 0", async () => {
    const { db, deps, out, err } = setup();
    const url = "https://meli.la/2AbC_xY?r=1/";
    expect(await runCouponsLinkCommand(deps, url)).toBe(0);
    expect(await getConfig(db, CONFIG_LINK)).toBe(url);
    expect(out.join("")).toBe("Enlace de cupones guardado.\n");
    expect(err).toEqual([]);
  });

  it("a second call replaces it", async () => {
    const { db, deps } = setup();
    await runCouponsLinkCommand(deps, "https://meli.la/first");
    await runCouponsLinkCommand(deps, "https://meli.la/second");
    expect(await getConfig(db, CONFIG_LINK)).toBe("https://meli.la/second");
  });

  it("rejects http, another host and extra text, stores nothing and exits 2", async () => {
    const cases: [string, string][] = [
      ["http://meli.la/x", "el enlace no usa https"],
      ["https://example.com/x", "el enlace no es de meli.la"],
      ["https://meli.la/x y", "tiene que ser un único enlace, sin otro texto"],
    ];
    for (const [url, reason] of cases) {
      const { db, deps, out, err } = setup();
      expect(await runCouponsLinkCommand(deps, url)).toBe(2);
      expect(await getConfig(db, CONFIG_LINK)).toBeNull();
      expect(out).toEqual([]);
      expect(err.join("")).toBe(`Enlace no válido: ${reason}. Debe ser un único enlace https://meli.la/...\n`);
    }
  });
});
