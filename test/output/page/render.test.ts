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
    fecha: list.fecha,
    categoriaNombre: "Aspiradoras robot",
    umbral_pct: list.umbral_pct,
    modelos_comparados: list.modelos_comparados,
    items: list.candidatos.map((candidate, i) => ({
      candidate,
      enlace_afiliado: i === 0 ? "https://meli.la/AbC_1?x=1&y=2" : `https://meli.la/Link${i}`,
    })),
    channelUrl: CHANNEL,
  };
}

const none: PageInput = {
  mode: "none",
  fecha: null,
  categoriaNombre: null,
  umbral_pct: 15,
  modelos_comparados: 0,
  items: [],
  channelUrl: CHANNEL,
};

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
    expect(html).toContain("<title>imperdibles.ar</title>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("fonts.googleapis.com/css2?family=Inter");
    expect(html).toContain("#C2410C");
    expect(html).not.toContain("{{accent}}");
    expect(html).not.toContain("x-dc");
  });

  it("renders hero, chips and headings", () => {
    expect(html).toContain("Solo publicamos cuando Mercado Libre gana por 15% o más.");
    expect(html).toContain("Diferencia de 15% o más");
    expect(html).toContain("Los imperdibles de hoy");
    expect(html).toContain("Aspiradoras robot · 10 de noviembre de 2026");
    expect(html).toContain("9 modelos comparados");
    expect(html).toContain("4 publicados");
    expect(html).toContain("Precios de lista al 10 de noviembre de 2026, sin envío ni cuotas.");
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
    expect(renderHomePage({ ...i, umbral_pct: 12.5 })).toContain("gana por 12,5% o más");
  });

  it("renders archive mode with the given date", () => {
    const a = renderHomePage({ ...i, mode: "archive", fecha: "2026-11-09" });
    expect(a).toContain("Los imperdibles del 9 de noviembre de 2026");
    expect(a).toContain("Aspiradoras robot · 9 de noviembre de 2026");
    expect(a).toContain("Precios de lista al 9 de noviembre de 2026");
  });

  it("omits the category and separator when the name is null", () => {
    const h = renderHomePage({ ...i, categoriaNombre: null });
    expect(h).toContain(">10 de noviembre de 2026</p>");
    expect(h).not.toContain(" · ");
  });

  it("renders the empty page without eyebrow or chips", () => {
    const h = renderHomePage(none);
    expect(h).toContain("Todavía no hay imperdibles publicados.");
    expect(h).not.toContain("modelos comparados");
    expect(h).not.toContain("publicados</span>");
    expect(h).not.toContain("text-transform: uppercase");
    expect(h).not.toContain("sponsored");
    for (const id of ["hoy", "como", "canal"]) expect(h).toContain(`id="${id}"`);
    expect(h).toContain(AFFILIATE_LEGEND);
  });

  it("uses singular chips", () => {
    const one = inputFrom("valid-three-rivals.json", "today");
    const h = renderHomePage({ ...one, modelos_comparados: 1 });
    expect(h).toContain("1 modelo comparado");
    expect(h).toContain("1 publicado");
  });

  it("escapes titles, names and links", () => {
    const base = inputFrom("valid-2026-11-10.json", "today");
    const first = base.items[0]!;
    const evil = renderHomePage({
      ...base,
      categoriaNombre: "A&B <x>",
      items: [
        {
          candidate: { ...first.candidate, titulo: 'Robot "S8+" <Negro> & base' },
          enlace_afiliado: 'https://meli.la/a"b',
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
    expect(oneArticle.indexOf("Diferencia")).toBeGreaterThan(oneArticle.indexOf("Frávega"));

    const three = inputFrom("valid-three-rivals.json", "today");
    const c = three.items[0]!.candidate;
    expect(c.otras).toHaveLength(3);
    const h = renderHomePage(three);
    const article = h.slice(h.indexOf("<article"), h.indexOf("</article>"));
    let last = -1;
    for (const o of c.otras) {
      const at = article.indexOf(`<span>${ars(o.precio_ars)}</span>`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(article.indexOf("Diferencia")).toBeGreaterThan(last);
    expect(article).toContain(ars(c.diferencia_ars));
  });
});
