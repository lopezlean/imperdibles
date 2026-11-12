import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { ChannelPost, ChannelReader } from "./reader.js";

export type RawMessage = { id: number; date: number; message?: string | null };

type FetchOpts = { afterId: number | null; since: Date };

/** Keeps text-only posts matching the cursor (or the `since` floor on a first run), ascending by id. */
export function toChannelPosts(raw: RawMessage[], opts: FetchOpts): ChannelPost[] {
  const posts: ChannelPost[] = [];
  for (const m of raw) {
    const text = m.message;
    if (typeof text !== "string" || text.trim() === "") continue;
    const date = new Date(m.date * 1000);
    if (opts.afterId !== null) {
      if (m.id <= opts.afterId) continue;
    } else if (date.getTime() < opts.since.getTime()) {
      continue;
    }
    posts.push({ id: m.id, text, date });
  }
  return posts.sort((a, b) => a.id - b.id);
}

/** The slice of the GramJS client the reader uses; tests inject a fake. */
export interface GramjsClientLike {
  connect(): Promise<unknown>;
  getDialogs(params: { limit: number }): Promise<unknown>;
  getMessages(channel: string, params: { limit: number; minId?: number }): Promise<RawMessage[]>;
  disconnect(): Promise<unknown>;
  destroy(): Promise<unknown>;
}

export type GramjsReaderConfig = { apiId: number; apiHash: string; session: string; channelId: string };

/** Connects on every call and always disconnects. */
export function createGramjsReader(
  cfg: GramjsReaderConfig,
  makeClient: (cfg: GramjsReaderConfig) => GramjsClientLike = defaultClient,
): ChannelReader {
  return {
    async fetchPosts(opts) {
      const client = makeClient(cfg);
      try {
        await client.connect();
        // A numeric channel id only resolves once GramJS has seen this session's dialogs.
        if (/^-?\d+$/.test(cfg.channelId)) await client.getDialogs({ limit: 200 });
        const raw = await client.getMessages(cfg.channelId, {
          limit: 200,
          ...(opts.afterId !== null ? { minId: opts.afterId } : {}),
        });
        return toChannelPosts(raw, opts);
      } catch (e) {
        throw new Error(`Could not read the Telegram channel (${errorName(e)})`);
      } finally {
        await client.disconnect().catch(() => undefined);
        await client.destroy().catch(() => undefined);
      }
    },
  };
}

/** Only the error class: GramJS messages can echo the phone number or the session. */
function errorName(e: unknown): string {
  return e instanceof Error && e.name !== "" ? e.name : "unknown error";
}

function defaultClient(cfg: GramjsReaderConfig): GramjsClientLike {
  const client = new TelegramClient(new StringSession(cfg.session), cfg.apiId, cfg.apiHash, {
    connectionRetries: 3,
  });
  return client as unknown as GramjsClientLike;
}
