import type { SqlClient } from "../../../src/shared/db/sql-client.js";

/** Inserts the runs row and the models rows that candidates foreign keys need. */
export async function seedRun(
  db: SqlClient,
  o: { run_date: string; modelIds?: string[]; runId?: string },
): Promise<{ runId: string }> {
  const runId = o.runId ?? `run-${o.run_date}`;
  await db.run(
    "INSERT INTO runs (id, run_date, category, status, started_at) VALUES (?, ?, 'aspiradoras-robot', 'ok', ?)",
    [runId, o.run_date, `${o.run_date}T06:00:00-03:00`],
  );
  for (const id of o.modelIds ?? []) {
    await db.run(
      "INSERT OR IGNORE INTO models (id, category, brand, model_code, model_key, title, created_at) VALUES (?, 'aspiradoras-robot', 'Fake', ?, ?, 'Fake', ?)",
      [id, id, id, `${o.run_date}T06:00:00-03:00`],
    );
  }
  return { runId };
}
