import type { Coupon, StoredCoupon } from "../../contract/coupon.js";
import type { SqlClient } from "../../shared/db/sql-client.js";
import { artIso } from "../../shared/time.js";

export const CONFIG_LINK = "coupons_affiliate_link";
export const CONFIG_CURSOR = "coupons_last_message_id";
export const CONFIG_FINGERPRINT = "coupons_site_fingerprint";
export const CONFIG_LINK_NOTICE = "coupons_link_notified_on";

export type PostStatus = "failed" | "done" | "skipped";

export async function getConfig(db: SqlClient, name: string): Promise<string | null> {
  const rows = await db.all<{ value: string }>("SELECT value FROM config WHERE name = ?", [name]);
  return rows[0]?.value ?? null;
}

export async function setConfig(db: SqlClient, name: string, value: string): Promise<void> {
  await db.run("INSERT INTO config (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", [name, value]);
}

/** The new row's id, or null when this (source message, code) pair is already stored. */
export async function insertPending(
  db: SqlClient,
  c: Coupon,
  src: { message_id: number; text: string },
  now: Date,
): Promise<number | null> {
  const stamp = artIso(now);
  const { changes } = await db.run(
    `INSERT INTO coupons
       (code, discount_type, discount_value, min_purchase, cap, scope, valid_from, valid_until, status, source_message_id, source_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
     ON CONFLICT (source_message_id, code) DO NOTHING`,
    [c.code, c.discount_type, c.discount_value, c.min_purchase, c.cap, c.scope, c.valid_from, c.valid_until, src.message_id, src.text, stamp, stamp],
  );
  if (changes === 0) return null;
  const rows = await db.all<{ id: number }>("SELECT id FROM coupons WHERE source_message_id = ? AND code = ?", [src.message_id, c.code]);
  return rows[0]?.id ?? null;
}

/** Any status; the row whose valid_until is still after `at`. */
export async function findByCodeValidAt(db: SqlClient, code: string, at: Date): Promise<StoredCoupon | null> {
  const rows = await db.all<StoredCoupon>("SELECT * FROM coupons WHERE code = ? AND valid_until > ? ORDER BY id DESC LIMIT 1", [code, at.toISOString()]);
  return rows[0] ?? null;
}

/** Moves valid_until only forward. */
export async function extendValidity(db: SqlClient, id: number, validUntil: string, now: Date): Promise<void> {
  await db.run("UPDATE coupons SET valid_until = ?, updated_at = ? WHERE id = ? AND valid_until < ?", [validUntil, artIso(now), id, validUntil]);
}

export async function listPendingToPublish(db: SqlClient, now: Date): Promise<StoredCoupon[]> {
  return db.all<StoredCoupon>("SELECT * FROM coupons WHERE status = 'pending' AND valid_until > ? ORDER BY id", [now.toISOString()]);
}

/** Atomically takes a pending row (pending -> published); false when someone else already did. */
export async function claimForPublish(db: SqlClient, id: number): Promise<boolean> {
  const { changes } = await db.run("UPDATE coupons SET status = 'published' WHERE id = ? AND status = 'pending'", [id]);
  return changes > 0;
}

export async function releaseClaim(db: SqlClient, id: number): Promise<void> {
  await db.run("UPDATE coupons SET status = 'pending' WHERE id = ? AND status = 'published'", [id]);
}

export async function recordChannelMessage(db: SqlClient, id: number, messageId: number): Promise<void> {
  await db.run("UPDATE coupons SET channel_message_id = ? WHERE id = ?", [messageId, id]);
}

export async function recordOwnerMessage(db: SqlClient, id: number, messageId: number): Promise<void> {
  await db.run("UPDATE coupons SET owner_message_id = ? WHERE id = ?", [messageId, id]);
}

export async function getPost(db: SqlClient, sourceMessageId: number): Promise<{ status: PostStatus; attempts: number } | null> {
  const rows = await db.all<{ status: PostStatus; attempts: number }>("SELECT status, attempts FROM coupon_posts WHERE source_message_id = ?", [sourceMessageId]);
  return rows[0] ?? null;
}

export async function recordPost(
  db: SqlClient,
  sourceMessageId: number,
  status: PostStatus,
  attempts: number,
  error: string | null,
  now: Date,
): Promise<void> {
  await db.run(
    `INSERT INTO coupon_posts (source_message_id, status, attempts, last_error, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_message_id) DO UPDATE SET status = excluded.status, attempts = excluded.attempts, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    [sourceMessageId, status, attempts, error, artIso(now)],
  );
}
