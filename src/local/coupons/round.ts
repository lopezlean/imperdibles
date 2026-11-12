import type { IngestReport } from "./ingest.js";

export type RoundDeps = {
  ingest: () => Promise<IngestReport>;
  sync: () => Promise<"unchanged" | "shipped" | "failed">;
  notifyOwner: (text: string) => Promise<void>;
  log: (line: string) => void;
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One coupon round: ingest, then rebuild the site if the coupons changed. Everything is caught here, so a
 * coupon problem is logged and reported to the owner but never reaches the deal flow. Never rejects.
 */
export async function runCouponRound(deps: RoundDeps): Promise<void> {
  const safeLog = (line: string): void => {
    try {
      deps.log(line);
    } catch {
      // A broken logger must not break the round.
    }
  };
  const tell = async (text: string): Promise<void> => {
    try {
      await deps.notifyOwner(text);
    } catch (e) {
      safeLog(`coupons: owner message failed: ${errText(e)}`);
    }
  };

  let report: IngestReport | null = null;
  try {
    report = await deps.ingest();
  } catch (e) {
    safeLog(`coupons: ingest failed: ${errText(e)}`);
    await tell(`Falló la lectura de cupones: ${errText(e)}`);
  }

  let site = "failed";
  try {
    site = await deps.sync();
  } catch (e) {
    safeLog(`coupons: site sync failed: ${errText(e)}`);
  }

  if (report) {
    safeLog(
      `coupons: leídos ${report.posts}, nuevos ${report.stored}, extendidos ${report.extended}, duplicados ${report.duplicates}, rechazados ${report.rejected}, publicados ${report.published}, fallidos ${report.failedPosts}; web ${site}`,
    );
  }
}
