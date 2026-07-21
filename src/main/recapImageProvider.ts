import fs from "node:fs/promises";
import path from "node:path";

export interface RecapImageProvider {
  generate(prompt: string, slideId: string, outputDir: string, signal?: AbortSignal): Promise<string>;
}

export class OpenAIRecapImageProvider implements RecapImageProvider {
  constructor(
    private readonly apiKey: () => string | undefined,
    private readonly model = "gpt-image-2",
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async generate(prompt: string, slideId: string, outputDir: string, signal?: AbortSignal): Promise<string> {
    const key = this.apiKey();
    if (!key) throw new Error("OpenAI is niet geconfigureerd voor recapbeelden.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          size: "1536x1024",
          quality: "medium",
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Recapbeeld mislukte (${response.status}).`);
      const value = (await response.json()) as { data?: Array<{ b64_json?: unknown }> };
      const base64 = value.data?.[0]?.b64_json;
      if (typeof base64 !== "string" || !base64) throw new Error("Recapbeeld bevatte geen afbeeldingsdata.");
      await fs.mkdir(outputDir, { recursive: true });
      const safeId = slideId.replace(/[^a-zA-Z0-9_-]/g, "-");
      const target = path.join(outputDir, `${safeId}.png`);
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, Buffer.from(base64, "base64"));
      await fs.rename(temporary, target);
      return target;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Recapbeeld reageerde niet op tijd.");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
