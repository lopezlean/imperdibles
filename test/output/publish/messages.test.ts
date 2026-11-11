import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCandidateList, type Candidate } from "../../../src/contract/candidate-list.js";
import { AFFILIATE_LEGEND } from "../../../src/output/copy.js";
import { buildChannelCaption, buildXPost } from "../../../src/output/publish/messages.js";

const load = (n: string) =>
  parseCandidateList(JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", n), "utf8")));

const LINK = "https://meli.la/2AbC_xY?r=1/";
// X counts every URL as 23 characters; everything else as one (Latin text).
const weighted = (post: string, link: string) => post.replace(link, "x".repeat(23)).length;

describe("buildChannelCaption", () => {
  it("renders the spec caption with the link verbatim and the legend", () => {
    const c = load("valid-2026-11-10.json").candidatos[1]!;
    const cap = buildChannelCaption(c, LINK);
    const lines = cap.split("\n");
    expect(lines[0]).toBe(c.titulo);
    expect(lines[1]).toBe("17,5% menos en Mercado Libre: $329.999");
    expect(lines).toContain("Frávega: $399.999");
    expect(lines).toContain("Diferencia: $70.000");
    expect(lines).toContain(LINK);
    expect(cap.endsWith(`\n\n${AFFILIATE_LEGEND}`)).toBe(true);
    expect(cap.length).toBeLessThanOrEqual(1024);
  });

  it("lists every rival when there are three", () => {
    const c = load("valid-three-rivals.json").candidatos[0]!;
    const cap = buildChannelCaption(c, LINK);
    expect(cap).toContain("Cetrogar: $409.999");
    expect(cap).toContain("Musimundo: $419.999");
    expect(cap).toContain(LINK);
  });

  it("stays within 1024 characters with a very long title, link intact", () => {
    const c: Candidate = { ...load("valid-three-rivals.json").candidatos[0]!, titulo: "y".repeat(2000) };
    const cap = buildChannelCaption(c, LINK);
    expect(cap.length).toBeLessThanOrEqual(1024);
    expect(cap).toContain(LINK);
    expect(cap.endsWith(AFFILIATE_LEGEND)).toBe(true);
  });
});

describe("buildXPost", () => {
  it("renders the spec post for one rival", () => {
    const c = load("valid-2026-11-10.json").candidatos[1]!;
    expect(buildXPost(c, LINK)).toBe(
      `${c.titulo}: 17,5% menos en Mercado Libre que en Frávega ($329.999). ${LINK} Enlace de afiliado.`,
    );
  });

  it("fits 280 weighted characters with a 120-char title and three rivals, link intact", () => {
    const c: Candidate = { ...load("valid-three-rivals.json").candidatos[0]!, titulo: "z".repeat(120) };
    const post = buildXPost(c, LINK);
    expect(weighted(post, LINK)).toBeLessThanOrEqual(280);
    expect(post).toContain(` ${LINK} Enlace de afiliado.`);
  });

  it("shortens only the title when over budget, even with a long link", () => {
    const longLink = `https://meli.la/${"a".repeat(60)}`;
    const c: Candidate = { ...load("valid-three-rivals.json").candidatos[0]!, titulo: "w".repeat(400) };
    const post = buildXPost(c, longLink);
    expect(weighted(post, longLink)).toBeLessThanOrEqual(280);
    expect(post).toContain(longLink);
    expect(post).toContain("…: ");
  });
});
