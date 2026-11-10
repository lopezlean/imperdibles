import type { SqlClient } from "./db/sql-client.js";

export type Category = { id: string; nombre: string; terminos: string[] };
export type AppConfig = {
  umbral_pct: number;
  presupuesto_consultas: number;
  hora_recoleccion: string;
  hora_aviso: string;
  hora_revalidacion: string;
  hora_publicacion: string;
  categorias: Category[];
};

export async function loadConfig(db: SqlClient): Promise<AppConfig> {
  const rows = await db.all<{ clave: string; valor: string }>("SELECT clave, valor FROM config");
  const m = new Map(rows.map((r) => [r.clave, r.valor]));
  const text = (k: string): string => {
    const v = m.get(k);
    if (v === undefined) throw new Error(`config key missing: ${k}`);
    return v;
  };
  const num = (k: string): number => {
    const n = Number(text(k));
    if (!Number.isFinite(n)) throw new Error(`config key not numeric: ${k}`);
    return n;
  };
  return {
    umbral_pct: num("umbral_pct"),
    presupuesto_consultas: num("presupuesto_consultas"),
    hora_recoleccion: text("hora_recoleccion"),
    hora_aviso: text("hora_aviso"),
    hora_revalidacion: text("hora_revalidacion"),
    hora_publicacion: text("hora_publicacion"),
    categorias: JSON.parse(text("categorias")) as Category[],
  };
}
