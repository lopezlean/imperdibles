import type { SqlClient } from "../../shared/db/sql-client.js";
import type { LocalEnv } from "../../shared/env.js";

export class MlAuthError extends Error {
  constructor(public reason: "not_authorized" | "refresh_failed") {
    super(`Mercado Libre authorization error: ${reason}`);
  }
}

type AuthDeps = { db: SqlClient; fetch: typeof fetch; env: LocalEnv; now: () => Date };

export interface TokenProvider {
  get(): Promise<string>;
  forceRefresh(): Promise<string>;
}

const AUTH_URL = "https://auth.mercadolibre.com.ar/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_MARGIN_MS = 30 * 60_000;

type StoredTokens = { access_token: string; refresh_token: string; expira_en: string };

export function authorizationUrl(env: Pick<LocalEnv, "mlAppId" | "mlRedirectUri">): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: env.mlAppId,
    redirect_uri: env.mlRedirectUri,
  });
  return `${AUTH_URL}?${query.toString()}`;
}

/** POSTs to the token endpoint and stores the new pair in a single upsert. Never logs values. */
async function requestAndStore(deps: AuthDeps, params: Record<string, string>, fallbackRefresh: string | null) {
  let res: Response;
  try {
    res = await deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: deps.env.mlAppId,
        client_secret: deps.env.mlClientSecret,
        ...params,
      }).toString(),
    });
  } catch {
    throw new MlAuthError("refresh_failed");
  }
  if (!res.ok) throw new MlAuthError("refresh_failed");
  let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new MlAuthError("refresh_failed");
  }
  const refresh = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : fallbackRefresh;
  if (typeof body.access_token !== "string" || !body.access_token || typeof body.expires_in !== "number" || !refresh) {
    throw new MlAuthError("refresh_failed");
  }
  const expiraEn = new Date(deps.now().getTime() + body.expires_in * 1000).toISOString();
  await deps.db.run(
    `INSERT INTO tokens_ml (id, access_token, refresh_token, expira_en) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, expira_en = excluded.expira_en`,
    [body.access_token, refresh, expiraEn],
  );
  return body.access_token;
}

export async function exchangeCode(deps: AuthDeps, code: string): Promise<void> {
  await requestAndStore(
    deps,
    { grant_type: "authorization_code", code, redirect_uri: deps.env.mlRedirectUri },
    null,
  );
}

export function createTokenProvider(deps: AuthDeps): TokenProvider {
  async function load(): Promise<StoredTokens> {
    const [row] = await deps.db.all<StoredTokens>(
      "SELECT access_token, refresh_token, expira_en FROM tokens_ml WHERE id = 1",
    );
    if (!row) throw new MlAuthError("not_authorized");
    return row;
  }
  const refresh = (stored: StoredTokens) =>
    requestAndStore(deps, { grant_type: "refresh_token", refresh_token: stored.refresh_token }, stored.refresh_token);

  return {
    async get() {
      const stored = await load();
      const remaining = new Date(stored.expira_en).getTime() - deps.now().getTime();
      return remaining > REFRESH_MARGIN_MS ? stored.access_token : refresh(stored);
    },
    async forceRefresh() {
      return refresh(await load());
    },
  };
}
