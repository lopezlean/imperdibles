import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SENSITIVE_KEY = /token|secret|email|phone|nickname|first_name|last_name|address|identification/i;
const KEPT_HEADER = /^(content-type|retry-after|x-ratelimit.*|ratelimit.*)$/i;

type IndexEntry = { file: string; status: number; headers: Record<string, string> };
type Index = Record<string, IndexEntry>;

/** Drops personal and secret-looking keys at any depth. */
export function sanitizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!SENSITIVE_KEY.test(key)) out[key] = sanitizeJson(inner);
    }
    return out;
  }
  return value;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function loadIndex(dir: string): Index {
  const path = join(dir, "index.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Index) : {};
}

function keptHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (KEPT_HEADER.test(name)) out[name.toLowerCase()] = value;
  });
  return out;
}

/**
 * Wraps `inner`, writing each response to `<dir>/<sha1(url)>.{json|html}` and a `<dir>/index.json`.
 * The request (including Authorization) is never stored; the caller still gets the live response.
 */
export function createRecordingFetch(inner: typeof fetch, dir: string): typeof fetch {
  mkdirSync(dir, { recursive: true });
  const index = loadIndex(dir);
  return async (input, init) => {
    const url = urlOf(input);
    const res = await inner(input, init);
    const copy = res.clone();
    const type = copy.headers.get("content-type") ?? "";
    const isJson = type.includes("json");
    const text = await copy.text();
    const file = `${createHash("sha1").update(url).digest("hex")}.${isJson ? "json" : "html"}`;
    let body = text;
    if (isJson) {
      try {
        body = `${JSON.stringify(sanitizeJson(JSON.parse(text)), null, 2)}\n`;
      } catch {
        body = text;
      }
    }
    writeFileSync(join(dir, file), body);
    index[url] = { file, status: res.status, headers: keptHeaders(res.headers) };
    writeFileSync(join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    return res;
  };
}

/** Serves recorded responses by exact URL; any other URL throws. */
export function createReplayFetch(dir: string): typeof fetch {
  const index = loadIndex(dir);
  return async (input) => {
    const url = urlOf(input);
    const entry = index[url];
    if (!entry) throw new Error(`unrecorded URL: ${url}`);
    const body = readFileSync(join(dir, entry.file), "utf8");
    return new Response(body, { status: entry.status, headers: entry.headers });
  };
}
