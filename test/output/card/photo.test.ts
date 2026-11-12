import { describe, expect, it, vi } from "vitest";
import { fetchCardPhoto } from "../../../src/output/card/photo.js";

const bytes = new Uint8Array([1, 2, 3, 4]);
const ok = (type = "image/jpeg", body: Uint8Array = bytes) =>
  vi.fn(async (_url: string, _init?: { signal?: AbortSignal }) => new Response(body, { headers: { "content-type": type } }));
const URL_JPG = "https://http2.mlstatic.com/D_NQ_NP_1-F.jpg";

describe("fetchCardPhoto", () => {
  it("returns a base64 data uri for a jpeg", async () => {
    expect(await fetchCardPhoto(URL_JPG, ok())).toBe(`data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`);
  });

  it("accepts png", async () => {
    expect(await fetchCardPhoto(URL_JPG, ok("image/png"))).toMatch(/^data:image\/png;base64,/);
  });

  it("requests the jpg variant of a webp url", async () => {
    const f = ok();
    await fetchCardPhoto("https://http2.mlstatic.com/D_NQ_NP_1-O.webp", f);
    expect(f.mock.calls[0]![0]).toBe("https://http2.mlstatic.com/D_NQ_NP_1-O.jpg");
  });

  it("passes an abort signal", async () => {
    const f = ok();
    await fetchCardPhoto(URL_JPG, f);
    expect(f.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("returns null without fetching for null or foreign urls", async () => {
    const f = ok();
    expect(await fetchCardPhoto(null, f)).toBeNull();
    expect(await fetchCardPhoto("https://evil.com/a.jpg", f)).toBeNull();
    expect(await fetchCardPhoto("http://http2.mlstatic.com/a.jpg", f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null for webp or other content types", async () => {
    expect(await fetchCardPhoto(URL_JPG, ok("image/webp"))).toBeNull();
    expect(await fetchCardPhoto(URL_JPG, ok("text/html"))).toBeNull();
  });

  it("returns null for non-ok responses, oversize bodies and empty bodies", async () => {
    expect(await fetchCardPhoto(URL_JPG, vi.fn(async () => new Response("x", { status: 404, headers: { "content-type": "image/jpeg" } })))).toBeNull();
    expect(await fetchCardPhoto(URL_JPG, ok("image/jpeg", new Uint8Array(2_100_000)))).toBeNull();
    expect(await fetchCardPhoto(URL_JPG, ok("image/jpeg", new Uint8Array(0)))).toBeNull();
  });

  it("never throws", async () => {
    expect(await fetchCardPhoto(URL_JPG, vi.fn(async () => { throw new Error("offline"); }))).toBeNull();
  });
});
