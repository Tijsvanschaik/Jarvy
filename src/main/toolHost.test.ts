import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolHost, type ToolDefinition } from "./toolHost";

const parameters = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};

describe("ToolHost", () => {
  it("uses one registry for exposed specs and argument schemas", async () => {
    const handler = vi.fn(async ({ value }: { value: string }) => ({ ok: true, value }));
    const definitions: ToolDefinition[] = [{
      name: "echo",
      description: "Echo",
      parameters,
      args: z.object({ value: z.string() }).strict(),
      handler,
    }];
    const host = new ToolHost(definitions);
    expect(host.specs()).toEqual([{ type: "function", name: "echo", description: "Echo", parameters }]);
    expect((await host.invoke("echo", {})).code).toBe("INVALID_ARGUMENTS");
    expect(await host.invoke("echo", { value: "yes" })).toMatchObject({ ok: true, value: "yes" });
  });

  it("returns structured unknown, timeout and handler errors", async () => {
    const host = new ToolHost([
      {
        name: "slow", description: "Slow", parameters: {}, args: z.object({}),
        timeoutMs: 5, handler: () => new Promise(() => undefined),
      },
      {
        name: "broken", description: "Broken", parameters: {}, args: z.object({}),
        handler: () => { throw new Error("boom"); },
      },
    ]);
    expect((await host.invoke("missing", {})).code).toBe("UNKNOWN_TOOL");
    expect((await host.invoke("slow", {})).code).toBe("TIMEOUT");
    expect(await host.invoke("broken", {})).toMatchObject({ ok: false, code: "HANDLER_FAILURE", error: "boom" });
  });

  it("rejects invalid handler results", async () => {
    const host = new ToolHost([{
      name: "bad-result", description: "Bad", parameters: {}, args: z.object({}),
      handler: async () => ({ value: true } as never),
    }]);
    expect((await host.invoke("bad-result", {})).code).toBe("INVALID_RESULT");
  });
});
