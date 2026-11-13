import type { APIRoute } from "astro";
import { INDEXNOW_KEY, indexNowKeyBody } from "../../src/deploy/indexnow.js";

export const getStaticPaths = () => [{ params: { key: INDEXNOW_KEY } }];

export const GET: APIRoute = () => new Response(indexNowKeyBody());
