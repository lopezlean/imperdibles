import "dotenv/config";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { readSiteEnv } from "./site/lib/env.js";
import { getSiteData } from "./site/lib/site-data.js";
import { lastmodByPath } from "./site/lib/sitemap.js";

const { siteUrl } = readSiteEnv(process.env);

// Started at config load: the config's module runner is closed by the time the sitemap serializes,
// so lazy imports (better-sqlite3, D1 client) would fail there. A failure still surfaces in serialize().
const lastmods = getSiteData().then(lastmodByPath);
lastmods.catch(() => undefined);

export default defineConfig({
  output: "static",
  srcDir: "./site",
  outDir: process.env.SITE_OUT_DIR ?? "./dist/site",
  site: siteUrl,
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [sitemap({
      async serialize(item) {
        const lastmod = (await lastmods).get(new URL(item.url).pathname);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    })],
});
