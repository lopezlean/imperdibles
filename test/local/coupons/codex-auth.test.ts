import { describe, expect, it } from "vitest";
import { CodexAuthError, createCodexAuth, type CodexAuthFs } from "../../../src/local/coupons/codex-auth.js";

const FILE = "/home/x/.codex/auth.json";
const NOW = new Date("2026-11-13T12:00:00.000Z");
const nowSec = NOW.getTime() / 1000;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(payload)}.sig`;

const OLD_REFRESH = "OLD-REFRESH-TOKEN";

function setup(opts: { access: string; extra?: Record<string, unknown>; mode?: string; tokens?: unknown; res?: () => Response }) {
  const doc = {
    auth_mode: opts.mode ?? "chatgpt",
    OPENAI_API_KEY: null,
    tokens: opts.tokens ?? { id_token: "OLD-ID", access_token: opts.access, refresh_token: OLD_REFRESH, account_id: "acc-fallback" },
    last_refresh: "2026-01-01T00:00:00.000Z",
    ...opts.extra,
  };
  const files = new Map<string, { data: string; mode?: number }>([[FILE, { data: JSON.stringify(doc) }]]);
  const ops: string[] = [];
  const fs: CodexAuthFs = {
    readFile: async (f) => {
      const e = files.get(f);
      if (!e) throw new Error("ENOENT");
      return e.data;
    },
    writeFile: async (f, data, o) => {
      ops.push(`write ${f}`);
      files.set(f, { data, mode: o.mode });
    },
    rename: async (from, to) => {
      ops.push(`rename ${from} -> ${to}`);
      files.set(to, files.get(from)!);
      files.delete(from);
    },
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return opts.res ? opts.res() : Response.json({ access_token: jwt({ exp: nowSec + 3600 }), refresh_token: "NEW-REFRESH", id_token: "NEW-ID" });
  }) as unknown as typeof fetch;
  const auth = createCodexAuth({ filePath: FILE, fs, fetch: fetchFn, now: () => NOW });
  return { auth, files, ops, calls, saved: () => JSON.parse(files.get(FILE)!.data) };
}

describe("createCodexAuth", () => {
  it("does not refresh a fresh token and reads the account id from the JWT", async () => {
    const access = jwt({ exp: nowSec + 3600, "https://api.openai.com/auth": { chatgpt_account_id: "acc-jwt" } });
    const t = setup({ access });
    expect(await t.auth.getCredentials()).toEqual({ accessToken: access, accountId: "acc-jwt" });
    expect(t.calls).toHaveLength(0);
    expect(t.ops).toHaveLength(0);
  });

  it("falls back to tokens.account_id when the JWT has no account claim", async () => {
    const access = jwt({ exp: nowSec + 3600 });
    expect((await setup({ access }).auth.getCredentials()).accountId).toBe("acc-fallback");
  });

  it("refreshes when within 300s of expiry with the exact form body", async () => {
    const t = setup({ access: jwt({ exp: nowSec + 299 }) });
    const creds = await t.auth.getCredentials();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.url).toBe("https://auth.openai.com/oauth/token");
    expect(t.calls[0]!.init.method).toBe("POST");
    expect((t.calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(t.calls[0]!.init.body).toBe(`grant_type=refresh_token&client_id=app_EMoamEEZ73f0CkXaXp7hrann&refresh_token=${OLD_REFRESH}`);
    expect(creds.accessToken).toBe(t.saved().tokens.access_token);
  });

  it("does not refresh at exactly more than 300s left, and refreshes at exactly 300s", async () => {
    expect(setup({ access: jwt({ exp: nowSec + 301 }) }).calls).toHaveLength(0);
    const t = setup({ access: jwt({ exp: nowSec + 300 }) });
    await t.auth.getCredentials();
    expect(t.calls).toHaveLength(1);
  });

  it("refreshes when exp is missing or the token is not a JWT", async () => {
    for (const access of [jwt({}), "not-a-jwt"]) {
      const t = setup({ access });
      await t.auth.getCredentials();
      expect(t.calls).toHaveLength(1);
    }
  });

  it("writes back preserving other fields, rotating tokens and setting last_refresh, via temp + rename at 0o600", async () => {
    const t = setup({ access: jwt({ exp: nowSec - 10 }), extra: { custom: { keep: true } } });
    await t.auth.getCredentials();
    const saved = t.saved();
    expect(saved.custom).toEqual({ keep: true });
    expect(saved.OPENAI_API_KEY).toBeNull();
    expect(saved.auth_mode).toBe("chatgpt");
    expect(saved.tokens.refresh_token).toBe("NEW-REFRESH");
    expect(saved.tokens.id_token).toBe("NEW-ID");
    expect(saved.tokens.account_id).toBe("acc-fallback");
    expect(saved.last_refresh).toBe(NOW.toISOString());
    expect(t.ops).toHaveLength(2);
    expect(t.ops[0]).toMatch(/^write \/home\/x\/\.codex\/.+\.tmp$/);
    expect(t.ops[1]).toMatch(/^rename \/home\/x\/\.codex\/.+\.tmp -> \/home\/x\/\.codex\/auth\.json$/);
    expect(t.files.get(FILE)!.mode).toBe(0o600);
    expect([...t.files.keys()]).toEqual([FILE]);
  });

  it("keeps the stored refresh and id tokens when the response omits them", async () => {
    const t = setup({ access: jwt({ exp: nowSec - 10 }), res: () => Response.json({ access_token: jwt({ exp: nowSec + 3600 }), expires_in: 3600 }) });
    await t.auth.getCredentials();
    expect(t.saved().tokens.refresh_token).toBe(OLD_REFRESH);
    expect(t.saved().tokens.id_token).toBe("OLD-ID");
  });

  it("a failed refresh throws a typed error with the status and no token or body", async () => {
    const t = setup({ access: jwt({ exp: nowSec - 10 }), res: () => new Response(`bad ${OLD_REFRESH}`, { status: 401 }) });
    const err = await t.auth.getCredentials().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexAuthError);
    expect((err as Error).message).toBe("Codex token refresh failed (401); run `codex login` again");
    expect(JSON.stringify([(err as Error).message, (err as Error).stack])).not.toContain(OLD_REFRESH);
    expect(t.ops).toHaveLength(0);
  });

  it("rejects a non-chatgpt or token-less file naming the file but no values", async () => {
    for (const t of [setup({ access: "x", mode: "apikey" }), setup({ access: "x", tokens: "none" })]) {
      const err = await t.auth.getCredentials().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CodexAuthError);
      expect((err as Error).message).toContain(FILE);
      expect((err as Error).message).not.toContain(OLD_REFRESH);
    }
  });

  it("shares one refresh between concurrent callers", async () => {
    const t = setup({ access: jwt({ exp: nowSec - 10 }) });
    await Promise.all([t.auth.getCredentials(), t.auth.getCredentials()]);
    expect(t.calls).toHaveLength(1);
  });
});
