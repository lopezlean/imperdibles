import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type RunLogEntry = {
  corrida_id: string | null;
  fecha: string;
  estado: string;
  error: string | null;
  at: string;
};

/** Appends one JSON line. This is the record that survives when D1 is unreachable. */
export async function appendRunLog(logPath: string, entry: RunLogEntry): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}
