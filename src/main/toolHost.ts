import { z } from "zod";
import type { RickyToolResult, RickyToolSpec } from "../shared/types";

const toolResultSchema = z.object({ ok: z.boolean() }).loose();

export type ToolContext = { signal: AbortSignal };

export type ToolDefinition<TArgs extends z.ZodType = z.ZodType> = {
  name: string;
  args: TArgs;
  result?: z.ZodType<RickyToolResult>;
  parameters: Record<string, unknown>;
  description: string | (() => string);
  timeoutMs?: number;
  exposed?: boolean;
  handler: (args: any, context: ToolContext) => Promise<RickyToolResult> | RickyToolResult;
};

export type ToolInvocationErrorCode =
  | "UNKNOWN_TOOL"
  | "INVALID_ARGUMENTS"
  | "INVALID_RESULT"
  | "TIMEOUT"
  | "HANDLER_FAILURE"
  | "NOT_FOUND"
  | "DISABLED";

export class ToolHost {
  private readonly registry = new Map<string, ToolDefinition>();

  constructor(definitions: ToolDefinition[]) {
    for (const definition of definitions) {
      if (this.registry.has(definition.name)) throw new Error(`Duplicate tool '${definition.name}'.`);
      this.registry.set(definition.name, definition);
    }
  }

  specs(): RickyToolSpec[] {
    return [...this.registry.values()]
      .filter((tool) => tool.exposed !== false)
      .map((tool) => ({
        type: "function",
        name: tool.name,
        description: typeof tool.description === "function" ? tool.description() : tool.description,
        parameters: tool.parameters,
      }));
  }

  async invoke(name: string, rawArgs: unknown): Promise<RickyToolResult> {
    const tool = this.registry.get(name);
    if (!tool) return toolError("UNKNOWN_TOOL", `Unknown tool: ${name}`);
    if (tool.exposed === false) return toolError("DISABLED", `Tool is disabled: ${name}`);
    const args = tool.args.safeParse(rawArgs);
    if (!args.success) return toolError("INVALID_ARGUMENTS", z.prettifyError(args.error));

    const controller = new AbortController();
    const timeoutMs = tool.timeoutMs ?? 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve(tool.handler(args.data, { signal: controller.signal })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ToolTimeoutError());
          }, timeoutMs);
        }),
      ]);
      const validated = (tool.result ?? toolResultSchema).safeParse(result);
      return validated.success
        ? validated.data
        : toolError("INVALID_RESULT", `Tool '${name}' returned an invalid result: ${z.prettifyError(validated.error)}`);
    } catch (error) {
      if (error instanceof ToolTimeoutError) return toolError("TIMEOUT", `Tool '${name}' timed out after ${timeoutMs}ms.`);
      return toolError("HANDLER_FAILURE", error instanceof Error ? error.message : String(error));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  definitions(): ToolDefinition[] {
    return [...this.registry.values()];
  }
}

class ToolTimeoutError extends Error {}

export function toolError(code: ToolInvocationErrorCode, error: string, details?: Record<string, unknown>): RickyToolResult {
  return { ok: false, code, error, ...details };
}
