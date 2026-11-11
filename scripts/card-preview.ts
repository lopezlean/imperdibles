import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCandidateList } from "../src/contract/candidate-list.js";
import { renderCardPng } from "../src/output/card/render.js";

const FIXTURES = ["valid-2026-11-10.json", "valid-three-rivals.json"];
const OUT_DIR = path.join(process.cwd(), "var");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (const name of FIXTURES) {
    const list = parseCandidateList(
      JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", name), "utf8")),
    );
    for (const c of list.candidatos) {
      n++;
      const file = path.join(OUT_DIR, `card-preview-${n}.png`);
      writeFileSync(file, await renderCardPng(c, { fecha: list.fecha }));
      console.log(`${file}  (${name}: ${c.titulo})`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
