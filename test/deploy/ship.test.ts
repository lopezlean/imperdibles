import { describe, expect, it } from "vitest";
import { INDEXNOW_KEY } from "../../src/deploy/indexnow.js";
import { MAX_PUBLISH_CALLS, ship, type ShipDeps } from "../../src/deploy/ship.js";

const SITE = "https://imperdibles.com.ar";

type Call = { url: string; init: RequestInit };

function harness(opts: {
  bodies?: (n: number) => Response | Promise<Response>;
  exitCodes?: Record<string, number>;
  base?: string;
  /** Body served for each live sitemap URL; absent url = fetch fails. */
  live?: Record<string, string | Error>;
  built?: Record<string, string>;
  indexNow?: (n: number) => Response | Promise<Response>;
}) {
  const calls: Call[] = [];
  const execs: string[] = [];
  const logs: string[] = [];
  let n = 0;
  const indexNowCalls: Call[] = [];
  let ni = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    if (url === "https://api.indexnow.org/indexnow") {
      indexNowCalls.push({ url, init });
      ni++;
      return opts.indexNow ? opts.indexNow(ni) : new Response(null, { status: 200 });
    }
    if (url.startsWith(`${SITE}/sitemap`)) {
      const live = opts.live?.[url];
      if (live === undefined) return new Response("not found", { status: 404 });
      if (live instanceof Error) throw live;
      return new Response(live);
    }
    calls.push({ url, init });
    n++;
    return opts.bodies ? opts.bodies(n) : new Response(JSON.stringify({ published: [] }));
  }) as unknown as typeof fetch;
  const deps: ShipDeps = {
    fetch: fetchFn,
    exec: async (_cmd, args) => {
      const key = args[1]!;
      execs.push(key);
      return opts.exitCodes?.[key] ?? 0;
    },
    log: (l) => logs.push(l),
    workerBaseUrl: opts.base ?? "https://w.test",
    publishNowSecret: "s3cret",
    siteUrl: SITE,
    outDir: "/out",
    readFile: async (path) => {
      const body = opts.built?.[path];
      if (body === undefined) throw new Error(`ENOENT ${path}`);
      return body;
    },
  };
  return { deps, calls, execs, logs, indexNowCalls };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

describe("ship", () => {
  it("publishes until a call publishes nothing", async () => {
    const reports = [{ published: ["a"] }, { published: ["b"] }, { published: [] }];
    const h = harness({ bodies: (n) => json(reports[n - 1]) });
    expect(await ship(h.deps, { siteOnly: false })).toBe(0);
    expect(h.calls).toHaveLength(3);
    expect(h.execs).toEqual(["astro", "wrangler"]);
  });

  it("stops at 10 publish calls", async () => {
    const h = harness({ bodies: () => json({ published: ["x"] }) });
    await ship(h.deps, { siteOnly: false });
    expect(h.calls).toHaveLength(MAX_PUBLISH_CALLS);
    expect(MAX_PUBLISH_CALLS).toBe(10);
  });

  it("counts a failures-only call as nothing", async () => {
    const h = harness({ bodies: () => json({ published: [], failed: ["c"], stale: [] }) });
    await ship(h.deps, { siteOnly: false });
    expect(h.calls).toHaveLength(1);
  });

  it("--site-only makes no publish call", async () => {
    const h = harness({});
    expect(await ship(h.deps, { siteOnly: true })).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect(h.execs).toEqual(["astro", "wrangler"]);
  });

  it("sends the Bearer secret to the worker", async () => {
    for (const base of ["https://w.test", "https://w.test/"]) {
      const h = harness({ base });
      await ship(h.deps, { siteOnly: false });
      expect(h.calls[0]!.url).toBe("https://w.test/internal/publish-now");
      expect(h.calls[0]!.init.method).toBe("POST");
      expect((h.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    }
  });

  it("still builds when publishing fails, and exits 2 so the failure is never silent", async () => {
    const cases: ((n: number) => Response | Promise<Response>)[] = [
      () => json({}, 500),
      () => Promise.reject(new Error("offline")),
      () => new Response("<html>nope</html>"),
    ];
    for (const bodies of cases) {
      const h = harness({ bodies });
      expect(await ship(h.deps, { siteOnly: false })).toBe(2);
      expect(h.calls).toHaveLength(1);
      expect(h.logs.length).toBeGreaterThan(0);
      expect(h.execs).toEqual(["astro", "wrangler"]);
    }
  });

  it("passes an abort signal to publish-now and treats a timeout as a publish failure", async () => {
    const h = harness({
      bodies: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    });
    expect(await ship(h.deps, { siteOnly: false })).toBe(2);
    expect(h.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(h.execs).toEqual(["astro", "wrangler"]);
  });

  it("a build failure after a failed publish still exits 1", async () => {
    const h = harness({ bodies: () => json({}, 500), exitCodes: { astro: 1 } });
    expect(await ship(h.deps, { siteOnly: false })).toBe(1);
  });

  it("exits non-zero when the build fails", async () => {
    const h = harness({ bodies: () => json({ published: ["a"] }), exitCodes: { astro: 1 } });
    expect(await ship(h.deps, { siteOnly: false })).toBe(1);
    expect(h.execs).toEqual(["astro"]);
    expect(h.logs.some((l) => l.includes("Telegram posts already went out"))).toBe(true);
  });

  it("exits non-zero when the upload fails", async () => {
    const h = harness({ bodies: () => json({ published: ["a"] }), exitCodes: { wrangler: 1 } });
    expect(await ship(h.deps, { siteOnly: false })).toBe(1);
    expect(h.logs.some((l) => l.includes("Telegram posts already went out"))).toBe(true);
  });

  it("does not claim Telegram posts when nothing was published", async () => {
    const h = harness({ exitCodes: { astro: 1 } });
    expect(await ship(h.deps, { siteOnly: false })).toBe(1);
    expect(h.logs.some((l) => l.includes("Telegram"))).toBe(false);
  });

  it("--site-only build failure does not claim Telegram posts", async () => {
    const h = harness({ exitCodes: { astro: 1 } });
    expect(await ship(h.deps, { siteOnly: true })).toBe(1);
    expect(h.logs.some((l) => l.includes("Telegram"))).toBe(false);
  });
});

const index = (...names: string[]) =>
  `<sitemapindex>${names.map((n) => `<sitemap><loc>${SITE}/${n}</loc></sitemap>`).join("")}</sitemapindex>`;
const urlset = (entries: [string, string][]) =>
  `<urlset>${entries.map(([p, m]) => `<url><loc>${SITE}${p}</loc><lastmod>${m}</lastmod></url>`).join("")}</urlset>`;

describe("ship IndexNow", () => {
  const built = {
    "/out/sitemap-index.xml": index("sitemap-0.xml"),
    "/out/sitemap-0.xml": urlset([
      ["/", "2"],
      ["/a/", "1"],
      ["/b/", "5"],
    ]),
  };
  const live = {
    [`${SITE}/sitemap-index.xml`]: index("sitemap-0.xml"),
    [`${SITE}/sitemap-0.xml`]: urlset([
      ["/", "1"],
      ["/a/", "1"],
    ]),
  };

  it("submits only new or changed urls after a successful deploy", async () => {
    const h = harness({ built, live });
    expect(await ship(h.deps, { siteOnly: false })).toBe(0);
    expect(h.indexNowCalls).toHaveLength(1);
    const call = h.indexNowCalls[0]!;
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(call.init.body as string)).toEqual({
      host: "imperdibles.com.ar",
      key: INDEXNOW_KEY,
      keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
      urlList: [`${SITE}/`, `${SITE}/b/`],
    });
    expect(h.logs.some((l) => l.includes("IndexNow: submitted 2 URLs"))).toBe(true);
  });

  it("also runs with --site-only", async () => {
    const h = harness({ built, live });
    expect(await ship(h.deps, { siteOnly: true })).toBe(0);
    expect(h.indexNowCalls).toHaveLength(1);
  });

  it("reads the live sitemap before the build and the built one after it", async () => {
    const order: string[] = [];
    const h = harness({ built, live });
    const fetchLive = h.deps.fetch;
    h.deps.fetch = (async (url: string, init: RequestInit) => {
      if (url.includes("/sitemap")) order.push("live");
      return fetchLive(url, init);
    }) as typeof fetch;
    const exec = h.deps.exec;
    h.deps.exec = async (cmd, args) => {
      order.push(args[1]!);
      return exec(cmd, args);
    };
    const read = h.deps.readFile;
    h.deps.readFile = async (p) => {
      order.push("built");
      return read(p);
    };
    await ship(h.deps, { siteOnly: true });
    const first = (k: string) => order.indexOf(k);
    expect(first("live")).toBeLessThan(first("astro"));
    expect(first("astro")).toBeLessThan(first("built"));
  });

  it("treats every built url as changed when the live sitemap cannot be fetched", async () => {
    for (const bad of [{} as Record<string, string | Error>, { [`${SITE}/sitemap-index.xml`]: new Error("offline") }]) {
      const h = harness({ built, live: bad });
      expect(await ship(h.deps, { siteOnly: true })).toBe(0);
      expect(JSON.parse(h.indexNowCalls[0]!.init.body as string).urlList).toHaveLength(3);
    }
  });

  it("treats every built url as changed when a child sitemap is missing", async () => {
    const h = harness({ built, live: { [`${SITE}/sitemap-index.xml`]: index("sitemap-0.xml") } });
    await ship(h.deps, { siteOnly: true });
    expect(JSON.parse(h.indexNowCalls[0]!.init.body as string).urlList).toHaveLength(3);
  });

  it("submits nothing when no url changed", async () => {
    const h = harness({
      built,
      live: { ...live, [`${SITE}/sitemap-0.xml`]: built["/out/sitemap-0.xml"] },
    });
    expect(await ship(h.deps, { siteOnly: true })).toBe(0);
    expect(h.indexNowCalls).toHaveLength(0);
  });

  it("submits nothing when the build or the upload fails", async () => {
    for (const exitCodes of [{ astro: 1 }, { wrangler: 1 }] as Record<string, number>[]) {
      const h = harness({ built, live, exitCodes });
      expect(await ship(h.deps, { siteOnly: true })).toBe(1);
      expect(h.indexNowCalls).toHaveLength(0);
    }
  });

  it("chunks big submissions at 10000 urls", async () => {
    const many = urlset(Array.from({ length: 10_001 }, (_, i) => [`/p/${i}/`, "1"] as [string, string]));
    const h = harness({ built: { ...built, "/out/sitemap-0.xml": many } });
    await ship(h.deps, { siteOnly: true });
    expect(h.indexNowCalls.map((c) => JSON.parse(c.init.body as string).urlList.length)).toEqual([10_000, 1]);
  });

  it("only warns when IndexNow answers non-2xx, throws, or the built sitemap is unreadable", async () => {
    const cases = [
      harness({ built, live, indexNow: () => new Response("bad", { status: 429 }) }),
      harness({ built, live, indexNow: () => Promise.reject(new Error("offline")) }),
      harness({ live }),
    ];
    for (const h of cases) {
      expect(await ship(h.deps, { siteOnly: true })).toBe(0);
      expect(h.logs.some((l) => l.includes("IndexNow") && l.toLowerCase().includes("warn"))).toBe(true);
    }
  });

  it("keeps exit code 2 when a publish failed and IndexNow also fails", async () => {
    const h = harness({
      built,
      live,
      bodies: () => json({}, 500),
      indexNow: () => new Response("bad", { status: 500 }),
    });
    expect(await ship(h.deps, { siteOnly: false })).toBe(2);
  });
});
