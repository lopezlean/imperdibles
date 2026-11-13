import { describe, expect, it } from "vitest";
import { USAGE, parseCommand } from "../../src/data/run-daily.js";
import { runCategoryChannelCommand } from "../../src/local/category-channel.js";
import { categoryChannelKey } from "../../src/worker/category-channels.js";
import { getConfig } from "../../src/local/coupons/repo.js";
import { createSqliteClient } from "../support/sqlite-client.js";

function setup() {
  const db = createSqliteClient();
  const out: string[] = [];
  const err: string[] = [];
  return { db, deps: { db, stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s) }, out, err };
}

describe("canal-categoria command", () => {
  it("parses two arguments only", () => {
    expect(parseCommand(["canal-categoria", "notebooks", "@imperdibles_notebooks"])).toEqual({
      name: "canal-categoria",
      category: "notebooks",
      handle: "@imperdibles_notebooks",
    });
    expect(parseCommand(["canal-categoria", "notebooks"])).toBeNull();
    expect(USAGE).toContain("imperdibles canal-categoria <categoria> <@canal>");
  });

  it("stores the handle for a known category", async () => {
    const { db, deps, out } = setup();
    expect(await runCategoryChannelCommand(deps, "notebooks", "@imperdibles_notebooks")).toBe(0);
    expect(await getConfig(db, categoryChannelKey("notebooks"))).toBe("@imperdibles_notebooks");
    expect(out.join("")).toContain("notebooks");
  });

  it("rejects an unknown category and a bad handle without writing", async () => {
    const { db, deps, err } = setup();
    expect(await runCategoryChannelCommand(deps, "nope", "@imperdibles_x")).toBe(2);
    expect(await runCategoryChannelCommand(deps, "notebooks", "imperdibles")).toBe(2);
    expect(await runCategoryChannelCommand(deps, "notebooks", "@a")).toBe(2);
    expect(err).toHaveLength(3);
    expect(await getConfig(db, categoryChannelKey("notebooks"))).toBeNull();
  });
});
