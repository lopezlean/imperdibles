import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ImportRef = { specifier: string; typeOnly: boolean };

const IMPORT_RE = /^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;

/** Every static import/export-from of a file; `import type` and `export type` are flagged typeOnly. */
export function importsOf(file: string): ImportRef[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(IMPORT_RE)].map((m) => ({ specifier: m[2] as string, typeOnly: m[1] !== undefined }));
}

function resolveRelative(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const candidates = [base.replace(/\.js$/, ".ts"), `${base}.ts`, resolve(base, "index.ts")];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`cannot resolve ${specifier} from ${from}`);
  return found;
}

/** Files reached (with runtimeOnly, only through imports that survive compilation) from the entry through relative imports (absolute paths) plus every bare specifier imported. */
export function importClosure(entry: string, opts: { runtimeOnly?: boolean } = {}): string[] {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const { specifier, typeOnly } of importsOf(file)) {
      if (opts.runtimeOnly && typeOnly) continue; // erased at build time, never shipped
      if (specifier.startsWith(".")) visit(resolveRelative(file, specifier));
      else bare.add(specifier);
    }
  };
  visit(resolve(entry));
  return [...files, ...bare];
}
