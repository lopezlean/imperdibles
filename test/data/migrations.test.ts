import { describe, expect, it } from "vitest";
import { createSqliteClient } from "../support/sqlite-client.js";

describe("0003_seed_vtex_stores", () => {
  it("adds jumbo, easy and coppel next to ml and fravega, all enabled", async () => {
    const rows = await createSqliteClient().all<{ id: string; name: string; enabled: number }>("SELECT id, name, enabled FROM stores ORDER BY id");
    expect(rows).toEqual([
      { id: "coppel", name: "Coppel", enabled: 1 },
      { id: "easy", name: "Easy", enabled: 1 },
      { id: "fravega", name: "Frávega", enabled: 1 },
      { id: "jumbo", name: "Jumbo", enabled: 1 },
      { id: "ml", name: "Mercado Libre", enabled: 1 },
    ]);
  });
});
