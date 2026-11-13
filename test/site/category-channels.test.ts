import { beforeAll, describe, expect, it } from "vitest";
import { loadCategoryChannels } from "../../site/lib/category-channels.js";
import { categoryChannelKey } from "../../src/worker/category-channels.js";
import { createSqliteClient } from "../support/sqlite-client.js";
import { buildSite, type BuiltSite } from "./support/build-site.js";
import { seedDeal } from "./support/seed-deals.js";

describe("loadCategoryChannels", () => {
  it("maps category ids to channel handles", async () => {
    const db = createSqliteClient();
    await db.run("INSERT INTO config (name, value) VALUES (?, ?)", [categoryChannelKey("notebooks"), "@imperdibles_notebooks"]);
    expect(await loadCategoryChannels(db)).toEqual({ notebooks: "@imperdibles_notebooks" });
  });
});

describe("category page follow button", () => {
  let site: BuiltSite;
  beforeAll(async () => {
    site = await buildSite({
      seed: async (db) => {
        await seedDeal(db, { id: "a", run_date: "2026-11-12", model_id: "m1", category: "notebooks" });
        await seedDeal(db, { id: "b", run_date: "2026-11-12", model_id: "m2", category: "monitores" });
        await db.run("INSERT INTO config (name, value) VALUES (?, ?)", [categoryChannelKey("notebooks"), "@imperdibles_notebooks"]);
      },
    });
  }, 240_000);

  it("links the category channel only on the category that has one", () => {
    expect(site.read("categoria/notebooks/index.html")).toContain('href="https://t.me/imperdibles_notebooks"');
    expect(site.read("categoria/monitores/index.html")).not.toContain("t.me/imperdibles_");
  });
});
