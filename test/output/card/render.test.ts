import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCandidateList } from "../../../src/contract/candidate-list.js";
import { Resvg } from "@resvg/resvg-js";
import { renderCardPng, renderCardSvg } from "../../../src/output/card/render.js";
import { buildCardTree } from "../../../src/output/card/tree.js";

const load = (n: string) =>
  parseCandidateList(JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", n), "utf8")));

function expectPng(png: Uint8Array) {
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  expect(view.getUint32(16)).toBe(1200);
  expect(view.getUint32(20)).toBe(675);
}

describe("renderCardPng", () => {
  it("renders a 1200x675 PNG for the default fixture", async () => {
    const list = load("valid-2026-11-10.json");
    expectPng(await renderCardPng(list.candidates[0]!, { run_date: list.run_date }));
  });

  it("renders every candidate of the three-rival fixture as 1200x675 PNGs", async () => {
    const list = load("valid-three-rivals.json");
    expect(Math.max(...list.candidates.map((c) => c.others.length))).toBe(3);
    for (const c of list.candidates) expectPng(await renderCardPng(c, { run_date: list.run_date }));
  });

  it("renders a three-rival candidate with a 60-character title", async () => {
    const list = load("valid-three-rivals.json");
    const c = list.candidates.find((x) => x.others.length === 3)!;
    expectPng(await renderCardPng({ ...c, title: "W".repeat(60) }, { run_date: list.run_date }));
  });

  it("natural content height fits in 675px for the worst cases", async () => {
    const list = load("valid-three-rivals.json");
    const base = list.candidates.find((x) => x.others.length === 3)!;
    const cases = [
      { ...base, title: "W".repeat(60) },
      { ...base, title: "Aspiradora robot con estación de vaciado automático y mapeo láser LDS" },
    ];
    for (const c of cases) {
      const tree = buildCardTree(c, { run_date: list.run_date });
      const { height: _h, ...style } = tree.props.style as Record<string, string | number>;
      // Root without a fixed height on a tall canvas: the opaque area is the natural content height.
      const free = { ...tree, props: { ...tree.props, style } };
      const svg = await renderCardSvg(free, { width: 1200, height: 1600 });
      const img = new Resvg(svg).render();
      const rows = img.height;
      const px = img.pixels;
      let last = 0;
      for (let y = rows - 1; y >= 0 && last === 0; y--) if (px[(y * img.width + 600) * 4 + 3]! > 0) last = y + 1;
      expect(last).toBeGreaterThan(300);
      expect(last).toBeLessThanOrEqual(675);
    }
  });

  it("lays out inside the 1200x675 canvas: badge ends at the right padding and the footer is visible", async () => {
    const list = load("valid-three-rivals.json");
    const c = list.candidates.find((x) => x.others.length === 3)!;
    const img = new Resvg(await renderCardSvg(buildCardTree(c, { run_date: list.run_date }), { width: 1200, height: 675 })).render();
    const px = img.pixels; // the getter copies the buffer on every access
    const at = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return [px[i]!, px[i + 1]!, px[i + 2]!];
    };
    const bg = at(5, 5);
    // Badge row (y~85): just inside the right padding is badge colour, just outside is the background.
    expect(at(1130, 70)).not.toEqual(bg);
    expect(at(1150, 70)).toEqual(bg);
    // Footer text sits in the last 56px padded band: some non-background pixel between y=585 and y=619.
    let ink = false;
    for (let y = 585; y < 619 && !ink; y++) for (let x = 64; x < 1136 && !ink; x += 2) if (at(x, y).join() !== bg.join()) ink = true;
    expect(ink).toBe(true);
  });
});
