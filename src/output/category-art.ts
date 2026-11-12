import { TOKENS as T } from "./design-tokens.js";

/**
 * Original vector illustrations, one per product category. Drawn by us: catalog photos are never used.
 * Self-contained (no refs, scripts or text), transparent background, token colours only.
 */
const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">';

const ROBOT_VACUUM = `${open}<ellipse cx="60" cy="102" rx="42" ry="7" fill="${T.muted}" fill-opacity=".25"/><ellipse cx="60" cy="66" rx="46" ry="38" fill="${T.ink}"/><ellipse cx="60" cy="60" rx="46" ry="38" fill="${T.ink2}"/><path d="M18 50Q60 8 102 50" stroke="${T.muted}" stroke-width="5" stroke-linecap="round"/><ellipse cx="60" cy="62" rx="30" ry="23" fill="${T.ink}"/><circle cx="60" cy="62" r="11" stroke="${T.muted}" stroke-width="3"/><circle cx="60" cy="62" r="5" fill="${T.accent}"/><path d="M28 44L12 36M28 44L9 46M28 44L16 57" stroke="${T.muted}" stroke-width="3" stroke-linecap="round"/><circle cx="28" cy="44" r="3.5" fill="${T.muted}"/></svg>`;

const PACKAGE_BOX = `${open}<ellipse cx="60" cy="108" rx="38" ry="6" fill="${T.muted}" fill-opacity=".25"/><path d="M60 16L100 36L60 56L20 36Z" fill="${T.muted}"/><path d="M20 36L60 56V102L20 82Z" fill="${T.ink2}"/><path d="M100 36L60 56V102L100 82Z" fill="${T.ink}"/><path d="M40 26L80 46L70 51L30 31Z" fill="${T.accent}"/></svg>`;

const ART: Record<string, { svg: string; label: string }> = {
  "aspiradoras-robot": { svg: ROBOT_VACUUM, label: "Ilustración de aspiradora robot" },
};
const GENERIC = { svg: PACKAGE_BOX, label: "Ilustración del producto" };

const artOf = (categoryId: string | null): { svg: string; label: string } => (categoryId !== null ? ART[categoryId] : undefined) ?? GENERIC;

export function categoryArtSvg(categoryId: string | null): string {
  return artOf(categoryId).svg;
}

/** Spanish accessible label for the illustration of a category. */
export function categoryArtLabel(categoryId: string | null): string {
  return artOf(categoryId).label;
}
