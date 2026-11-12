import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("declares exactly the one Cron Trigger", () => {
  const toml = readFileSync("wrangler.toml", "utf8");
  const m = /^\s*crons\s*=\s*\[([^\]]*)\]/m.exec(toml);
  expect(m).not.toBeNull();
  const crons = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  expect(crons).toEqual(["30 10 * * *"]);
});
