import "dotenv/config";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { readSiteEnv } from "./site/lib/env.js";
import { getSiteData } from "./site/lib/site-data.js";
import { lastmodByPath } from "./site/lib/sitemap.js";

const { siteUrl } = readSiteEnv(process.env);

let lastmods: Promise<Map<string, string>> | undefined;
const loadLastmods = () => (lastmods ??= getSiteData().then(lastmodByPath));

export default defineConfig({
  output: "static",
  srcDir: "./site",
  outDir: process.env.SITE_OUT_DIR ?? "./dist/site",
  site: siteUrl,
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [sitemap({
      async serialize(item) {
        const lastmod = (await loadLastmods()).get(new URL(item.url).pathname);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    })],
});
