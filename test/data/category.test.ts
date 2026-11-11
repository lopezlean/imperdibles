import { describe, expect, it } from "vitest";
import { categoryOfDay } from "../../src/data/category.js";
import type { Category } from "../../src/shared/config.js";

const c = (id: string): Category => ({ id, name: id, terms: [id] });

describe("categoryOfDay", () => {
  const cats = [c("aspiradoras-robot"), c("freidoras-de-aire"), c("smart-tv")];

  it("starts on the base date and cycles one category per day", () => {
    expect(categoryOfDay(cats, "2026-11-10").id).toBe("aspiradoras-robot");
    expect(categoryOfDay(cats, "2026-11-11").id).toBe("freidoras-de-aire");
    expect(categoryOfDay(cats, "2026-11-12").id).toBe("smart-tv");
    expect(categoryOfDay(cats, "2026-11-13").id).toBe("aspiradoras-robot");
  });

  it("wraps dates before the base date with a non-negative modulo", () => {
    expect(categoryOfDay(cats, "2026-11-09").id).toBe("smart-tv");
    expect(categoryOfDay(cats, "2026-11-07").id).toBe("aspiradoras-robot");
  });

  it("always returns the only category of a single-category list", () => {
    expect(categoryOfDay([cats[0]!], "2026-11-25").id).toBe("aspiradoras-robot");
  });

  it("throws on an empty list", () => {
    expect(() => categoryOfDay([], "2026-11-10")).toThrow();
  });
});
