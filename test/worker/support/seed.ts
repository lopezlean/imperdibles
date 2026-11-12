import type { SqlClient } from "../../../src/shared/db/sql-client.js";

/** Inserts the runs row and the models rows that candidates foreign keys need. */
export async function seedRun(
  db: SqlClient,
  o: { run_date: string; modelIds?: string[]; runId?: string; category?: string; models_compared?: number },
): Promise<{ runId: string }> {
  const runId = o.runId ?? `run-${o.run_date}`;
  const category = o.category ?? "aspiradoras-robot";
  await db.run(
    "INSERT INTO runs (id, run_date, category, status, started_at, models_compared) VALUES (?, ?, ?, 'ok', ?, ?)",
    [runId, o.run_date, category, `${o.run_date}T06:00:00-03:00`, o.models_compared ?? 0],
  );
  for (const id of o.modelIds ?? []) {
    await db.run(
      "INSERT OR IGNORE INTO models (id, category, brand, model_code, model_key, title, created_at) VALUES (?, ?, 'Fake', ?, ?, 'Fake', ?)",
      [id, category, id, id, `${o.run_date}T06:00:00-03:00`],
    );
  }
  return { runId };
}
