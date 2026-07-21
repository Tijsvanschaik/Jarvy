import type { CameraFrame } from "../shared/types";

export const FACTUAL_VISION_INSTRUCTION =
  "Beschrijf beknopt in het Nederlands alleen wat feitelijk zichtbaar is. Let extra op flipovers en geschreven tekst. Maak duidelijk onderscheid tussen leesbare en onzekere tekst. Leid geen identiteiten, emoties, intenties of andere niet-zichtbare eigenschappen af.";

export type VisionCapabilities = {
  path: "provider";
  directRealtimeImages: false;
};

export interface VisionProvider {
  readonly capabilities: VisionCapabilities;
  describe(frames: CameraFrame[], signal?: AbortSignal): Promise<string>;
}

export type VisionErrorCode = "MISSING_KEY" | "TIMEOUT" | "REQUEST_FAILED" | "INVALID_RESPONSE";

export class VisionError extends Error {
  constructor(
    readonly code: VisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VisionError";
  }
}

export class OpenAIVisionProvider implements VisionProvider {
  readonly capabilities: VisionCapabilities = { path: "provider", directRealtimeImages: false };

  constructor(
    private readonly apiKey: () => string | undefined,
    private readonly model = "gpt-4.1-mini",
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async describe(frames: CameraFrame[], signal?: AbortSignal): Promise<string> {
    const key = this.apiKey();
    if (!key) throw new VisionError("MISSING_KEY", "OpenAI is niet geconfigureerd voor camerabeeld.");
    if (!frames.length) throw new VisionError("INVALID_RESPONSE", "Er is geen camerabeeld ontvangen.");

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          max_output_tokens: 300,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: FACTUAL_VISION_INSTRUCTION },
                ...frames.map((frame) => ({
                  type: "input_image",
                  image_url: `data:${frame.mediaType};base64,${frame.data}`,
                  detail: "high",
                })),
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new VisionError("REQUEST_FAILED", `Beeldanalyse mislukte (${response.status}).`);
      }
      const value = (await response.json()) as {
        output_text?: unknown;
        output?: Array<{ content?: Array<{ text?: unknown }> }>;
      };
      const text =
        typeof value.output_text === "string"
          ? value.output_text
          : value.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === "string")?.text;
      if (typeof text !== "string" || !text.trim()) {
        throw new VisionError("INVALID_RESPONSE", "De beeldanalyse gaf geen beschrijving terug.");
      }
      return text.trim();
    } catch (error) {
      if (error instanceof VisionError) throw error;
      if (controller.signal.aborted) throw new VisionError("TIMEOUT", "De beeldanalyse reageerde niet op tijd.");
      throw new VisionError("REQUEST_FAILED", "De beeldanalyse is tijdelijk niet beschikbaar.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
