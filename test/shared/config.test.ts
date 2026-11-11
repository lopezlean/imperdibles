import { expect, it } from "vitest";
import { loadConfig } from "../../src/shared/config.js";
import { createSqliteClient } from "../support/sqlite-client.js";

it("loads the seeded configuration", async () => {
  expect(await loadConfig(createSqliteClient())).toEqual({
    threshold_pct: 15,
    query_budget: 150,
    collect_time: "06:00",
    notify_time: "07:30",
    revalidate_time: "10:45",
    publish_time: "11:00",
    categories: [{ id: "aspiradoras-robot", name: "Aspiradoras robot", terms: ["aspiradora robot"] }],
  });
});
