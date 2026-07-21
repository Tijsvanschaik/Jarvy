import { build } from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error("run-cli requires a TypeScript entry point.");
  process.exit(2);
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-cli-"));
const output = path.join(directory, "command.mjs");
try {
  await build({
    entryPoints: [path.resolve(entry)],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
  });
  const child = spawn(process.execPath, [output, ...args], { stdio: "inherit", env: process.env });
  const signal = (name) => child.kill(name);
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  const code = await new Promise((resolve) => child.once("exit", (value) => resolve(value ?? 1)));
  process.exitCode = code;
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
