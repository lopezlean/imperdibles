import { describe, expect, it } from "vitest";
import { catalogPhotoUrl } from "../../src/output/photo-url.js";

describe("catalogPhotoUrl", () => {
  it("accepts https hosts under mlstatic.com", () => {
    expect(catalogPhotoUrl("https://http2.mlstatic.com/D_NQ_NP_1-F.jpg")).toBe("https://http2.mlstatic.com/D_NQ_NP_1-F.jpg");
  });
  it.each([
    null,
    "",
    "http://http2.mlstatic.com/a.jpg",
    "https://mlstatic.com/a.jpg",
    "https://evil.com/a.jpg",
    "https://http2.mlstatic.com.evil.com/a.jpg",
    "https://user:pw@http2.mlstatic.com/a.jpg",
    "javascript:alert(1)",
    "not a url",
  ])("rejects %s", (u) => {
    expect(catalogPhotoUrl(u)).toBeNull();
  });
});
