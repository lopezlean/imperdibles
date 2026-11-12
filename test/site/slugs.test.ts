import { describe, expect, it } from "vitest";
import {
  dayPath,
  daySlug,
  monthOf,
  monthPath,
  monthSlug,
  parseDaySlug,
  parseMonthSlug,
  weekdayName,
} from "../../site/lib/slugs.js";

function datesOf2026(): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const months2026 = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

describe("slugs", () => {
  it("builds day and month slugs", () => {
    expect(daySlug("2026-11-12")).toBe("12-de-noviembre-de-2026");
    expect(daySlug("2026-11-05")).toBe("5-de-noviembre-de-2026");
    expect(monthSlug("2026-11")).toBe("noviembre-de-2026");
  });

  it("builds paths", () => {
    expect(dayPath("2026-11-12")).toBe("/ofertas/12-de-noviembre-de-2026/");
    expect(monthPath("2026-11")).toBe("/ofertas/noviembre-de-2026/");
  });

  it("round-trips every day of 2026", () => {
    expect(datesOf2026()).toHaveLength(365);
    for (const d of datesOf2026()) expect(parseDaySlug(daySlug(d))).toBe(d);
  });

  it.each(months2026)("round-trips month %s", (m) => {
    expect(parseMonthSlug(monthSlug(m))).toBe(m);
  });

  it.each([
    "31-de-febrero-de-2026",
    "29-de-febrero-de-2027",
    "05-de-noviembre-de-2026",
    "12-de-Noviembre-de-2026",
    "12-de-nov-de-2026",
    "noviembre-de-2026",
    "",
  ])("parseDaySlug rejects %j", (s) => {
    expect(parseDaySlug(s)).toBeNull();
  });

  it.each(["12-de-noviembre-de-2026", "Noviembre-de-2026", ""])("parseMonthSlug rejects %j", (s) => {
    expect(parseMonthSlug(s)).toBeNull();
  });

  it("names weekdays in Spanish", () => {
    expect(weekdayName("2026-11-12")).toBe("jueves");
    expect(weekdayName("2026-11-15")).toBe("domingo");
  });

  it("extracts the month", () => {
    expect(monthOf("2026-11-12")).toBe("2026-11");
  });
});
