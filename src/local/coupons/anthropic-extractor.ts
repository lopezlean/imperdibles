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

export const DEFAULT_MODEL = "claude-haiku-5-5";

export type AnthropicLike = {
  messages: {
    create(params: Record<string, unknown>): Promise<{ content: { type: string; input?: unknown }[] }>;
  };
};

export function createAnthropicExtractor(cfg: { client: AnthropicLike; model: string }): CouponExtractor {
  return {
    async extract(post) {
      let response: Awaited<ReturnType<AnthropicLike["messages"]["create"]>>;
      try {
        response = await cfg.client.messages.create({
          model: cfg.model,
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          tools: [
            {
              name: TOOL_NAME,
              description: TOOL_DESCRIPTION,
              input_schema: couponToolSchema(),
            },
          ],
          tool_choice: { type: "tool", name: TOOL_NAME },
          messages: [
            {
              role: "user",
              content: userContent(post),
            },
          ],
        });
      } catch (err) {
        // Only the error class name: SDK errors can carry request headers or echo the key.
        const name = err instanceof Error ? err.name : "unknown error";
        throw new ExtractionError(`Anthropic request failed (${name})`);
      }
      const block = response.content.find((b) => b.type === "tool_use");
      if (!block) throw new ExtractionError("Anthropic response had no tool_use block");
      const parsed = extractionResultSchema.safeParse(block.input);
      if (!parsed.success) throw new ExtractionError("Anthropic tool output did not match the coupon schema");
      return parsed.data.coupons;
    },
  };
}
