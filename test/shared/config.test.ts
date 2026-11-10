import { expect, it } from "vitest";
import { loadConfig } from "../../src/shared/config.js";
import { createSqliteClient } from "../support/sqlite-client.js";

it("loads the seeded configuration", async () => {
  expect(await loadConfig(createSqliteClient())).toEqual({
    umbral_pct: 15,
    presupuesto_consultas: 150,
    hora_recoleccion: "06:00",
    hora_aviso: "07:30",
    hora_revalidacion: "10:45",
    hora_publicacion: "11:00",
    categorias: [{ id: "aspiradoras-robot", nombre: "Aspiradoras robot", terminos: ["aspiradora robot"] }],
  });
});
