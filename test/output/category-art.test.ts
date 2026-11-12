import { describe, expect, it } from "vitest";
import { categoryArtLabel, categoryArtSvg } from "../../src/output/category-art.js";
import { TOKENS } from "../../src/output/design-tokens.js";

const palette = new Set<string>([TOKENS.accent, TOKENS.ink, TOKENS.ink2, TOKENS.muted].map((c) => c.toLowerCase()));

describe("categoryArtSvg", () => {
  for (const id of ["aspiradoras-robot", "otra-categoria", null]) {
    const svg = categoryArtSvg(id);
    it(`is a small self-contained square svg for ${String(id)}`, () => {
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg).toContain('viewBox="0 0 120 120"');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).not.toMatch(/<script|<text|href|<image|url\(|<style|on\w+=/i);
      expect(svg.length).toBeLessThan(2048);
    });
    it(`only uses token colours for ${String(id)}`, () => {
      const colours = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
      expect(colours.length).toBeGreaterThan(0);
      for (const c of colours) expect(palette.has(c), c).toBe(true);
      expect(svg.toLowerCase()).toContain(TOKENS.accent.toLowerCase());
    });
  }

  it("draws different art for the robot vacuum and the fallback", () => {
    expect(categoryArtSvg("aspiradoras-robot")).not.toBe(categoryArtSvg(null));
    expect(categoryArtSvg("otra")).toBe(categoryArtSvg(null));
  });

  it("labels the illustration in Spanish", () => {
    expect(categoryArtLabel("aspiradoras-robot")).toBe("Ilustración de aspiradora robot");
    expect(categoryArtLabel(null)).toBe("Ilustración del producto");
  });
});
