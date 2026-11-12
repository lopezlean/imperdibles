import type { IngestReport } from "./ingest.js";

export type RoundDeps = {
  ingest: () => Promise<IngestReport>;
  sync: () => Promise<"unchanged" | "shipped" | "failed">;
  notifyOwner: (text: string) => Promise<void>;
  log: (line: string) => void;
};

const ROUND_DEADLINE_MS = 10 * 60_000;
const OWNER_ERROR_LIMIT = 500;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One coupon round: ingest, then rebuild the site if the coupons changed. Everything is caught here, so a
 * coupon problem is logged and reported to the owner but never reaches the deal flow. The whole round has a
 * 10-minute deadline so a hang cannot delay the next hourly run. Never rejects.
 */
export async function runCouponRound(deps: RoundDeps): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ROUND_DEADLINE_MS);
  });
  try {
    const outcome = await Promise.race([runRound(deps).then(() => "done" as const), deadline]);
    if (outcome === "timeout") {
      const message = "La ronda de cupones superó 10 minutos y se cortó.";
      try {
        deps.log(`coupons: ${message}`);
      } catch {
        // A broken logger must not break the round.
      }
      await deps.notifyOwner(message).catch(() => undefined);
    }
  } catch {
    // runRound never rejects; nothing from the coupon side may reach the deal flow.
  } finally {
    clearTimeout(timer);
  }
}

async function runRound(deps: RoundDeps): Promise<void> {
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
    await tell(`Falló la lectura de cupones: ${errText(e).slice(0, OWNER_ERROR_LIMIT)}`);
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
