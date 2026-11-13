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

describe("0004_more_categories and 0007_even_more_categories", () => {
  it("keeps aspiradoras-robot first, the 0004 categories in order, then the 0007 ones", async () => {
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
      "notebooks",
      "auriculares",
      "microondas",
      "cafeteras",
      "monitores",
      "tablets",
      "parlantes",
      "smartwatches",
    ]);
    expect(categories[0]).toEqual({ id: "aspiradoras-robot", name: "Aspiradoras robot", terms: ["aspiradora robot"] });
    expect(categories.find((c) => c.id === "smart-tv")).toEqual({ id: "smart-tv", name: "Smart TV", terms: ["smart tv"] });
  });
});

describe("0006_coupons", () => {
  const insert = (db: ReturnType<typeof createSqliteClient>, over: { status?: string; value?: number } = {}) =>
    db.raw
      .prepare(
        `INSERT INTO coupons (code, discount_type, discount_value, valid_from, valid_until, status, source_message_id, source_text, created_at, updated_at)
         VALUES ('ABC', 'amount', ?, '2026-11-12T00:00:00.000Z', '2026-11-13T00:00:00.000Z', ?, 1, 'texto', 'x', 'x')`,
      )
      .run(over.value ?? 1000, over.status ?? "pending");

  it("creates coupons and coupon_posts", async () => {
    const rows = await createSqliteClient().all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('coupons', 'coupon_posts') ORDER BY name",
    );
    expect(rows.map((r) => r.name)).toEqual(["coupon_posts", "coupons"]);
  });

  it("rejects an unknown status and a non-positive discount", () => {
    const db = createSqliteClient();
    expect(() => insert(db, { status: "x" })).toThrow(/CHECK constraint/);
    expect(() => insert(db, { value: 0 })).toThrow(/CHECK constraint/);
  });

  it("unique on (source_message_id, code)", () => {
    const db = createSqliteClient();
    insert(db);
    expect(() => insert(db)).toThrow(/UNIQUE constraint/);
  });
});
