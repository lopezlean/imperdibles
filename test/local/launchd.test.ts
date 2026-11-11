import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const plistPath = (name: string) => path.join(ROOT, "ops", "launchd", `ar.imperdibles.${name}.plist`);

type Plist = string | number | boolean | Plist[] | { [key: string]: Plist };

/** Just enough of the plist format for these files: dict, array, string, integer, true, false. */
function parsePlist(xml: string): Plist {
  const $ = cheerio.load(xml, { xmlMode: true });
  const value = (node: Cheerio<any>): Plist => {
    const kids = node.children().toArray().map((k) => $(k));
    const tag = String(node.prop("tagName")).toLowerCase();
    switch (tag) {
      case "dict": {
        const out: { [key: string]: Plist } = {};
        for (let i = 0; i < kids.length; i += 2) out[kids[i]!.text()] = value(kids[i + 1]!);
        return out;
      }
      case "array":
        return kids.map(value);
      case "integer":
        return Number(node.text());
      case "true":
        return true;
      case "false":
        return false;
      case "string":
        return node.text();
      default:
        throw new Error(`unsupported plist element <${tag}>`);
    }
  };
  return value($("plist").children().first());
}

const load = (name: string) => parsePlist(readFileSync(plistPath(name), "utf8")) as { [key: string]: Plist };

describe("launchd schedule", () => {
  for (const name of ["correr", "revalidar"] as const) {
    describe(name, () => {
      const plist = () => load(name);

      it("is a well-formed plist labelled for the job", () => {
        expect(plist().Label).toBe(`ar.imperdibles.${name}`);
      });

      it("runs bin/imperdibles with the subcommand from the repo directory", () => {
        const args = plist().ProgramArguments as string[];
        expect(args[0]).toMatch(/\/bin\/imperdibles$/);
        expect(path.isAbsolute(args[0]!)).toBe(true);
        expect(args.slice(1)).toEqual([name]);
        expect(plist().WorkingDirectory).toBe(path.dirname(path.dirname(args[0]!)));
      });

      it("logs to var/launchd-*.log", () => {
        const dir = plist().WorkingDirectory as string;
        expect(plist().StandardOutPath).toBe(path.join(dir, "var", `launchd-${name}.log`));
        expect(plist().StandardErrorPath).toBe(path.join(dir, "var", `launchd-${name}.log`));
      });

      it("finds pnpm and node without the user's shell", () => {
        const env = plist().EnvironmentVariables as { PATH: string };
        expect(env.PATH.split(":")).toEqual(expect.arrayContaining(["/opt/homebrew/bin", "/usr/bin", "/bin"]));
      });

      it("never installs itself at load", () => {
        expect(plist().RunAtLoad ?? false).toBe(false);
      });
    });
  }

  it("runs correr daily at 06:00", () => {
    expect(load("correr").StartCalendarInterval).toEqual([{ Hour: 6, Minute: 0 }]);
  });

  it("runs revalidar at 10:45 and at :45 of every hour from 11 to 19", () => {
    const expected = [{ Hour: 10, Minute: 45 }, ...Array.from({ length: 9 }, (_, i) => ({ Hour: 11 + i, Minute: 45 }))];
    expect(load("revalidar").StartCalendarInterval).toEqual(expected);
  });
});
