import "dotenv/config";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { readSiteEnv } from "./site/lib/env.js";

const { siteUrl } = readSiteEnv(process.env);

export default defineConfig({
  output: "static",
  srcDir: "./site",
  outDir: process.env.SITE_OUT_DIR ?? "./dist/site",
  site: siteUrl,
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [sitemap()],
});
