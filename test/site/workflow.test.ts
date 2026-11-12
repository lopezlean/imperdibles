import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

describe("deploy workflow", () => {
  it("is manual only", () => {
    expect(workflow).toContain("workflow_dispatch");
    for (const trigger of ["schedule:", "push:", "pull_request:"]) {
      expect(workflow).not.toContain(trigger);
    }
  });

  it("never cancels a running deploy", () => {
    expect(workflow).toContain("group: deploy");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("runs the site-only ship", () => {
    expect(workflow).toContain("pnpm run ship --site-only");
    expect(workflow).not.toContain("PUBLISH_NOW_SECRET");
    expect(workflow).not.toContain("WORKER_BASE_URL");
  });

  it("uses Node 24 and read-only permissions", () => {
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
  });

  it("passes the build and deploy credentials", () => {
    for (const name of [
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "D1_ACCOUNT_ID",
      "D1_API_TOKEN",
      "D1_DATABASE_ID",
      "SITE_URL",
      "TELEGRAM_CHANNEL_URL",
    ]) {
      expect(workflow).toContain(`secrets.${name}`);
    }
  });
});
