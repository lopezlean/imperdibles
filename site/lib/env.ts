export type SiteEnv = { siteUrl: string; channelUrl: string };

/** Thrown with variable names only, never values. */
export class SiteEnvError extends Error {}

export function readSiteEnv(env: Record<string, string | undefined>): SiteEnv {
  const missing = ["SITE_URL", "TELEGRAM_CHANNEL_URL"].filter((name) => !env[name]);
  if (missing.length > 0) throw new SiteEnvError(`Missing environment variables: ${missing.join(", ")}`);

  const siteUrl = env.SITE_URL as string;
  if (!/^https?:\/\//.test(siteUrl)) throw new SiteEnvError("SITE_URL must start with http:// or https://");

  return { siteUrl: siteUrl.replace(/\/+$/, ""), channelUrl: env.TELEGRAM_CHANNEL_URL as string };
}
