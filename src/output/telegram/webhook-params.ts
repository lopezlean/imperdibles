export type SetWebhookParams = {
  url: string;
  secret_token: string;
  allowed_updates: ["message"];
  drop_pending_updates: true;
};

/** Body for Telegram setWebhook. Pure: no I/O, no environment access. */
export function buildSetWebhookParams(baseUrl: string, secret: string): SetWebhookParams {
  const base = baseUrl.replace(/\/$/, "");
  return {
    url: `${base}/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  };
}
