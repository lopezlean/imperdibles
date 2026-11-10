import type { CandidateList } from "./candidate-list.js";

export type OwnerAlert =
  | { kind: "run_failed"; corrida_id: string | null; reason: string }
  | { kind: "run_partial"; corrida_id: string; skipped_models: number; reason: string }
  | { kind: "store_format_error"; tienda: string }
  | { kind: "ml_auth_required" }
  | { kind: "ml_permission_denied"; path: string };

export type RevalidationReport = {
  fecha: string;
  validated: string[]; // candidato_id
  invalidated: { candidato_id: string; titulo: string; reason: "below_threshold" | "offer_missing" }[];
};

export interface LocalOutputHooks {
  onCandidatesReady(list: CandidateList): Promise<void>;
  onRevalidated(report: RevalidationReport): Promise<void>;
  notifyOwner(alert: OwnerAlert): Promise<void>;
}
