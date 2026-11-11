import type { CandidateList } from "./candidate-list.js";

export type OwnerAlert =
  | { kind: "run_failed"; run_id: string | null; reason: string }
  | { kind: "run_partial"; run_id: string; skipped_models: number; reason: string }
  | { kind: "store_format_error"; store: string }
  | { kind: "ml_auth_required" }
  | { kind: "ml_permission_denied"; path: string };

export type RevalidationReport = {
  run_date: string;
  validated: string[]; // candidate_id
  invalidated: { candidate_id: string; title: string; reason: "below_threshold" | "offer_missing" }[];
};

export interface LocalOutputHooks {
  onCandidatesReady(list: CandidateList): Promise<void>;
  onRevalidated(report: RevalidationReport): Promise<void>;
  notifyOwner(alert: OwnerAlert): Promise<void>;
}
