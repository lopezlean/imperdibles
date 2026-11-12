import { catalogPhotoUrl } from "../photo-url.js";

// Node-only: used by the local card job, never by the Worker.

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const TIMEOUT_MS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Downloads the catalog photo as a base64 data URI, or null on any problem (never throws).
 * Satori only decodes PNG/JPEG, so a .webp URL is swapped for its .jpg variant.
 */
export async function fetchCardPhoto(imageUrl: string | null, fetchFn: FetchLike = fetch): Promise<string | null> {
  const safe = catalogPhotoUrl(imageUrl);
  if (!safe) return null;
  const url = safe.replace(/\.webp(?=$|[?#])/i, ".jpg");
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!TYPES.has(type)) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return null;
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.length === 0 || body.length > MAX_BYTES) return null;
    return `data:${type};base64,${Buffer.from(body).toString("base64")}`;
  } catch {
    return null;
  }
}
