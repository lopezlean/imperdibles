import type { Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

export type CouponLogCapture = {
  logger: Logger;
  shutdown(): Promise<void>;
};

function warnMissingConfig(name: "PUBLIC_POSTHOG_PROJECT_TOKEN" | "PUBLIC_POSTHOG_HOST"): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `${name} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${name} is configured`,
    );
  }
}

/** Creates the isolated PostHog log exporter for one local coupon job. */
export function createCouponLogCapture(): CouponLogCapture | null {
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

  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ "service.name": "imperdibles-coupon-extractor" }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: new URL("/i/v1/logs", host).toString(),
          headers: { Authorization: `Bearer ${projectToken}` },
        }),
      }),
    ],
  });
  const logger = provider.getLogger("imperdibles.coupon-job");

  return {
    logger,
    shutdown: async () =>
      new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3_000);
        timeout.unref();
        void provider
          .shutdown()
          .catch(() => undefined)
          .finally(() => {
            clearTimeout(timeout);
            resolve();
          });
      }),
  };
}
