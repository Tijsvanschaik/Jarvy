export type RecapStructuredRequest = {
  name: "recap_map" | "recap_deck";
  prompt: string;
  jsonSchema: Record<string, unknown>;
  validationErrors?: string;
  signal?: AbortSignal;
};

export interface RecapTextProvider {
  generate(request: RecapStructuredRequest): Promise<unknown>;
}

export class RecapProviderError extends Error {
  constructor(
    readonly code: "MISSING_KEY" | "TIMEOUT" | "REQUEST_FAILED" | "INVALID_JSON",
    message: string,
  ) {
    super(message);
    this.name = "RecapProviderError";
  }
}

export class OpenAIRecapProvider implements RecapTextProvider {
  constructor(
    private readonly apiKey: () => string | undefined,
    private readonly model = "gpt-4.1-mini",
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  async generate(request: RecapStructuredRequest): Promise<unknown> {
    const key = this.apiKey();
    if (!key) throw new RecapProviderError("MISSING_KEY", "OpenAI is niet geconfigureerd voor de recap.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          max_output_tokens: request.name === "recap_map" ? 700 : 3_000,
          input: [
            request.prompt,
            request.validationErrors
              ? `De vorige JSON was ongeldig. Herstel uitsluitend de JSON op basis van deze validatiefouten:\n${request.validationErrors}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          text: {
            format: {
              type: "json_schema",
              name: request.name,
              strict: true,
              schema: request.jsonSchema,
            },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RecapProviderError("REQUEST_FAILED", `Recapverzoek mislukte (${response.status}).`);
      }
      const value = (await response.json()) as {
        output_text?: unknown;
        output?: Array<{ content?: Array<{ text?: unknown }> }>;
      };
      const text =
        typeof value.output_text === "string"
          ? value.output_text
          : value.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === "string")?.text;
      if (typeof text !== "string") throw new RecapProviderError("INVALID_JSON", "Recapantwoord bevatte geen JSON.");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    } catch (error) {
      if (error instanceof RecapProviderError) throw error;
      if (controller.signal.aborted) throw new RecapProviderError("TIMEOUT", "De recap reageerde niet op tijd.");
      throw new RecapProviderError("REQUEST_FAILED", "De recap is tijdelijk niet beschikbaar.");
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
    }
  }
}
