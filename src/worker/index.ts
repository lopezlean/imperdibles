import { createD1BindingClient } from "../shared/db/d1-binding-client.js";
import type { WorkerDeps } from "./deps.js";
import type { Env } from "./env.js";

export async function handleFetch(req: Request, deps: WorkerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === "GET" && pathname === "/healthz") {
    await deps.db.all("SELECT 1");
    return new Response("ok", { status: 200 });
  }
  return new Response("not found", { status: 404 });
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleFetch(req, { db: createD1BindingClient(env.DB), env, now: () => new Date() });
  },
};
