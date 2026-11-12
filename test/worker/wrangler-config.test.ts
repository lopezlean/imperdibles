import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toml = readFileSync("wrangler.toml", "utf8");

const stringArray = (key: string): string[] => {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(toml);
  expect(m).not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
};

const stringValue = (key: string): string | undefined =>
  new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m").exec(toml)?.[1];

const normalise = (p: string): string => p.replace(/^\.\//, "").replace(/\/$/, "");

describe("wrangler.toml", () => {
  it("declares only the missing-run cron", () => {
    expect(stringArray("crons")).toEqual(["30 10 * * *"]);
  });

  it("serves the Astro output as static assets", () => {
    expect(toml).toContain('directory = "dist/site"');
    expect(toml).toContain('not_found_handling = "404-page"');
    expect(toml).toContain('html_handling = "force-trailing-slash"');
  });

  it("runs the Worker first only for its own routes", () => {
    expect(stringArray("run_worker_first")).toEqual(["/telegram/*", "/internal/*", "/healthz"]);
  });

  it("keeps the assets directory equal to the Astro outDir", () => {
    const astro = readFileSync("astro.config.ts", "utf8");
    const outDir = /outDir:[^"]*"([^"]+)"/.exec(astro)?.[1];
    expect(outDir).toBeDefined();
    expect(normalise(stringValue("directory") ?? "")).toBe(normalise(outDir ?? ""));
  });

  it("disables workers.dev", () => {
    expect(toml).toMatch(/^workers_dev = false$/m);
  });
});
