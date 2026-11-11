import type { Category } from "../shared/config.js";
import { daysBetween } from "../shared/time.js";

/** Rotation starts here: this date maps to the first category. */
const ROTATION_BASE = "2026-11-10";

/** One category per ART day, cycling in config order; dates before the base wrap backwards. */
export function categoryOfDay(categories: Category[], run_date: string): Category {
  const n = categories.length;
  if (n === 0) throw new Error("config key categories has no categories");
  const index = ((daysBetween(ROTATION_BASE, run_date) % n) + n) % n;
  return categories[index]!;
}
