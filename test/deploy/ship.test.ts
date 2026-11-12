import { describe, expect, it } from "vitest";
import { MAX_PUBLISH_CALLS, ship, type ShipDeps } from "../../src/deploy/ship.js";

type Call = { url: string; init: RequestInit };

function harness(opts: {
  bodies?: (n: number) => Response | Promise<Response>;
  exitCodes?: Record<string, number>;
  base?: string;
}) {
  const calls: Call[] = [];
  const execs: string[] = [];
  const logs: string[] = [];
  let n = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
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
  };
  return { deps, calls, execs, logs };
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
