const VARIANT_WORDS = ["PRO", "PLUS", "MAX", "ULTRA", "LITE", "MINI", "SE"] as const;
const VARIANT_SET: ReadonlySet<string> = new Set(VARIANT_WORDS);

const UNIT_TOKEN =
  /^\d+(?:[.,]\d+)?(?:PA|MAH|AH|WH|W|KW|V|L|LTS|ML|KG|G|CM|MM|M|MTS|HZ|GB|TB|MP|RPM|PULGADAS)$/;

const ACCESSORY_WORDS: ReadonlySet<string> = new Set([
  "REPUESTO", "REPUESTOS", "KIT", "KITS", "FILTRO", "FILTROS", "CEPILLO", "CEPILLOS",
  "BOLSA", "BOLSAS", "BATERIA", "BATERIAS", "PACK", "COMBO", "X2", "X3",
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

export function extractVariants(title: string): string[] {
  const found = new Set<string>();
  for (const raw of rawTokens(title)) {
    for (const v of parseToken(raw).variants) found.add(v);
  }
  return [...found].sort();
}

export function hasAccessoryWords(title: string): boolean {
  const words = normalizeWords(title);
  if (words.length === 0) return false;
  if (words[0] === "BASE") return true;
  return words.some((w) => ACCESSORY_WORDS.has(w));
}
