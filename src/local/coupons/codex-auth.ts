import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/** Refresh when the access token expires within this many seconds. */
const REFRESH_MARGIN_S = 300;

/** The Codex login is unusable or could not be refreshed. Messages name the file, never token values. */
export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthError";
  }
}

export type CodexAuthFs = {
  readFile(file: string, encoding: "utf8"): Promise<string>;
  writeFile(file: string, data: string, options: { mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

export type CodexCredentials = { accessToken: string; accountId: string | undefined };

export type CodexAuth = { getCredentials(): Promise<CodexCredentials> };

export type CodexAuthDeps = {
  /** Defaults to ~/.codex/auth.json. */
  filePath?: string;
  fs?: CodexAuthFs;
  fetch?: typeof fetch;
  now?: () => Date;
};

type AuthFile = Record<string, unknown> & {
  auth_mode?: unknown;
  tokens?: Record<string, unknown>;
};

export const defaultAuthFile = (): string => path.join(homedir(), ".codex", "auth.json");

function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function accountIdOf(accessToken: string, fallback: unknown): string | undefined {
  const claim = jwtPayload(accessToken)?.["https://api.openai.com/auth"];
  const fromJwt = claim !== null && typeof claim === "object" ? str((claim as Record<string, unknown>).chatgpt_account_id) : undefined;
  return fromJwt ?? str(fallback);
}

/** Reads the Codex CLI's ChatGPT login, refreshing (and writing back) the access token when it is about to expire. */
export function createCodexAuth(deps: CodexAuthDeps = {}): CodexAuth {
  const file = deps.filePath ?? defaultAuthFile();
  const fs: CodexAuthFs = deps.fs ?? { readFile, writeFile, rename };
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  async function load(): Promise<{ doc: AuthFile; tokens: Record<string, unknown> }> {
    let doc: AuthFile;
    try {
      doc = JSON.parse(await fs.readFile(file, "utf8")) as AuthFile;
    } catch {
      throw new CodexAuthError(`Cannot read the Codex auth file ${file}; run \`codex login\``);
    }
    const tokens = doc?.tokens;
    if (doc?.auth_mode !== "chatgpt" || tokens === null || typeof tokens !== "object" || !str(tokens.access_token) || !str(tokens.refresh_token)) {
      throw new CodexAuthError(`Codex auth file ${file} is not a ChatGPT login (auth_mode "chatgpt" with tokens); run \`codex login\``);
    }
    return { doc, tokens };
  }

  async function refresh(doc: AuthFile, tokens: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await doFetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: tokens.refresh_token as string,
        }).toString(),
      });
    } catch {
      throw new CodexAuthError("Codex token refresh failed (network error); check the connection");
    }
    if (!res.ok) throw new CodexAuthError(`Codex token refresh failed (${res.status}); run \`codex login\` again`);
    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new CodexAuthError("Codex token refresh failed (invalid response); run `codex login` again");
    }
    const access = str(body?.access_token);
    if (!access) throw new CodexAuthError("Codex token refresh failed (no access token); run `codex login` again");

    const next: AuthFile = {
      ...doc,
      tokens: {
        ...tokens,
        access_token: access,
        ...(str(body.refresh_token) ? { refresh_token: body.refresh_token } : {}),
        ...(str(body.id_token) ? { id_token: body.id_token } : {}),
      },
      last_refresh: now().toISOString(),
    };
    // Refresh tokens rotate: the new one must land in the file the Codex CLI reads, atomically.
    const tmp = path.join(path.dirname(file), `.auth.json.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tmp, file);
    } catch {
      throw new CodexAuthError(`Could not write the refreshed Codex tokens to ${file}`);
    }
    return next.tokens as Record<string, unknown>;
  }

  let inflight: Promise<CodexCredentials> | undefined;

  async function resolve(): Promise<CodexCredentials> {
    const { doc, tokens } = await load();
    let current = tokens;
    const exp = jwtPayload(tokens.access_token as string)?.exp;
    const expired = typeof exp !== "number" || now().getTime() / 1000 + REFRESH_MARGIN_S >= exp;
    if (expired) current = await refresh(doc, tokens);
    const accessToken = current.access_token as string;
    return { accessToken, accountId: accountIdOf(accessToken, current.account_id) };
  }

  return {
    getCredentials() {
      // Concurrent callers share one refresh; two would race on the rotating refresh token.
      inflight ??= resolve().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}
