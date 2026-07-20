import crypto from "node:crypto";
import { z } from "zod";
import {
  sessionActivatePayloadSchema,
  sessionActivateResultSchema,
  sessionClosePayloadSchema,
  type SessionActivateResult,
} from "../shared/ipc";
import type { RickyToolSpec } from "../shared/types";
import type { RickyConfig } from "./config";
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
    private readonly config: RickyConfig,
    private readonly contextBuilder: ContextBuilder,
    private readonly apiKey: () => string | undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async activate(
    payload: unknown,
    tools: RickyToolSpec[],
    additionalInstructions = "",
  ): Promise<SessionActivateResult> {
    sessionActivatePayloadSchema.parse(payload);
    const key = this.apiKey();
    if (!key) throw new Error("OPENAI_API_KEY is missing in .env.local");

    const context = await this.contextBuilder.build();
    const instructions = [context.instructions, additionalInstructions].filter(Boolean).join("\n\n");
    const response = await this.fetcher("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": crypto.createHash("sha256").update("ricky-local-desktop").digest("hex"),
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
          tracing: { workflow_name: "Ricky Desktop Companion" },
        },
      }),
    });
    if (!response.ok) throw new Error(`Realtime token request failed: ${response.status} ${await response.text()}`);

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
