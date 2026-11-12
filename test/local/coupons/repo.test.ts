import { describe, expect, it } from "vitest";
import type { Coupon } from "../../../src/contract/coupon.js";
import {
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
} from "../../../src/local/coupons/repo.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

const NOW = new Date("2026-11-12T15:00:00.000Z");
const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  code: "ABC123",
  discount_type: "amount",
  discount_value: 5000,
  min_purchase: 20000,
  cap: null,
  scope: "",
  valid_from: "2026-11-12T12:00:00.000Z",
  valid_until: "2026-11-13T02:59:59.000Z",
  ...over,
});
const src = (message_id = 1) => ({ message_id, text: "post" });

describe("coupon config", () => {
  it("setConfig upserts and getConfig returns null when absent", async () => {
    const db = createSqliteClient();
    expect(await getConfig(db, "k")).toBeNull();
    await setConfig(db, "k", "a");
    await setConfig(db, "k", "b");
    expect(await getConfig(db, "k")).toBe("b");
  });
});

describe("coupon repository", () => {
  it("insertPending stores a pending row and returns its id, then null for the same (message, code)", async () => {
    const db = createSqliteClient();
    const id = await insertPending(db, coupon(), src(), NOW);
    expect(id).toBeGreaterThan(0);
    expect(await insertPending(db, coupon(), src(), NOW)).toBeNull();
    const rows = await db.all<{ status: string; source_text: string; created_at: string }>("SELECT * FROM coupons");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", source_text: "post", created_at: "2026-11-12T12:00:00-03:00" });
    expect(await insertPending(db, coupon(), src(2), NOW)).not.toBeNull();
  });

  it("findByCodeValidAt matches only rows whose valid_until is after the instant, in any status", async () => {
    const db = createSqliteClient();
    const id = (await insertPending(db, coupon(), src(), NOW))!;
    await db.run("UPDATE coupons SET status = 'removed' WHERE id = ?", [id]);
    const hit = await findByCodeValidAt(db, "ABC123", new Date("2026-11-12T20:00:00.000Z"));
    expect(hit).toMatchObject({ id, status: "removed", code: "ABC123", source_message_id: 1, channel_message_id: null });
    expect(await findByCodeValidAt(db, "ABC123", new Date("2026-11-13T02:59:59.000Z"))).toBeNull();
    expect(await findByCodeValidAt(db, "OTHER", NOW)).toBeNull();
  });

  it("extendValidity only moves valid_until forward", async () => {
    const db = createSqliteClient();
    const id = (await insertPending(db, coupon(), src(), NOW))!;
    await extendValidity(db, id, "2026-11-12T20:00:00.000Z", NOW);
    expect((await findByCodeValidAt(db, "ABC123", NOW))!.valid_until).toBe("2026-11-13T02:59:59.000Z");
    await extendValidity(db, id, "2026-11-14T02:59:59.000Z", NOW);
    expect((await findByCodeValidAt(db, "ABC123", NOW))!.valid_until).toBe("2026-11-14T02:59:59.000Z");
  });

  it("claimForPublish is true once, then false; releaseClaim makes it claimable again", async () => {
    const db = createSqliteClient();
    const id = (await insertPending(db, coupon(), src(), NOW))!;
    expect(await claimForPublish(db, id)).toBe(true);
    expect(await claimForPublish(db, id)).toBe(false);
    await releaseClaim(db, id);
    expect(await claimForPublish(db, id)).toBe(true);
  });

  it("listPendingToPublish skips expired, published and removed, ordered by id", async () => {
    const db = createSqliteClient();
    const a = (await insertPending(db, coupon({ code: "A" }), src(1), NOW))!;
    const expired = (await insertPending(db, coupon({ code: "E", valid_until: "2026-11-12T10:00:00.000Z" }), src(2), NOW))!;
    const published = (await insertPending(db, coupon({ code: "P" }), src(3), NOW))!;
    const removed = (await insertPending(db, coupon({ code: "R" }), src(4), NOW))!;
    const b = (await insertPending(db, coupon({ code: "B" }), src(5), NOW))!;
    await claimForPublish(db, published);
    await db.run("UPDATE coupons SET status = 'removed' WHERE id = ?", [removed]);
    const list = await listPendingToPublish(db, NOW);
    expect(list.map((c) => c.id)).toEqual([a, b]);
    expect(list.map((c) => c.id)).not.toContain(expired);
  });

  it("records the channel and owner message ids", async () => {
    const db = createSqliteClient();
    const id = (await insertPending(db, coupon(), src(), NOW))!;
    await recordChannelMessage(db, id, 77);
    await recordOwnerMessage(db, id, 88);
    expect(await findByCodeValidAt(db, "ABC123", NOW)).toMatchObject({ channel_message_id: 77, owner_message_id: 88 });
  });

  it("recordPost upserts attempts and status", async () => {
    const db = createSqliteClient();
    expect(await getPost(db, 9)).toBeNull();
    await recordPost(db, 9, "failed", 1, "boom", NOW);
    expect(await getPost(db, 9)).toEqual({ status: "failed", attempts: 1 });
    await recordPost(db, 9, "skipped", 3, null, NOW);
    expect(await getPost(db, 9)).toEqual({ status: "skipped", attempts: 3 });
  });
});
