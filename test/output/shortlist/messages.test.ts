import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCandidateList, type Candidate } from "../../../src/contract/candidate-list.js";
import { buildNoCandidatesText, buildShortlistCaption } from "../../../src/output/shortlist/messages.js";

const load = (n: string) =>
  parseCandidateList(JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", n), "utf8")));

function withTitles(c: Candidate, t: string): Candidate {
  return { ...c, titulo: t, ml: { ...c.ml, titulo_listado: t }, otras: c.otras.map((o) => ({ ...o, titulo_listado: t })) };
}

describe("buildShortlistCaption", () => {
  it("renders the spec caption for a one-rival candidate", () => {
    const c = load("valid-2026-11-10.json").candidatos[1]!;
    const cap = buildShortlistCaption(c);
    expect(cap).toContain("Mercado Libre: $329.999");
    expect(cap).toContain("Frávega: $399.999");
    expect(cap).toContain("Diferencia: $70.000 (17,5% menos)");
    expect(cap).toContain(c.ml.url);
    for (const o of c.otras) expect(cap).toContain(o.url);
    expect(cap.startsWith(`${c.titulo}\n`)).toBe(true);
    expect(cap.endsWith(
      'Para elegirlo, responder a este mensaje con el enlace de afiliado. Para descartarlo, responder "rechazar".',
    )).toBe(true);
    expect(cap.length).toBeLessThanOrEqual(1024);
  });

  it("fits 1024 characters with three rivals and keeps every URL", () => {
    const c3 = load("valid-three-rivals.json").candidatos[0]!;
    const long = buildShortlistCaption(c3);
    expect(long.length).toBeLessThanOrEqual(1024);
    for (const o of [c3.ml, ...c3.otras]) expect(long).toContain(o.url);
    expect(long).toContain("Cetrogar: $409.999");
    expect(long).toContain("Musimundo: $419.999");
  });

  it("falls back through every shortening step with extreme titles", () => {
    const c3 = load("valid-three-rivals.json").candidatos[0]!;
    const extreme = buildShortlistCaption(withTitles(c3, "x".repeat(400)));
    expect(extreme.length).toBeLessThanOrEqual(1024);
    for (const o of [c3.ml, ...c3.otras]) expect(extreme).toContain(o.url);
    expect(extreme).not.toContain("x".repeat(81));
  });

  it("leaves a short caption untouched by truncation", () => {
    const c = load("valid-2026-11-10.json").candidatos[1]!;
    const short = withTitles(c, "Modelo corto");
    const cap = buildShortlistCaption(short);
    expect(cap).toContain("Mercado Libre: Modelo corto");
    expect(cap).not.toContain("…");
  });

  it("falls back to the store id for unknown stores", () => {
    const c = load("valid-2026-11-10.json").candidatos[1]!;
    const cap = buildShortlistCaption({ ...c, otras: [{ ...c.otras[0]!, tienda: "tiendaX" }] });
    expect(cap).toContain("tiendaX: $399.999");
  });
});

describe("buildNoCandidatesText", () => {
  it("states models compared and threshold", () => {
    expect(buildNoCandidatesText(load("valid-empty.json"))).toBe(
      "Hoy no hay candidatos: se compararon 9 modelos y ninguno llegó al 15%.",
    );
  });
  it("formats a fractional threshold with a comma", () => {
    const l = { ...load("valid-empty.json"), umbral_pct: 12.5 };
    expect(buildNoCandidatesText(l)).toContain("al 12,5%.");
  });
});
