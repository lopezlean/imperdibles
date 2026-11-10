import { describe, expect, it } from "vitest";
import { createSqliteClient } from "../support/sqlite-client.js";

async function seedParents() {
  const db = createSqliteClient();
  await db.run(
    "INSERT INTO corridas (id, fecha, categoria, estado, modelos_comparados, consultas_usadas, iniciada_en) VALUES ('c1','2026-11-10','aspiradoras-robot','ok',0,0,'2026-11-10T06:00:00-03:00')",
  );
  await db.run(
    "INSERT INTO modelos (id, categoria, marca, codigo_modelo, clave, titulo, creado_en) VALUES ('XIAOMI:S40C','aspiradoras-robot','XIAOMI','S40C','XIAOMI:S40C','Robot S40C','2026-11-10T06:00:00-03:00')",
  );
  return db;
}

describe("schema", () => {
  it("creates every table", async () => {
    const db = createSqliteClient();
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map(
      (t) => t.name,
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        "tiendas",
        "modelos",
        "publicaciones_tienda",
        "observaciones_precio",
        "emparejados",
        "corridas",
        "candidatos",
        "salidas",
        "paginas",
        "config",
        "tokens_ml",
      ]),
    );
  });

  it("rejects a bad candidatos.estado with a CHECK failure", async () => {
    const db = await seedParents();
    await expect(
      db.run(
        "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado) VALUES ('x','c1','XIAOMI:S40C','{}','raro')",
      ),
    ).rejects.toThrow(/CHECK/);
    await db.run(
      "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado) VALUES ('x','c1','XIAOMI:S40C','{}','pendiente')",
    );
  });

  it("rejects duplicates on salidas(candidato_id, canal)", async () => {
    const db = await seedParents();
    await db.run(
      "INSERT INTO candidatos (id, corrida_id, modelo_id, payload, estado) VALUES ('x','c1','XIAOMI:S40C','{}','publicado')",
    );
    const ins = "INSERT INTO salidas (candidato_id, canal, publicado_en) VALUES ('x','telegram_canal','2026-11-10T11:00:00-03:00')";
    await db.run(ins);
    await expect(db.run(ins)).rejects.toThrow(/UNIQUE/);
    await expect(
      db.run("INSERT INTO salidas (candidato_id, canal, publicado_en) VALUES ('x','otro','2026-11-10')"),
    ).rejects.toThrow(/CHECK/);
  });

  it("rejects duplicates on emparejados(modelo_id, publicacion_id)", async () => {
    const db = await seedParents();
    await db.run(
      "INSERT INTO publicaciones_tienda (tienda_id, ref_externa, titulo, url, primera_vez, ultima_vez) VALUES ('ml','r1','t','https://u','2026-11-10','2026-11-10')",
    );
    const pub = (await db.all<{ id: number }>("SELECT id FROM publicaciones_tienda"))[0]!.id;
    const ins = `INSERT INTO emparejados (modelo_id, publicacion_id, confianza, regla, evidencia, estado, creado_en) VALUES ('XIAOMI:S40C',${pub},'alta','r','{}','auto','2026-11-10')`;
    await db.run(ins);
    await expect(db.run(ins)).rejects.toThrow(/UNIQUE/);
  });

  it("inserts several rows from one JSON parameter", async () => {
    const db = await seedParents();
    const rows = JSON.stringify([
      { ref: "a", t: "A" },
      { ref: "b", t: "B" },
      { ref: "c", t: "C" },
    ]);
    const res = await db.run(
      `INSERT INTO publicaciones_tienda (tienda_id, ref_externa, titulo, url, primera_vez, ultima_vez)
       SELECT 'ml', json_extract(value,'$.ref'), json_extract(value,'$.t'), 'https://u', '2026-11-10', '2026-11-10' FROM json_each(?)`,
      [rows],
    );
    expect(res.changes).toBe(3);
    expect(await db.all("SELECT id FROM publicaciones_tienda")).toHaveLength(3);
  });
});
