import { describe, expect, it } from "vitest";
import {
  CARD_FOOTER,
  CHANNEL_CTA,
  CHANNEL_HEADING,
  CHANNEL_LEAD,
  COMPARED_CHIP,
  CTA_ML,
  DIFFERENCE,
  EMPTY_PAGE,
  HERO_LEAD,
  HOW_HEADING,
  HOW_STEPS,
  IN_ML,
  NAV,
  PAGE_TITLE_HERO,
  PCT_BADGE,
  PHOTO_PLACEHOLDER,
  PHOTO_PLACEHOLDER_LABEL,
  PRICES_NOTE,
  PUBLISHED_CHIP,
  TODAY_HEADING,
} from "../../src/output/copy.js";
import { TOKENS } from "../../src/output/design-tokens.js";

// Values copied from the confirmed design (docs/design/*.dc.html, Design reference appendix).
const EXPECTED_TOKENS = {
  accent: "#C2410C",
  ink: "#0E1116",
  ink2: "#3A4350",
  muted: "#5B6472",
  line: "#DDE1E7",
  bg: "#F4F5F7",
  surface: "#FFFFFF",
  photoPage: "#EEF0F3",
  photoCard: "#E3E6EB",
  rivalBar: "#B4BBC6",
  onDark2: "#C9CED6",
} as const;

describe("TOKENS", () => {
  it("matches the confirmed design values exactly", () => {
    expect(TOKENS).toEqual(EXPECTED_TOKENS);
  });

  it("every value is an uppercase six-digit hex color", () => {
    for (const value of Object.values(TOKENS)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("design copy", () => {
  it("fills the hero title with the threshold", () => {
    expect(PAGE_TITLE_HERO("15")).toBe("Solo publicamos cuando Mercado Libre gana por 15% o más.");
  });

  it("exports the fixed hero lead", () => {
    expect(HERO_LEAD).toBe(
      "Comparamos el mismo modelo en otras tiendas. Si la diferencia es chica, el producto no aparece.",
    );
  });

  it("pluralizes the chips", () => {
    expect(COMPARED_CHIP(3)).toBe("3 modelos comparados");
    expect(COMPARED_CHIP(1)).toBe("1 modelo comparado");
    expect(PUBLISHED_CHIP(2)).toBe("2 publicados");
    expect(PUBLISHED_CHIP(1)).toBe("1 publicado");
  });

  it("exports the section and photo strings", () => {
    expect(TODAY_HEADING).toBe("Los imperdibles de hoy");
    expect(HOW_HEADING).toBe("Cómo elegimos");
    expect(PHOTO_PLACEHOLDER).toBe("Foto del producto");
    expect(PHOTO_PLACEHOLDER_LABEL).toBe("Foto del producto pendiente");
    expect(EMPTY_PAGE).toBe("Todavía no hay imperdibles publicados.");
  });

  it("exports the card and button strings", () => {
    expect(CTA_ML).toBe("Ver en Mercado Libre");
    expect(IN_ML).toBe("en Mercado Libre");
    expect(DIFFERENCE).toBe("Diferencia");
    expect(PCT_BADGE("19,7")).toBe("19,7% menos");
    expect(CARD_FOOTER("10/11/2026")).toBe("Mismo modelo, precio de lista al 10/11/2026");
  });

  it("conjugates the price label in the note and the card footer", () => {
    expect(PRICES_NOTE("10 de noviembre de 2026", "actual")).toBe(
      "Precios actuales al 10 de noviembre de 2026, sin envío ni cuotas.",
    );
    expect(PRICES_NOTE("10 de noviembre de 2026", "lista")).toBe(
      "Precios de lista al 10 de noviembre de 2026, sin envío ni cuotas.",
    );
    expect(CARD_FOOTER("10/11/2026", "actual")).toBe("Mismo modelo, precio actual al 10/11/2026");
    expect(CARD_FOOTER("10/11/2026", "lista")).toBe("Mismo modelo, precio de lista al 10/11/2026");
  });

  it("fills the price note with the long date", () => {
    expect(PRICES_NOTE("10 de noviembre de 2026")).toBe(
      "Precios de lista al 10 de noviembre de 2026, sin envío ni cuotas.",
    );
  });

  it("builds the three how-it-works steps from the threshold", () => {
    expect(HOW_STEPS("15")).toEqual([
      {
        title: "El mismo modelo exacto",
        body: "Se compara el mismo modelo en Mercado Libre y en otras tiendas, no uno parecido.",
      },
      {
        title: "Diferencia de 15% o más",
        body: "Con una diferencia menor, el producto no se publica.",
      },
      {
        title: "Precio y fecha a la vista",
        body: "Cada comparación muestra los dos precios y el día en que se tomaron.",
      },
    ]);
  });

  it("exports the channel strings", () => {
    expect(CHANNEL_HEADING).toBe("Los imperdibles del día, en Telegram");
    expect(CHANNEL_LEAD).toBe("Un aviso por cada producto que pasa el filtro. Nada más.");
    expect(CHANNEL_CTA).toBe("Abrir el canal");
  });

  it("exports the navigation labels", () => {
    expect(NAV).toEqual({ hoy: "Hoy", como: "Cómo elegimos", canal: "Canal de Telegram" });
  });
});
