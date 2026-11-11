import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { Candidate } from "../../contract/candidate-list.js";
import { buildCardTree, type CardNode } from "./tree.js";

// Node-only: satori, resvg and node:fs must never enter the Worker import closure.

const require = createRequire(import.meta.url);

type FontSpec = { name: string; weight: 400 | 500 | 600 | 700; data: Buffer; style: "normal" };
type FontFile = { name: string; pkg: string; weight: FontSpec["weight"] };

const FONT_FILES: FontFile[] = [
  { name: "Inter", pkg: "inter", weight: 400 },
  { name: "Inter", pkg: "inter", weight: 500 },
  { name: "Inter", pkg: "inter", weight: 600 },
  { name: "Space Grotesk", pkg: "space-grotesk", weight: 500 },
  { name: "Space Grotesk", pkg: "space-grotesk", weight: 700 },
];

let fonts: FontSpec[] | undefined;

/** Loads the .woff files once (Satori accepts woff, not woff2). */
export function cardFonts(): FontSpec[] {
  fonts ??= FONT_FILES.map((f) => ({
    name: f.name,
    weight: f.weight,
    style: "normal" as const,
    data: readFileSync(require.resolve(`@fontsource/${f.pkg}/files/${f.pkg}-latin-${f.weight}-normal.woff`)),
  }));
  return fonts;
}

export async function renderCardSvg(tree: CardNode, size: { width: number; height: number }): Promise<string> {
  // The satori typings expect a React element; our CardNode has the same runtime shape.
  return satori(tree as unknown as Parameters<typeof satori>[0], { ...size, fonts: cardFonts() });
}

export async function renderCardPng(c: Candidate, opts: { run_date: string }): Promise<Uint8Array> {
  const svg = await renderCardSvg(buildCardTree(c, opts), { width: 1200, height: 675 });
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng());
}
