import type { Candidate } from "../../contract/candidate-list.js";
import { CARD_FOOTER, DIFFERENCE, PCT_BADGE, PHOTO_PLACEHOLDER, storeName } from "../copy.js";
import { TOKENS } from "../design-tokens.js";
import { formatArs, formatDateShort, formatPct, truncate } from "../format.js";

/** Satori-compatible element tree (no React): `type` is an HTML tag, `props` mirror JSX props. */
export type CardNode = {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: CardNode | CardNode[] | string;
    [k: string]: unknown;
  };
};

const MAX_RIVALS = 3;
const TITLE_MAX = 60;
const WIDTH = 1200;
const HEIGHT = 675;
const PADDING_X = 64;
const PHOTO = 260;
const MIDDLE_GAP = 48;
/** Width left for the text column: card width minus horizontal padding, photo and gap. */
const COLUMN_WIDTH = WIDTH - 2 * PADDING_X - PHOTO - MIDDLE_GAP;

const flex = (style: Record<string, string | number>): Record<string, string | number> => ({ display: "flex", ...style });

const node = (type: string, style: Record<string, string | number>, children?: CardNode["props"]["children"], extra: Record<string, unknown> = {}): CardNode => ({
  type,
  props: { ...extra, style, ...(children === undefined ? {} : { children }) },
});

/** Bar width as a percentage of the highest price shown, one decimal. */
export function barWidthPct(price: number, max: number): number {
  return Math.round((price / max) * 1000) / 10;
}

function priceRow(opts: {
  role: string;
  label: string;
  labelStyle: Record<string, string | number>;
  price: number;
  priceRole: string;
  priceStyle: Record<string, string | number>;
  max: number;
  barColor: string;
}): CardNode {
  return node(
    "div",
    flex({ flexDirection: "column", width: COLUMN_WIDTH, gap: 6 }),
    [
      node("div", flex({ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }), [
        node("div", labelStyleOf(opts.labelStyle), opts.label, { "data-role": `${opts.role}-name` }),
        node("div", { display: "flex", fontFamily: "Space Grotesk", ...opts.priceStyle }, formatArs(opts.price), {
          "data-role": opts.priceRole,
        }),
      ]),
      node("div", { display: "flex", height: 18, width: `${barWidthPct(opts.price, opts.max)}%`, borderRadius: 999, background: opts.barColor }, undefined, {
        "data-role": "bar",
      }),
    ],
    { "data-role": opts.role },
  );
}

const labelStyleOf = (s: Record<string, string | number>): Record<string, string | number> => ({ display: "flex", fontFamily: "Inter", ...s });

export function buildCardTree(c: Candidate, opts: { run_date: string }): CardNode {
  const rivals = [...c.others].sort((a, b) => a.price_ars - b.price_ars).slice(0, MAX_RIVALS);
  const max = Math.max(c.ml.price_ars, ...rivals.map((r) => r.price_ars));
  const compact = rivals.length >= 2;

  const header = node("div", flex({ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }), [
    node(
      "div",
      flex({ flexDirection: "row", fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em", color: TOKENS.ink }),
      [node("span", { display: "flex" }, "imperdibles"), node("span", { display: "flex", color: TOKENS.accent }, ".com.ar")],
      { "data-role": "logo" },
    ),
    node(
      "div",
      flex({
        fontFamily: "Space Grotesk",
        fontWeight: 700,
        fontSize: 30,
        letterSpacing: "-0.01em",
        color: TOKENS.surface,
        background: TOKENS.accent,
        padding: "10px 22px",
        borderRadius: 999,
      }),
      PCT_BADGE(formatPct(c)),
      { "data-role": "badge" },
    ),
  ]);

  const photo = node(
    "div",
    flex({
      width: PHOTO,
      height: PHOTO,
      borderRadius: 20,
      background: TOKENS.photoCard,
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "Inter",
      fontSize: 18,
      color: TOKENS.muted,
    }),
    PHOTO_PLACEHOLDER,
    { "data-role": "photo" },
  );

  const prices = node(
    "div",
    flex({ flexDirection: "column", gap: compact ? 10 : 14 }),
    [
      priceRow({
        role: "ml",
        label: storeName("ml"),
        labelStyle: { fontSize: 22, fontWeight: 600, color: TOKENS.ink },
        price: c.ml.price_ars,
        priceRole: "ml-price",
        priceStyle: { fontSize: 44, fontWeight: 700, color: TOKENS.ink },
        max,
        barColor: TOKENS.ink,
      }),
      ...rivals.map((r) =>
        priceRow({
          role: "rival",
          label: storeName(r.store),
          labelStyle: { fontSize: 22, fontWeight: 400, color: TOKENS.ink2 },
          price: r.price_ars,
          priceRole: "rival-price",
          priceStyle: { fontSize: compact ? 26 : 30, fontWeight: 500, color: TOKENS.ink2 },
          max,
          barColor: TOKENS.rivalBar,
        }),
      ),
    ],
    { "data-role": "prices" },
  );

  const middle = node("div", flex({ flexDirection: "row", alignItems: "center", gap: MIDDLE_GAP }), [
    photo,
    node("div", flex({ flexDirection: "column", gap: 28, width: COLUMN_WIDTH }), [
      node(
        "div",
        flex({ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: compact ? 40 : 46, lineHeight: 1.1, letterSpacing: "-0.02em", color: TOKENS.ink }),
        truncate(c.title, TITLE_MAX),
        { "data-role": "title" },
      ),
      prices,
    ]),
  ]);

  const footer = node("div", flex({ flexDirection: "row", justifyContent: "space-between", fontFamily: "Inter", fontSize: 20, color: TOKENS.ink2 }), [
    node("div", { display: "flex" }, CARD_FOOTER(formatDateShort(opts.run_date))),
    node("div", { display: "flex", fontWeight: 600, color: TOKENS.ink }, `${DIFFERENCE}: ${formatArs(c.difference_ars)}`),
  ]);

  return node(
    "div",
    flex({
      flexDirection: "column",
      justifyContent: "space-between",
      boxSizing: "border-box",
      width: WIDTH,
      height: HEIGHT,
      padding: `56px ${PADDING_X}px`,
      background: TOKENS.bg,
      fontFamily: "Inter",
    }),
    [header, middle, footer],
  );
}
