import { createHash } from "node:crypto";
import type { Candidate } from "../../src/contract/candidate-list.js";

/** Short fingerprint of what the card shows: the ML price and every rival price. */
export function cardVersion(c: Pick<Candidate, "ml" | "others">): string {
  const prices = [c.ml.price_ars, ...c.others.map((o) => o.price_ars).sort((a, b) => a - b)].join("|");
  return createHash("sha1").update(prices).digest("hex").slice(0, 10);
}
