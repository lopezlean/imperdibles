import { describe, expect, it, vi } from "vitest";
import { BudgetExhaustedError, NetworkError, UpstreamError, createBudgetedHttp } from "../../src/data/http.js";

function seq(...items: Array<Response | Error>) {
  const queue = [...items];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const res = (status: number, headers: Record<string, string> = {}) => new Response("x", { status, headers });
const noSleep = () => vi.fn(async (_ms: number) => {});

describe("createBudgetedHttp", () => {
  it("counts every attempt, retries included, toward the budget", async () => {
    const http = createBudgetedHttp({ fetch: seq(res(503), res(200)), budget: 10, sleep: noSleep() });
    await http.get("https://a.test/");
    expect(http.used()).toBe(2);
  });

  it("retries 429 and 5xx with sleeps 1000, 2000, 4000 then throws UpstreamError", async () => {
    const sleep = noSleep();
    const f = seq(res(429), res(500), res(502), res(503));
    const http = createBudgetedHttp({ fetch: f, budget: 10, sleep });
    await expect(http.get("https://a.test/x")).rejects.toMatchObject({ status: 503, url: "https://a.test/x" });
    await expect(Promise.resolve()).resolves.toBeUndefined();
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    expect(f).toHaveBeenCalledTimes(4);
    expect(http.used()).toBe(4);
  });

  it("throws an UpstreamError instance", async () => {
    const http = createBudgetedHttp({ fetch: seq(res(500), res(500), res(500), res(500)), budget: 10, sleep: noSleep() });
    await expect(http.get("https://a.test/")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("returns 200 after one 503 without throwing", async () => {
    const http = createBudgetedHttp({ fetch: seq(res(503), res(200)), budget: 10, sleep: noSleep() });
    const r = await http.get("https://a.test/");
    expect(r.status).toBe(200);
  });

  it("throws BudgetExhaustedError before an attempt once used() === budget", async () => {
    const f = seq(res(200), res(200));
    const http = createBudgetedHttp({ fetch: f, budget: 2, sleep: noSleep() });
    await http.get("https://a.test/");
    await http.get("https://a.test/");
    await expect(http.get("https://a.test/")).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("stops early when x-ratelimit-remaining or ratelimit-remaining <= reserve", async () => {
    for (const header of ["x-ratelimit-remaining", "ratelimit-remaining"]) {
      const f = seq(res(200, { [header]: "5" }));
      const http = createBudgetedHttp({ fetch: f, budget: 100, sleep: noSleep() });
      await http.get("https://a.test/");
      await expect(http.get("https://a.test/")).rejects.toBeInstanceOf(BudgetExhaustedError);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps going while remaining is above the reserve", async () => {
    const http = createBudgetedHttp({ fetch: seq(res(200, { "x-ratelimit-remaining": "6" }), res(200)), budget: 100, sleep: noSleep() });
    await http.get("https://a.test/");
    await expect(http.get("https://a.test/")).resolves.toBeDefined();
  });

  it("honours a custom reserve", async () => {
    const http = createBudgetedHttp({ fetch: seq(res(200, { "x-ratelimit-remaining": "20" })), budget: 100, sleep: noSleep(), reserve: 20 });
    await http.get("https://a.test/");
    await expect(http.get("https://a.test/")).rejects.toBeInstanceOf(BudgetExhaustedError);
  });

  it("returns 401, 403 and 404 to the caller without retry", async () => {
    for (const status of [401, 403, 404]) {
      const sleep = noSleep();
      const f = seq(res(status));
      const http = createBudgetedHttp({ fetch: f, budget: 10, sleep });
      expect((await http.get("https://a.test/")).status).toBe(status);
      expect(f).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("maps a fetch TypeError to NetworkError without retry", async () => {
    const f = seq(new TypeError("fetch failed"));
    const http = createBudgetedHttp({ fetch: f, budget: 10, sleep: noSleep() });
    await expect(http.get("https://a.test/")).rejects.toBeInstanceOf(NetworkError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(http.used()).toBe(1);
  });

  it("passes headers through to fetch", async () => {
    const f = seq(res(200));
    const http = createBudgetedHttp({ fetch: f, budget: 10, sleep: noSleep() });
    await http.get("https://a.test/", { Authorization: "Bearer t" });
    expect(f).toHaveBeenCalledWith("https://a.test/", { method: "GET", headers: { Authorization: "Bearer t" } });
  });
});
