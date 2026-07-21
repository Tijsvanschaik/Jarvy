import crypto from "node:crypto";
import { z } from "zod";
import {
  sessionActivatePayloadSchema,
  sessionActivateResultSchema,
  sessionClosePayloadSchema,
  type SessionActivateResult,
} from "../shared/ipc";
import type { AidenToolSpec } from "../shared/types";
import type { AidenConfig } from "./config";
import type { ContextBuilder } from "./contextBuilder";

const clientSecretResponseSchema = z.object({
  value: z.string().optional(),
  expires_at: z.number().optional(),
  client_secret: z
    .object({
      value: z.string(),
      expires_at: z.number().optional(),
    })
    .optional(),
});

export class SessionOrchestrator {
  private active = false;

  constructor(
    private readonly config: AidenConfig,
    private readonly contextBuilder: ContextBuilder,
    private readonly apiKey: () => string | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async activate(
    payload: unknown,
    tools: AidenToolSpec[],
    additionalInstructions = "",
  ): Promise<SessionActivateResult> {
    sessionActivatePayloadSchema.parse(payload);
    const key = this.apiKey();
    if (!key) throw new Error("OPENAI_API_KEY is missing in .env.local");

    const context = await this.contextBuilder.build();
    const instructions = [context.instructions, additionalInstructions].filter(Boolean).join("\n\n");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": crypto.createHash("sha256").update("aiden-local-desktop").digest("hex"),
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: this.config.realtimeModel,
            instructions,
            output_modalities: ["audio"],
            reasoning: { effort: "low" },
            tool_choice: "auto",
            tools,
            audio: {
              input: {
                turn_detection: {
                  type: "semantic_vad",
                  eagerness: "medium",
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: { voice: this.config.realtimeVoice },
            },
            tracing: { workflow_name: "Aiden Desktop Companion" },
          },
        }),
      });
    } catch (error) {
      throw new Error((error as Error).name === "AbortError" ? "Realtime token request timed out." : "Realtime token network request failed.");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Realtime token request failed (${providerGuidance(response.status)}).`);

    const secret = clientSecretResponseSchema.parse(await response.json());
    const value = secret.value || secret.client_secret?.value;
    if (!value) throw new Error("Realtime token response did not include a client secret value.");
    this.active = true;
    return sessionActivateResultSchema.parse({
      token: {
        value,
        expiresAt: secret.expires_at || secret.client_secret?.expires_at || null,
      },
      context: {
        totalTokens: context.totalTokens,
        sections: context.sections,
        warnings: context.warnings,
      },
    });
  }

  close(payload: unknown): void {
    sessionClosePayloadSchema.parse(payload);
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }
}

function providerGuidance(status: number): string {
  if (status === 401 || status === 403) return `auth ${status}; verify API key`;
  if (status === 429) return "quota/rate limit 429; review billing";
  if (status >= 500) return `provider/network ${status}; retry`;
  return `HTTP ${status}; verify realtime model access`;
}
