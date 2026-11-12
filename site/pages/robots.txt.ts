import { readSiteEnv } from "../lib/env.js";
import { buildRobotsTxt } from "../lib/seo.js";

export const GET = () => new Response(buildRobotsTxt(readSiteEnv(process.env).siteUrl));
