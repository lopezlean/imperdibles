// Argentina (America/Argentina/Buenos_Aires) is a fixed UTC-3 with no DST.
// Never depend on process.env.TZ or the machine's zone.
const ART_OFFSET_MS = -3 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function shifted(now: Date): Date {
  return new Date(now.getTime() + ART_OFFSET_MS);
}

/** Calendar date in ART, `YYYY-MM-DD`. */
export function artDate(now: Date): string {
  return shifted(now).toISOString().slice(0, 10);
}

/** Wall-clock time in ART, `HH:MM`. */
export function artTime(now: Date): string {
  return shifted(now).toISOString().slice(11, 16);
}

/** ISO 8601 timestamp in ART with the `-03:00` offset, seconds precision. */
export function artIso(now: Date): string {
  return `${shifted(now).toISOString().slice(0, 19)}-03:00`;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}
