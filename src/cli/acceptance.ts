import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PROMPT_FILES } from "../main/promptLoader";

async function main(): Promise<void> {
  const root = process.cwd();
  const manifest = z.object({
    version: z.number().int().positive(),
    templates: z.record(z.string(), z.object({ sha256: z.string(), previousSha256: z.array(z.string()) })),
  }).parse(JSON.parse(await fs.readFile(path.join(root, "prompts", "manifest.json"), "utf8")));
  const failures: string[] = [];
  for (const name of PROMPT_FILES) {
    const content = await fs.readFile(path.join(root, "prompts", name), "utf8");
    const actual = crypto.createHash("sha256").update(content).digest("hex");
    if (manifest.templates[name]?.sha256 !== actual) failures.push(`${name} hash does not match manifest`);
  }
  const demo = await fs.readFile(path.join(root, "prompts", "demo-modi.md"), "utf8");
  const rules = await fs.readFile(path.join(root, "prompts", "gedragsregels.md"), "utf8");
  for (const [description, expression] of [
    ["five routines", /Routine 1[\s\S]*Routine 2[\s\S]*Routine 3[\s\S]*Routine 4[\s\S]*Routine 5/],
    ["routine 3 provisional", /Routine 3[\s\S]{0,300}(voorlopig|provisioneel)/i],
    ["signal before web", /zoek_signaal[\s\S]{0,300}zoek_web/],
    ["camera response bound", /1[–-]2 zinnen/],
    ["participant evidence", /deelnemer[\s\S]{0,200}(expliciete|oogstnotities)/i],
  ] as const) {
    if (!expression.test(`${demo}\n${rules}`)) failures.push(`Missing prompt invariant: ${description}`);
  }
  const envExample = await fs.readFile(path.join(root, ".env.example"), "utf8");
  for (const variable of [
    "AIDEN_ACTIVATION_SHORTCUT",
    "AIDEN_OPERATOR_SHORTCUT",
    "AIDEN_REALTIME_MODEL",
    "AIDEN_REALTIME_VOICE",
    "AIDEN_TRANSCRIPTION_MODEL",
    "AIDEN_TRANSCRIPTION_NAMES",
    "AIDEN_CAMERA_ID",
    "AIDEN_MICROPHONE_ID",
    "AIDEN_VISION_PATH",
    "AIDEN_RETENTION_DAYS",
  ]) {
    if (!envExample.includes(variable)) failures.push(`Missing .env.example setting: ${variable}`);
  }
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`Aiden prompt/config checks passed (${PROMPT_FILES.length} templates, manifest v${manifest.version}).`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
