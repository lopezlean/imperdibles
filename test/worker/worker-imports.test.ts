import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importClosure, importsOf } from "./support/import-closure.js";

const split = (c: string[]) => ({ files: c.filter((x) => x.startsWith("/")), bare: c.filter((x) => !x.startsWith("/")) });
// Type-only imports are erased, so reachability uses the full closure and the shipped-code checks use the runtime one.
const { files, bare } = split(importClosure("src/worker/index.ts"));
const runtime = split(importClosure("src/worker/index.ts", { runtimeOnly: true }));
const rel = (p: string) => files.some((f) => f.includes(`/${p}`));

describe("Worker import closure", () => {
  it.each([
    "src/output/format.ts",
    "src/output/copy.ts",
    "src/output/affiliate-link.ts",
    "src/output/telegram/client.ts",
    "src/output/publish/messages.ts",
    "src/shared/",
    "src/contract/",
  ])("reaches %s", (p) => {
    expect(rel(p)).toBe(true);
  });

  it("reachability check fails for a module that is not reached", () => {
    expect(rel("src/output/card/render.ts")).toBe(false);
  });

  it("reaches no forbidden package, node: module or card renderer", () => {
    const forbidden = ["cheerio", "satori", "@resvg/resvg-js", "better-sqlite3", "dotenv"];
    for (const b of [...bare, ...runtime.bare]) {
      expect(forbidden).not.toContain(b);
      expect(b.startsWith("node:")).toBe(false);
    }
    expect(files.some((f) => f.endsWith("src/output/card/render.ts"))).toBe(false);
  });

  it("has no runtime import of zod or candidate-list", () => {
    for (const f of runtime.files) {
      for (const { specifier, typeOnly } of importsOf(f)) {
        if (typeOnly) continue;
        expect(specifier, f).not.toBe("zod");
        expect(resolve(f, "..", specifier).endsWith("src/contract/candidate-list"), f).toBe(false);
        expect(specifier.endsWith("candidate-list.js"), f).toBe(false);
      }
    }
  });
});
