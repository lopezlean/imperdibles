import { spawn } from "node:child_process";

/** Runs a command with inherited stdio and resolves with its exit code. */
export const spawnExec = (cmd: string, args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
