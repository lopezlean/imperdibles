/** Returns the URL when it is an https catalog image served from *.mlstatic.com, else null. Worker-safe. */
export function catalogPhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (!u.hostname.endsWith(".mlstatic.com")) return null;
  return url;
}
