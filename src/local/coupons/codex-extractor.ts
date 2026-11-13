import { randomUUID } from "node:crypto";
import {
  ExtractionError,
  SYSTEM_PROMPT,
  TOOL_DESCRIPTION,
  TOOL_NAME,
  couponToolSchema,
  extractionResultSchema,
  userContent,
  type CouponExtractor,
} from "./extractor.js";
import { CodexAuthError, type CodexAuth } from "./codex-auth.js";
import type { CouponAiObservability } from "./posthog-ai.js";

export const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";

const URL = "https://chatgpt.com/backend-api/codex/responses";
const TIMEOUT_MS = 60_000;

const INSTRUCTIONS = `${SYSTEM_PROMPT}\nRespondé únicamente llamando a la herramienta ${TOOL_NAME}; no escribas texto fuera de la llamada.`;

type Collected = { text: string; args: string };

/** Lenient SSE reader: whatever arrived when the body ends is the answer. */
function collect(body: string): Collected {
  const out: Collected = { text: "", args: "" };
  let pending: string | undefined;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") {
      pending = undefined;
      continue;
    }
    if (line.startsWith("event:")) {
      pending = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") break;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (data === null || typeof data !== "object") continue;
    const type = pending ?? (typeof data.type === "string" ? data.type : undefined);
    pending = undefined;
    if (type === "response.output_text.delta" && typeof data.delta === "string") out.text += data.delta;
    else if (type === "response.function_call_arguments.delta" && typeof data.delta === "string") out.args += data.delta;
    else if (type === "response.output_item.done") {
      const item = data.item as Record<string, unknown> | undefined;
      if (item?.type === "function_call" && item.name === TOOL_NAME && typeof item.arguments === "string" && item.arguments !== "") {
        out.args = item.arguments;
      }
    }
  }
  return out;
}

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const stripFence = (text: string): string => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export function createCodexExtractor(cfg: {
  auth: CodexAuth;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  aiObservability?: CouponAiObservability | null;
}): CouponExtractor {
  const doFetch = cfg.fetch ?? fetch;
  return {
    async extract(post) {
      let credentials: Awaited<ReturnType<CodexAuth["getCredentials"]>>;
      try {
        credentials = await cfg.auth.getCredentials();
      } catch (err) {
        throw new ExtractionError(err instanceof CodexAuthError ? err.message : "Codex credentials unavailable");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? TIMEOUT_MS);
      const traceId = randomUUID();
      const startedAt = Date.now();
      const userInput = userContent(post);
      const input = [
        { role: "system" as const, content: INSTRUCTIONS },
        { role: "user" as const, content: userInput },
      ];
      let body: string;
      let httpStatus: number | undefined;
      try {
        const res = await doFetch(URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            accept: "text/event-stream",
            "content-type": "application/json",
            "OpenAI-Beta": "responses=experimental",
            originator: "pi",
            "User-Agent": "pi (macOS 15.0; Darwin 25.0.0; arm64)",
            ...(credentials.accountId ? { "chatgpt-account-id": credentials.accountId } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            store: false,
            stream: true,
            instructions: INSTRUCTIONS,
            input: [{ role: "user", content: userInput }],
            text: { verbosity: "medium" },
            include: ["reasoning.encrypted_content"],
            tool_choice: "auto",
            parallel_tool_calls: false,
            tools: [{ type: "function", name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: couponToolSchema() }],
          }),
        });
        httpStatus = res.status;
        if (!res.ok) throw new ExtractionError(`Codex request failed (HTTP ${res.status})`);
        body = await res.text();
      } catch (err) {
        // Only fixed descriptions leave the process: transport errors can echo headers.
        const error = err instanceof ExtractionError ? "request failed" : controller.signal.aborted ? "request timed out" : "network error";
        cfg.aiObservability?.captureCodexGeneration({
          traceId,
          model: cfg.model,
          input,
          latencyMs: Date.now() - startedAt,
          httpStatus,
          error,
        });
        if (err instanceof ExtractionError) throw err;
        throw new ExtractionError(controller.signal.aborted ? "Codex request timed out" : "Codex request failed (network error)");
      } finally {
        clearTimeout(timer);
      }

      const { args, text } = collect(body);
      cfg.aiObservability?.captureCodexGeneration({
        traceId,
        model: cfg.model,
        input,
        output: args !== "" ? args : text,
        latencyMs: Date.now() - startedAt,
        httpStatus,
      });
      const payload = args !== "" ? tryJson(args) : text !== "" ? tryJson(stripFence(text)) : undefined;
      if (payload === undefined) throw new ExtractionError("Codex response had no parseable coupon payload");
      const parsed = extractionResultSchema.safeParse(payload);
      if (!parsed.success) throw new ExtractionError("Codex output did not match the coupon schema");
      return parsed.data.coupons;
    },
  };
}
