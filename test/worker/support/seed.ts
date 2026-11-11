import type { SqlClient } from "../../../src/shared/db/sql-client.js";

/** Inserts the corridas row and the modelos rows that candidatos foreign keys need. */
export async function seedRun(
  db: SqlClient,
  o: { fecha: string; modeloIds?: string[] },
): Promise<{ corridaId: string }> {
  const corridaId = `corrida-${o.fecha}`;
  await db.run(
    "INSERT INTO corridas (id, fecha, categoria, estado, iniciada_en) VALUES (?, ?, 'aspiradoras-robot', 'ok', ?)",
    [corridaId, o.fecha, `${o.fecha}T06:00:00-03:00`],
  );
  for (const id of o.modeloIds ?? []) {
    await db.run(
      "INSERT INTO modelos (id, categoria, marca, codigo_modelo, clave, titulo, creado_en) VALUES (?, 'aspiradoras-robot', 'Fake', ?, ?, 'Fake', ?)",
      [id, id, id, `${o.fecha}T06:00:00-03:00`],
    );
  }
  return { corridaId };
}
