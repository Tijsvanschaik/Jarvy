import path from "node:path";
import { PROMPT_FILES, PromptLoader, type PromptName } from "../main/promptLoader";
import { resolveRuntimePaths } from "../main/paths";

async function main(): Promise<void> {
  const [command = "status", rawName] = process.argv.slice(2);
  const loader = new PromptLoader(resolveRuntimePaths(process.cwd()), (warning) => console.warn(warning));
  if (command === "status" || command === "check") {
    const status = await loader.status();
    for (const item of status) console.log(`${item.name}: ${item.state}`);
    if (command === "check" && status.some((item) => item.state === "update-available")) process.exitCode = 1;
    return;
  }
  const name = parseName(rawName);
  if (command === "review") {
    const review = await loader.review(name);
    console.log(`--- runtime/${name}\n+++ shipped/${name}`);
    console.log(renderSimpleDiff(review.runtime, review.shipped));
    return;
  }
  if (command === "apply" || command === "reset") {
    const target = await loader.apply(name);
    console.log(`Applied shipped ${name} to ${path.relative(process.cwd(), target)}; prior local copy was backed up.`);
    return;
  }
  throw new Error("Usage: npm run prompts -- status|check|review <name>|apply <name>|reset <name>");
}

function parseName(value: string | undefined): PromptName {
  if (!value || !(PROMPT_FILES as readonly string[]).includes(value)) {
    throw new Error(`Template must be one of: ${PROMPT_FILES.join(", ")}`);
  }
  return value as PromptName;
}

function renderSimpleDiff(runtime: string, shipped: string): string {
  if (runtime === shipped) return "(identical)";
  return [
    ...runtime.split(/\r?\n/).map((line) => `- ${line}`),
    ...shipped.split(/\r?\n/).map((line) => `+ ${line}`),
  ].join("\n");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
