import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

type GenerationCapture = {
  traceId: string;
  model: string;
  provider: "anthropic" | "openai";
  input: unknown;
  outputChoices: unknown[];
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  httpStatus?: number;
  error?: string;
};

export type CouponAiObservability = {
  captureAnthropicGeneration(input: Omit<GenerationCapture, "provider">): void;
  captureCodexGeneration(input: {
    traceId: string;
    model: string;
    input: { role: "system" | "user"; content: string }[];
    output?: string;
    latencyMs: number;
    httpStatus?: number;
    error?: string;
  }): void;
  shutdown(): Promise<void>;
};

function warnMissingConfig(name: "PUBLIC_POSTHOG_PROJECT_TOKEN" | "PUBLIC_POSTHOG_HOST"): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `${name} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${name} is configured`,
    );
  }
}

/** Creates the local coupon pipeline's AI trace transport for the lifetime of one CLI run. */
export function createCouponAiObservability(): CouponAiObservability | null {
  const projectToken = process.env.PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!projectToken) {
    warnMissingConfig("PUBLIC_POSTHOG_PROJECT_TOKEN");
    return null;
  }
  const host = process.env.PUBLIC_POSTHOG_HOST;
  if (!host) {
    warnMissingConfig("PUBLIC_POSTHOG_HOST");
    return null;
  }

  const posthog = new PostHog(projectToken, { host, privacyMode: false });
  const sessionId = `coupon-run-${randomUUID()}`;
  const captureGeneration = ({
    traceId,
    model,
    provider,
    input,
    outputChoices,
    inputTokens,
    outputTokens,
    latencyMs,
    httpStatus,
    error,
  }: GenerationCapture): void => {
    try {
      posthog.capture({
        distinctId: sessionId,
        event: "$ai_generation",
        properties: {
          $process_person_profile: false,
          $ai_trace_id: traceId,
          $ai_session_id: sessionId,
          $ai_model: model,
          $ai_provider: provider,
          $ai_input: input,
          $ai_output_choices: outputChoices,
          $ai_input_tokens: inputTokens,
          $ai_output_tokens: outputTokens,
          $ai_latency: latencyMs / 1000,
          ...(httpStatus === undefined ? {} : { $ai_http_status: httpStatus }),
          ...(error === undefined ? {} : { $ai_is_error: true, $ai_error: error }),
        },
      });
    } catch {
      // Observability must never interrupt coupon extraction.
    }
  };

  return {
    captureAnthropicGeneration: (input) => captureGeneration({ ...input, provider: "anthropic" }),
    captureCodexGeneration: ({ traceId, model, input, output, latencyMs, httpStatus, error }) =>
      captureGeneration({
        traceId,
        model,
        provider: "openai",
        input,
        outputChoices: output === undefined ? [] : [{ role: "assistant", content: output }],
        inputTokens: null,
        outputTokens: null,
        latencyMs,
        httpStatus,
        error,
      }),
    shutdown: async () => {
      await posthog.shutdown(3000).catch(() => undefined);
    },
  };
}
