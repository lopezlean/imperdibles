import "dotenv/config";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { readSiteEnv } from "./site/lib/env.js";
import { getCouponsLastmod, getSiteData } from "./site/lib/site-data.js";
import { imagesByPath, lastmodByPath } from "./site/lib/sitemap.js";

const { siteUrl } = readSiteEnv(process.env);

// Started at config load: the config's module runner is closed by the time the sitemap serializes,
// so lazy imports (better-sqlite3, D1 client) would fail there. A failure still surfaces in serialize().
const meta = Promise.all([getSiteData(), getCouponsLastmod()]).then(([d, couponsLastmod]) => {
  const lastmods = lastmodByPath(d);
  if (couponsLastmod) lastmods.set("/cupones/", couponsLastmod);
  return { lastmods, images: imagesByPath(d) };
});
meta.catch(() => undefined);

export default defineConfig({
  output: "static",
  srcDir: "./site",
  outDir: process.env.SITE_OUT_DIR ?? "./dist/site",
  site: siteUrl,
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [sitemap({
      namespaces: { news: false, xhtml: false, video: false, image: true },
      async serialize(item) {
        const { lastmods, images } = await meta;
        const path = new URL(item.url).pathname;
        const lastmod = lastmods.get(path);
        if (lastmod) item.lastmod = lastmod;
        // SitemapItem omits `img`, but the sitemap writer serializes it.
        const urls = images.get(path);
        if (urls) (item as { img?: { url: string }[] }).img = urls.map((url) => ({ url }));
        return item;
      },
    })],
});
