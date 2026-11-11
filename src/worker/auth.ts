const encoder = new TextEncoder();

/**
 * Constant-time string comparison over the longer length (Worker-safe, no node:crypto).
 * Length differences are folded into the result instead of returning early.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
