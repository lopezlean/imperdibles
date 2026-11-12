import { describe, expect, it } from "vitest";
import {
  createGramjsReader,
  safeErrorName,
  toChannelPosts,
  type GramjsClientLike,
  type RawMessage,
} from "../../../src/local/coupons/gramjs-reader.js";

const since = new Date("2026-11-12T03:00:00Z");

describe("toChannelPosts", () => {
  it("drops messages without text and returns ascending ids", () => {
    const raw: RawMessage[] = [
      { id: 5, date: 1_800_000_000, message: "cinco" },
      { id: 4, date: 1_800_000_000, message: null },
      { id: 3, date: 1_800_000_000, message: "tres" },
      { id: 2, date: 1_800_000_000 },
      { id: 1, date: 1_800_000_000, message: "  " },
    ];
    const posts = toChannelPosts(raw, { afterId: 0, since });
    expect(posts.map((p) => p.id)).toEqual([3, 5]);
  });

  it("afterId keeps only ids greater than the cursor", () => {
    const raw: RawMessage[] = [
      { id: 10, date: 1, message: "a" },
      { id: 11, date: 1, message: "b" },
      { id: 12, date: 1, message: "c" },
    ];
    expect(toChannelPosts(raw, { afterId: 10, since }).map((p) => p.id)).toEqual([11, 12]);
  });

  it("first run (afterId null) keeps only messages dated at or after since", () => {
    const sinceSec = since.getTime() / 1000;
    const raw: RawMessage[] = [
      { id: 1, date: sinceSec - 1, message: "ayer" },
      { id: 2, date: sinceSec, message: "justo" },
      { id: 3, date: sinceSec + 60, message: "hoy" },
    ];
    expect(toChannelPosts(raw, { afterId: null, since }).map((p) => p.id)).toEqual([2, 3]);
  });

  it("maps unix seconds to Date", () => {
    const [post] = toChannelPosts([{ id: 1, date: 1_800_000_000, message: "x" }], { afterId: null, since: new Date(0) });
    expect(post?.date.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });
});

function fakeClient(overrides: Partial<GramjsClientLike> = {}) {
  const calls: string[] = [];
  const client: GramjsClientLike = {
    connect: async () => void calls.push("connect"),
    getDialogs: async () => void calls.push("getDialogs"),
    getMessages: async (_c, params) => {
      calls.push(`getMessages:${JSON.stringify(params)}`);
      return [{ id: 7, date: 1_800_000_000, message: "hola" }];
    },
    disconnect: async () => void calls.push("disconnect"),
    destroy: async () => void calls.push("destroy"),
    ...overrides,
  };
  return { client, calls };
}

const cfg = { apiId: 1, apiHash: "hash-secret", session: "session-secret", channelId: "-1001234" };

describe("createGramjsReader", () => {
  it("connects, loads dialogs for a numeric id, passes minId and always disconnects", async () => {
    const { client, calls } = fakeClient();
    const posts = await createGramjsReader(cfg, () => client).fetchPosts({ afterId: 6, since });
    expect(posts.map((p) => p.id)).toEqual([7]);
    expect(calls).toEqual(["connect", "getDialogs", 'getMessages:{"limit":200,"minId":6,"reverse":true}', "disconnect", "destroy"]);
  });

  it("omits minId on a first run and skips dialogs for a username", async () => {
    const { client, calls } = fakeClient();
    await createGramjsReader({ ...cfg, channelId: "canal" }, () => client).fetchPosts({
      afterId: null,
      since: new Date(0),
    });
    expect(calls).toEqual(["connect", 'getMessages:{"limit":200}', "disconnect", "destroy"]);
  });

  it("rethrows a plain error without secrets and still disconnects", async () => {
    const { client, calls } = fakeClient({
      getMessages: async () => {
        throw new Error("boom session-secret hash-secret +5491100000000");
      },
    });
    const err = await createGramjsReader(cfg, () => client)
      .fetchPosts({ afterId: 1, since })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    for (const s of ["session-secret", "hash-secret", "+5491100000000"]) expect(msg).not.toContain(s);
    expect(calls.slice(-2)).toEqual(["disconnect", "destroy"]);
  });
});

describe("createGramjsReader ordering", () => {
  it("returns ascending ids for an oldest-first batch with minId and reverse", async () => {
    const seen: unknown[] = [];
    const { client } = fakeClient({
      getMessages: async (_c, params) => {
        seen.push(params);
        return [
          { id: 9, date: 1, message: "c" },
          { id: 7, date: 1, message: "a" },
          { id: 8, date: 1, message: "b" },
        ];
      },
    });
    const posts = await createGramjsReader({ ...cfg, channelId: "canal" }, () => client).fetchPosts({ afterId: 6, since });
    expect(seen).toEqual([{ limit: 200, minId: 6, reverse: true }]);
    expect(posts.map((p) => p.id)).toEqual([7, 8, 9]);
  });
});

describe("safeErrorName", () => {
  it("keeps a plain class name and replaces anything else with Error", () => {
    expect(safeErrorName(new TypeError("x"))).toBe("TypeError");
    const odd = new Error("x");
    odd.name = "FLOOD_WAIT 5 session-secret";
    expect(safeErrorName(odd)).toBe("Error");
    expect(safeErrorName("nope")).toBe("Error");
  });

  it("never leaks a custom error name through the reader", async () => {
    const { client } = fakeClient({
      getMessages: async () => {
        const e = new Error("x");
        e.name = "bad name session-secret";
        throw e;
      },
    });
    const err = (await createGramjsReader(cfg, () => client)
      .fetchPosts({ afterId: 1, since })
      .catch((e: Error) => e)) as Error;
    expect(err.message).toBe("Could not read the Telegram channel (Error)");
  });
});
