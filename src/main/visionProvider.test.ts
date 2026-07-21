import { afterEach, describe, expect, it, vi } from "vitest";
import { FACTUAL_VISION_INSTRUCTION, OpenAIVisionProvider } from "./visionProvider";

afterEach(() => vi.useRealTimers());

const frame = { mediaType: "image/jpeg" as const, data: "abc123", width: 1024, height: 576 };

describe("OpenAIVisionProvider", () => {
  it("sends transient frames with the factual Dutch instruction", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ output_text: "Een flipover met leesbare tekst." }), { status: 200 }));
    const provider = new OpenAIVisionProvider(() => "test-key", "vision-test", fetcher as typeof fetch);

    await expect(provider.describe([frame])).resolves.toBe("Een flipover met leesbare tekst.");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("vision-test");
    expect(body.input[0].content[0].text).toBe(FACTUAL_VISION_INSTRUCTION);
    expect(body.input[0].content[1]).toEqual({
      type: "input_image",
      image_url: "data:image/jpeg;base64,abc123",
      detail: "high",
    });
    expect(JSON.stringify(body)).toContain("Leid geen identiteiten, emoties");
  });

  it("uses a bounded timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    );
    const provider = new OpenAIVisionProvider(() => "test-key", "vision-test", fetcher as typeof fetch, 1_000);
    const request = provider.describe([frame]);
    const rejection = expect(request).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });

  it("does not make a request without a main-process key", async () => {
    const fetcher = vi.fn();
    const provider = new OpenAIVisionProvider(() => undefined, "vision-test", fetcher as typeof fetch);
    await expect(provider.describe([frame])).rejects.toMatchObject({ code: "MISSING_KEY" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
