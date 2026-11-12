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

describe("0004_more_categories", () => {
  it("keeps aspiradoras-robot first and adds the six new categories", async () => {
    const rows = await createSqliteClient().all<{ value: string }>("SELECT value FROM config WHERE name = 'categories'");
    const categories = JSON.parse(rows[0]!.value) as { id: string; name: string; terms: string[] }[];
    expect(categories.map((c) => c.id)).toEqual([
      "aspiradoras-robot",
      "smart-tv",
      "celulares",
      "freidoras-de-aire",
      "aires-acondicionados",
      "lavarropas",
      "heladeras",
    ]);
    expect(categories[0]).toEqual({ id: "aspiradoras-robot", name: "Aspiradoras robot", terms: ["aspiradora robot"] });
    expect(categories.find((c) => c.id === "smart-tv")).toEqual({ id: "smart-tv", name: "Smart TV", terms: ["smart tv"] });
  });
});
