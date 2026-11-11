const VARIANT_WORDS = ["PRO", "PLUS", "MAX", "ULTRA", "LITE", "MINI", "SE", "OMNI", "NEO", "TURBO", "EVO", "AI"] as const;
const VARIANT_SET: ReadonlySet<string> = new Set(VARIANT_WORDS);

const UNIT_TOKEN =
  /^\d+(?:[.,]\d+)?(?:PA|MAH|AH|WH|W|KW|V|L|LTS|ML|KG|G|CM|MM|M|MTS|HZ|GB|TB|MP|RPM|PULGADAS)$/;

const ACCESSORY_WORDS: ReadonlySet<string> = new Set([
  "REPUESTO", "REPUESTOS", "KIT", "KITS", "FILTRO", "FILTROS", "CEPILLO", "CEPILLOS",
  "BOLSA", "BOLSAS", "BATERIA", "BATERIAS", "PACK", "COMBO", "X2", "X3",
  "ESTACION", "DOCK", "ACCESORIO", "ACCESORIOS", "MOPA", "MOPAS", "PANO", "PANOS",
  "RODILLO", "RODILLOS", "CARGADOR", "COMPATIBLE",
]);

// Words that make a complete unit a bundle when introduced by "con", "y" or "+".
const BUNDLE_WORDS: ReadonlySet<string> = new Set(["BASE", "ESTACION", "DOCK"]);
const BUNDLE_LINKS: ReadonlySet<string> = new Set(["CON", "Y", "+"]);

const CONDITION_WORDS: ReadonlySet<string> = new Set([
  "REACONDICIONADO", "REACONDICIONADA", "REACONDICIONADOS", "REACONDICIONADAS",
  "USADO", "USADA", "USADOS", "USADAS", "EXHIBICION", "OUTLET",
]);

// Colour words that may follow a model code without changing the product.
const HARMLESS_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  "NEGRO", "NEGRA", "BLANCO", "BLANCA", "GRIS", "AZUL", "ROJO", "ROJA", "VERDE", "ROSA",
  "PLATA", "PLATEADO", "PLATEADA", "DORADO", "DORADA", "BEIGE",
]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeBrand(s: string): string {
  return stripAccents(s).toUpperCase().trim();
}

function normalizeTitle(title: string): string {
  return normalizeBrand(title).replace(/(?<=[A-Z0-9])-(?=[A-Z0-9])/g, "");
}

function rawTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(/[\s,;:()/]+/)
    .map((t) => t.replace(/^[^A-Z0-9+]+|[^A-Z0-9+]+$/g, ""))
    .filter((t) => t.length > 0);
}

export function normalizeWords(title: string): string[] {
  return normalizeTitle(title).split(/[^A-Z0-9]+/).filter((t) => t.length > 0);
}

const hasLetterAndDigit = (t: string) => /[A-Z]/.test(t) && /\d/.test(t);

type Parsed = { code: string | null; variants: string[] };

// One token -> optional model code plus the variants it carries (trailing "+" and trailing variant word).
function parseToken(raw: string): Parsed {
  const variants: string[] = [];
  let t = raw;
  while (t.endsWith("+")) {
    t = t.slice(0, -1);
    if (!variants.includes("PLUS")) variants.push("PLUS");
  }
  if (t === "") return { code: null, variants };
  if (VARIANT_SET.has(t)) return { code: null, variants: [...variants, t] };
  if (UNIT_TOKEN.test(t)) return { code: null, variants };
  for (const v of VARIANT_WORDS) {
    if (t.endsWith(v)) {
      const head = t.slice(0, -v.length);
      if (head !== "" && /\d$/.test(head) && hasLetterAndDigit(head)) {
        return { code: head, variants: [...variants, v] };
      }
    }
  }
  return { code: hasLetterAndDigit(t) ? t : null, variants };
}

export function extractModelCodes(title: string): string[] {
  const codes: string[] = [];
  for (const raw of rawTokens(title)) {
    const { code } = parseToken(raw);
    if (code !== null && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * The model code as the store wrote it, original punctuation and case included ("SL-RVCL050" for the
 * normalized "SLRVCL050"). Null when no token of the title normalizes to exactly that code.
 */
export function writtenModelCode(title: string, code: string): string | null {
  for (const token of title.split(/[\s,;:()/]+/)) {
    const written = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (written !== "" && normalizeTitle(written) === code) return written;
  }
  return null;
}

export function extractVariants(title: string): string[] {
  const found = new Set<string>();
  for (const raw of rawTokens(title)) {
    for (const v of parseToken(raw).variants) found.add(v);
  }
  return [...found].sort();
}

// Like normalizeWords but keeps "+" as its own word.
function wordsWithPlus(title: string): string[] {
  return normalizeTitle(title).replace(/\+/g, " + ").split(/[^A-Z0-9+]+/).filter((t) => t.length > 0);
}

const isBundleAt = (words: string[], i: number) =>
  BUNDLE_WORDS.has(words[i]!) && i > 0 && BUNDLE_LINKS.has(words[i - 1]!);

export function hasAccessoryWords(title: string): boolean {
  const words = wordsWithPlus(title);
  if (words.length === 0) return false;
  if (words[0] === "BASE") return true;
  return words.some((w, i) => ACCESSORY_WORDS.has(w) && !isBundleAt(words, i));
}

// "con base", "y estacion", "+ dock": the title sells the unit together with the extra.
export function hasBundleWords(title: string): boolean {
  const words = wordsWithPlus(title);
  return words.some((_, i) => isBundleAt(words, i));
}

export function hasConditionWords(title: string): boolean {
  const words = wordsWithPlus(title);
  return words.some((w, i) => CONDITION_WORDS.has(w) || (w === "OPEN" && words[i + 1] === "BOX"));
}

// Alphabetic words glued to a model code (no punctuation between), e.g. "T30 OMNI" -> ["OMNI"].
// Known variants and colours are excluded: variants are compared separately.
export function extractCodeSuffixWords(title: string): string[] {
  const tokens = normalizeTitle(title).split(/\s+/).filter((t) => t.length > 0);
  const out = new Set<string>();
  tokens.forEach((tok, i) => {
    if (/[,;:.()]$/.test(tok)) return;
    const core = tok.replace(/^[^A-Z0-9+]+|[^A-Z0-9+]+$/g, "");
    if (core === "" || parseToken(core).code === null) return;
    const next = tokens[i + 1];
    if (next === undefined) return;
    const word = next.replace(/^[^A-Z0-9+]+|[^A-Z0-9+]+$/g, "");
    if (/^[A-Z]+$/.test(word) && !VARIANT_SET.has(word) && !HARMLESS_SUFFIX_WORDS.has(word)) out.add(word);
  });
  return [...out].sort();
}
