import type { ExtractedCoupon, GuardReason } from "../../contract/coupon.js";
import { buildCouponChannelMessage, buildCouponOwnerNotice, buildCouponRejectedNotice, buildCouponUnrecordedNotice } from "../../output/publish/coupon-messages.js";
import type { TelegramClient } from "../../output/telegram/client.js";
import type { SqlClient } from "../../shared/db/sql-client.js";
import { artDate } from "../../shared/time.js";
import { ExtractionError, type CouponExtractor } from "./extractor.js";
import { guardCoupon } from "./guard.js";
import type { ChannelPost, ChannelReader } from "./reader.js";
import {
  CONFIG_CURSOR,
  CONFIG_LINK,
  CONFIG_LINK_NOTICE,
  claimForPublish,
  extendValidity,
  findByCodeValidAt,
  getConfig,
  getPost,
  insertPending,
  listPendingToPublish,
  recordChannelMessage,
  recordOwnerMessage,
  recordPost,
  releaseClaim,
  setConfig,
} from "./repo.js";

export const MAX_EXTRACTION_ATTEMPTS = 3;

export type IngestDeps = {
  db: SqlClient;
  reader: ChannelReader;
  extractor: CouponExtractor;
  telegram: Pick<TelegramClient, "sendMessage">;
  channelId: string;
  ownerChatId: string;
  now: () => Date;
};

export type IngestReport = {
  /** Posts read from the channel that were not already done or skipped. */
  posts: number;
  stored: number;
  extended: number;
  duplicates: number;
  /** Coupons refused by the guard (already expired ones are dropped silently and not counted). */
  rejected: number;
  published: number;
  /** Posts whose extraction failed in this run (retried later, or skipped after the last attempt). */
  failedPosts: number;
};

/** A failed owner message never aborts the run. */
async function tryNotifyOwner(deps: IngestDeps, text: string): Promise<{ message_id: number } | null> {
  try {
    return await deps.telegram.sendMessage({ chat_id: deps.ownerChatId, text });
  } catch {
    return null;
  }
}

/** Only our own ExtractionError carries its message (it never holds secrets); anything else is reduced to its name. */
function describeError(e: unknown): string {
  if (e instanceof ExtractionError) return e.message.slice(0, 200);
  return e instanceof Error ? e.name : "unknown error";
}

/** The same code twice in one post is one coupon: the first occurrence wins. */
function uniqueByCode(coupons: ExtractedCoupon[]): ExtractedCoupon[] {
  const seen = new Set<string>();
  return coupons.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
}

type Counters = Pick<IngestReport, "stored" | "extended" | "duplicates" | "rejected">;

async function storeCoupons(deps: IngestDeps, post: ChannelPost, extracted: ExtractedCoupon[], now: Date, counts: Counters): Promise<void> {
  for (const candidate of uniqueByCode(extracted)) {
    const guarded = guardCoupon(candidate, { text: post.text, postedAt: post.date }, now);
    if (!guarded.ok) {
      if (guarded.reason === "already_expired") continue;
      counts.rejected++;
      await tryNotifyOwner(
        deps,
        buildCouponRejectedNotice({ reason: guarded.reason as Exclude<GuardReason, "already_expired">, code: candidate.code, sourceText: post.text }),
      );
      continue;
    }
    const coupon = guarded.coupon;
    const existing = await findByCodeValidAt(deps.db, coupon.code, post.date);
    if (existing) {
      // Extend only a window that touches or overlaps the existing one; a later window is a new coupon.
      if (coupon.valid_from > existing.valid_until) {
        const id = await insertPending(deps.db, coupon, { message_id: post.id, text: post.text }, now);
        if (id === null) counts.duplicates++;
        else counts.stored++;
      } else if (existing.status !== "removed" && coupon.valid_until > existing.valid_until) {
        await extendValidity(deps.db, existing.id, coupon.valid_until, now);
        counts.extended++;
      } else {
        counts.duplicates++;
      }
      continue;
    }
    const id = await insertPending(deps.db, coupon, { message_id: post.id, text: post.text }, now);
    if (id === null) counts.duplicates++;
    else counts.stored++;
  }
}

async function publishPending(deps: IngestDeps, now: Date): Promise<number> {
  const pending = await listPendingToPublish(deps.db, now);
  if (pending.length === 0) return 0;

  const link = await getConfig(deps.db, CONFIG_LINK);
  if (link === null || link.trim() === "") {
    const today = artDate(now);
    if ((await getConfig(deps.db, CONFIG_LINK_NOTICE)) !== today) {
      const sent = await tryNotifyOwner(deps, "Hay cupones nuevos pero falta el enlace de afiliado. Ejecutar: imperdibles cupones-link <enlace meli.la>.");
      if (sent) await setConfig(deps.db, CONFIG_LINK_NOTICE, today);
    }
    return 0;
  }

  let published = 0;
  for (const row of pending) {
    // Claim before sending: whoever wins the conditional update is the only one that posts.
    if (!(await claimForPublish(deps.db, row.id, now))) continue;
    let channelMessageId: number;
    try {
      ({ message_id: channelMessageId } = await deps.telegram.sendMessage({ chat_id: deps.channelId, text: buildCouponChannelMessage(row, link) }));
    } catch {
      let released = true;
      await releaseClaim(deps.db, row.id, now).catch(() => {
        released = false;
      });
      await tryNotifyOwner(
        deps,
        released
          ? `No se pudo publicar el cupón ${row.code} en el canal. Se reintenta en la próxima revalidación.`
          : `El cupón ${row.code} quedó publicado sin mensaje en el canal: falló el envío y no se pudo liberar. No se reintentará solo.`,
      );
      continue;
    }
    published++;
    // The message is already public: whatever happens to the bookkeeping, the owner must still hear about it.
    let recorded = true;
    try {
      await recordChannelMessage(deps.db, row.id, channelMessageId);
    } catch {
      recorded = false;
    }
    const notice = await tryNotifyOwner(
      deps,
      recorded ? buildCouponOwnerNotice(row, row.source_text) : buildCouponUnrecordedNotice(row, channelMessageId, row.source_text),
    );
    if (notice) await recordOwnerMessage(deps.db, row.id, notice.message_id).catch(() => undefined);
  }
  return published;
}

export async function ingestCoupons(deps: IngestDeps): Promise<IngestReport> {
  const now = deps.now();
  const report: IngestReport = { posts: 0, stored: 0, extended: 0, duplicates: 0, rejected: 0, published: 0, failedPosts: 0 };

  const cursorValue = await getConfig(deps.db, CONFIG_CURSOR);
  const afterId = cursorValue === null ? null : Number(cursorValue);
  // The reader does not enforce the first-run rule: only today's messages in ART.
  const since = new Date(`${artDate(now)}T00:00:00-03:00`);
  const posts = await deps.reader.fetchPosts({ afterId, since });

  let lowestFailed: number | null = null;
  let highestRead: number | null = null;
  for (const post of posts) {
    highestRead = highestRead === null ? post.id : Math.max(highestRead, post.id);
    const known = await getPost(deps.db, post.id);
    if (known && known.status !== "failed") continue;
    report.posts++;

    let extracted: ExtractedCoupon[];
    try {
      extracted = await deps.extractor.extract({ text: post.text, postedAt: post.date });
    } catch (e) {
      const attempts = (known?.attempts ?? 0) + 1;
      report.failedPosts++;
      if (attempts >= MAX_EXTRACTION_ATTEMPTS) {
        await recordPost(deps.db, post.id, "skipped", attempts, describeError(e), now);
        await tryNotifyOwner(deps, buildCouponRejectedNotice({ reason: "extraction_failed", code: null, sourceText: post.text }));
      } else {
        await recordPost(deps.db, post.id, "failed", attempts, describeError(e), now);
        lowestFailed = lowestFailed === null ? post.id : Math.min(lowestFailed, post.id);
      }
      continue;
    }

    await storeCoupons(deps, post, extracted, now, report);
    await recordPost(deps.db, post.id, "done", known?.attempts ?? 0, null, now);
  }

  // Never past a post that still needs a retry; otherwise up to the highest post read.
  const next = lowestFailed !== null ? lowestFailed - 1 : highestRead;
  if (next !== null && (afterId === null || next > afterId)) {
    await setConfig(deps.db, CONFIG_CURSOR, String(next));
  }

  report.published = await publishPending(deps, now);
  return report;
}
