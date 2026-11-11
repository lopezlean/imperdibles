import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContractError, parseCandidateList } from "../../src/contract/candidate-list.js";

const DIR = join(import.meta.dirname, "../../fixtures/lista-candidatos");
const fd = (pattern: string): string[] => {
  const re = new RegExp(`^${pattern.replace(/\./g, "\\.").replace("*", ".*")}$`);
  return readdirSync(DIR).filter((f) => re.test(f)).sort();
};
const load = (file: string): unknown => JSON.parse(readFileSync(join(DIR, file), "utf8"));
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("parseCandidateList", () => {
  it("has the expected valid fixtures", () => {
    expect(fd("valid-*.json")).toEqual([
      "valid-2026-11-10.json",
      "valid-empty.json",
      "valid-three-rivals.json",
    ]);
  });

  for (const f of fd("valid-*.json")) {
    it(`accepts ${f}`, () => {
      expect(() => parseCandidateList(load(f))).not.toThrow();
    });
  }

  it("keeps the 10/11 run ids and order", () => {
    const list = parseCandidateList(load("valid-2026-11-10.json"));
    expect(list.candidates.map((c) => c.candidate_id)).toEqual([
      "2026-11-10-aspiradoras-robot-060000:SMARTLIFE:RVCL050",
      "2026-11-10-aspiradoras-robot-060000:XIAOMI:S40C",
      "2026-11-10-aspiradoras-robot-060000:XIAOMI:H50PRO",
      "2026-11-10-aspiradoras-robot-060000:ELECTROLUX:ERB80",
    ]);
  });

  it.each([
    ["invalid-missing-titulo.json", "candidates.0.title"],
    ["invalid-float-price.json", "candidates.0.ml.price_ars"],
    ["invalid-dudosa.json", "candidates.0.confidence"],
    ["invalid-version-2.json", "version"],
    ["invalid-no-rivals.json", "candidates.0.others"],
    ["invalid-unsorted-rivals.json", "candidates.0.others"],
    ["invalid-unsorted-candidates.json", "candidates"],
    ["invalid-diferencia-ars.json", "candidates.0.difference_ars"],
    ["invalid-ml-store.json", "candidates.0.ml.store"],
    ["invalid-ml-in-otras.json", "candidates.0.others.0.store"],
    ["invalid-observado-no-zone.json", "candidates.0.ml.observed_at"],
    ["invalid-fecha.json", "run_date"],
  ])("rejects %s at %s", (file, path) => {
    expect(() => parseCandidateList(load(file))).toThrow(new RegExp(escape(path)));
    expect(() => parseCandidateList(load(file))).toThrow(ContractError);
  });

  it("has one invalid fixture per rule", () => {
    expect(fd("invalid-*.json")).toHaveLength(12);
  });
});
