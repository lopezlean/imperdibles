import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCandidateList } from "../../../src/contract/candidate-list.js";
import { AFFILIATE_LEGEND, NOT_AFFILIATED } from "../../../src/output/copy.js";
import { escapeHtml } from "../../../src/output/html.js";
import { renderHomePage, type PageInput } from "../../../src/output/page/render.js";

const CHANNEL = "https://t.me/imperdibles_ar?x=1&y=2";
const ars = (n: number) => `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

function inputFrom(file: string, mode: "today" | "archive"): PageInput {
  const list = parseCandidateList(
    JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "lista-candidatos", file), "utf8")),
  );
  return {
    mode,
    run_date: list.run_date,
    categoryName: "Aspiradoras robot",
    threshold_pct: list.threshold_pct,
    models_compared: list.models_compared,
    items: list.candidates.map((candidate, i) => ({
      candidate,
      affiliate_link: i === 0 ? "https://meli.la/AbC_1?x=1&y=2" : `https://meli.la/Link${i}`,
    })),
    channelUrl: CHANNEL,
  };
}

const none: PageInput = {
  mode: "none",
  run_date: null,
  categoryName: null,
  threshold_pct: 15,
  models_compared: 0,
  items: [],
  channelUrl: CHANNEL,
};

const noPhoto = (i: PageInput): PageInput => ({
  ...i,
  items: i.items.map((it) => ({ ...it, candidate: { ...it.candidate, image_url: null } })),
});
const withPhoto = (i: PageInput, image_url: string | null, title?: string): PageInput => ({
  ...i,
  items: i.items.map((it) => ({ ...it, candidate: { ...it.candidate, image_url, ...(title ? { title } : {}) } })),
});

describe("catalog photo", () => {
  const base = inputFrom("valid-2026-11-10.json", "today");

  it("renders the mlstatic photo with escaped alt, lazy loading and a fixed box", () => {
    const h = renderHomePage(withPhoto(base, "https://http2.mlstatic.com/D_NQ_NP_1-O.webp?a=1&b=2", 'Robot "X" <b>'));
    expect(h).toContain('<img src="https://http2.mlstatic.com/D_NQ_NP_1-O.webp?a=1&amp;b=2"');
    expect(h).toContain('alt="Robot &quot;X&quot; &lt;b&gt;"');
    expect(h).toContain('loading="lazy"');
    expect(h).toContain('width="264" height="240"');
    expect(h).not.toContain("Ilustración");
  });

  it.each([null, "http://http2.mlstatic.com/a.jpg", "https://evil.com/a.jpg", "javascript:alert(1)"])(
    "falls back to the illustration for %s",
    (u) => {
      const h = renderHomePage(withPhoto(base, u));
      expect(h).toContain('aria-label="Ilustración del producto"');
      expect(h).not.toContain("<img ");
    },
  );
});

describe("category illustration", () => {
  it("inlines the robot vacuum svg with its Spanish label and no placeholder text", () => {
    const h = renderHomePage({ ...noPhoto(inputFrom("valid-2026-11-10.json", "today")), categoryId: "aspiradoras-robot" });
    expect(h).toContain('aria-label="Ilustración de aspiradora robot"');
    expect(h).toContain("<svg ");
    expect(h).not.toContain("Foto del producto");
  });

  it("falls back to the generic label without a category", () => {
    const h = renderHomePage(noPhoto(inputFrom("valid-2026-11-10.json", "today")));
    expect(h).toContain('aria-label="Ilustración del producto"');
    expect(h).toContain("<svg ");
  });
});

describe("escapeHtml", () => {
  it("escapes & < > \" and '", () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });
});

describe("renderHomePage", () => {
  const i = inputFrom("valid-2026-11-10.json", "today");
  const html = renderHomePage(i);

  it("matches the snapshot (not the check)", () => {
    expect(html).toMatchSnapshot();
  });

  it("renders the document shell", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<title>imperdibles.com.ar</title>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("fonts.googleapis.com/css2?family=Inter");
    expect(html).toContain("#FF633D");
    expect(html).not.toContain("{{accent}}");
    expect(html).not.toContain("x-dc");
  });

  it("renders hero, chips and headings", () => {
    expect(html).toContain("Solo publicamos cuando Mercado Libre gana por 15% o más.");
    expect(html).toContain("Diferencia de 15% o más");
    expect(html).toContain("Los imperdibles de hoy");
    expect(html).toContain("10.11.2026 / Aspiradoras robot");
    expect(html).toContain("9 modelos comparados");
    expect(html).toContain("4 publicados");
    expect(html).toContain("Precios actuales al 10 de noviembre de 2026, sin envío ni cuotas.");
    for (const id of ["hoy", "como", "canal"]) expect(html).toContain(`id="${id}"`);
  });

  it("renders legends and affiliate links", () => {
    expect(html).toContain(AFFILIATE_LEGEND);
    expect(html).toContain(NOT_AFFILIATED);
    expect(html.match(/rel="sponsored noopener"/g)).toHaveLength(4);
    expect(html).toContain('href="https://meli.la/AbC_1?x=1&amp;y=2"');
  });

  it("links the logo home, the nav pill to #canal and only the button to the channel", () => {
    expect(html).toContain('<a href="/"');
    expect(html).toMatch(/<a href="#canal"[^>]*>Canal de Telegram<\/a>/);
    expect(html.match(/href="https:\/\/t\.me\/imperdibles_ar\?x=1&amp;y=2"/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="https:\/\/t\.me\/imperdibles_ar\?x=1&amp;y=2"[^>]*>[\s\S]*?Abrir el canal<\/a>/);
  });

  it("formats the threshold", () => {
    expect(renderHomePage({ ...i, threshold_pct: 12.5 })).toContain("gana por 12,5% o más");
  });

  it("renders archive mode with the given date", () => {
    const a = renderHomePage({ ...i, mode: "archive", run_date: "2026-11-09" });
    expect(a).toContain("Los imperdibles del 9 de noviembre de 2026");
    expect(a).toContain("09.11.2026 / Aspiradoras robot");
    expect(a).toContain("Precios actuales al 9 de noviembre de 2026");
  });

  it("omits the category and separator when the name is null", () => {
    const h = renderHomePage({ ...i, categoryName: null });
    expect(h).toContain(">10.11.2026</p>");
    expect(h).not.toContain("10.11.2026 / ");
  });

  it("renders the empty page without eyebrow or chips", () => {
    const h = renderHomePage(none);
    expect(h).toContain("Todavía no hay imperdibles publicados.");
    expect(h).not.toContain("modelos comparados");
    expect(h).not.toContain("publicados</span>");
    expect(h).not.toContain(`class="meta`);
    expect(h).toContain("El mismo filtro. También cuando no hay nada para recomendar.");
    expect(h).not.toContain("sponsored");
    for (const id of ["hoy", "como", "canal"]) expect(h).toContain(`id="${id}"`);
    expect(h).toContain(AFFILIATE_LEGEND);
  });

  it("uses singular chips", () => {
    const one = inputFrom("valid-three-rivals.json", "today");
    const h = renderHomePage({ ...one, models_compared: 1 });
    expect(h).toContain("1 modelo comparado");
    expect(h).toContain("1 publicado");
  });

  it("escapes titles, names and links", () => {
    const base = inputFrom("valid-2026-11-10.json", "today");
    const first = base.items[0]!;
    const evil = renderHomePage({
      ...base,
      categoryName: "A&B <x>",
      items: [
        {
          candidate: { ...first.candidate, title: 'Robot "S8+" <Negro> & base' },
          affiliate_link: 'https://meli.la/a"b',
        },
      ],
    });
    expect(evil).toContain("Robot &quot;S8+&quot; &lt;Negro&gt; &amp; base");
    expect(evil).not.toContain("<Negro>");
    expect(evil).toContain("A&amp;B &lt;x&gt;");
    expect(evil).toContain('href="https://meli.la/a&quot;b"');
  });

  it("renders every rival ascending, then the difference, for 1 and 3 rivals", () => {
    const one = renderHomePage(i);
    const oneArticle = one.slice(one.indexOf("<article"), one.indexOf("</article>"));
    expect(oneArticle).toContain("Frávega");
    expect(oneArticle).toContain("Diferencia: $");

    const three = inputFrom("valid-three-rivals.json", "today");
    const c = three.items[0]!.candidate;
    expect(c.others).toHaveLength(3);
    const h = renderHomePage(three);
    const article = h.slice(h.indexOf("<article"), h.indexOf("</article>"));
    let last = -1;
    for (const o of c.others) {
      const at = article.indexOf(`<span class="p-rival">${ars(o.price_ars)}</span>`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(article).toContain(`Diferencia: ${ars(c.difference_ars)}`);
  });

  it("draws every bar on one scale: the dearest price is 100%", () => {
    const h = renderHomePage(i);
    const article = h.slice(h.indexOf("<article"), h.indexOf("</article>"));
    const c = i.items[0]!.candidate;
    const max = Math.max(c.ml.price_ars, ...c.others.map((o) => o.price_ars));
    const widths = [...article.matchAll(/<i style="width: ([\d.]+)%">/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(1 + c.others.length);
    expect(widths[0]).toBeCloseTo((c.ml.price_ars / max) * 100, 1);
    expect(Math.max(...widths)).toBe(100);
  });

  it("swaps the palette for dark mode and keeps motion off on request", () => {
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("prefers-reduced-motion:reduce");
  });
});
