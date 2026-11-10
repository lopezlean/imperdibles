import { describe, expect, it } from "vitest";
import { artDate, artIso, artTime, daysBetween } from "../../src/shared/time.js";

describe("ART time helpers", () => {
  it("artDate returns the Argentina calendar date", () => {
    expect(artDate(new Date("2026-11-11T01:30:00Z"))).toBe("2026-11-10"); // 22:30 ART
    expect(artDate(new Date("2026-11-10T03:00:00Z"))).toBe("2026-11-10"); // 00:00 ART
  });

  it("artTime returns HH:MM in ART", () => {
    expect(artTime(new Date("2026-11-10T13:45:00Z"))).toBe("10:45");
  });

  it("artIso returns ISO 8601 with -03:00", () => {
    expect(artIso(new Date("2026-11-10T09:00:00Z"))).toBe("2026-11-10T06:00:00-03:00");
  });

  it("daysBetween counts whole days, negative when going back", () => {
    expect(daysBetween("2026-11-10", "2026-11-13")).toBe(3);
    expect(daysBetween("2026-11-10", "2026-11-10")).toBe(0);
    expect(daysBetween("2026-11-13", "2026-11-10")).toBe(-3);
  });
});
