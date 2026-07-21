import { describe, expect, it, vi } from "vitest";
import { createTargetToolHost } from "./targetTools";

describe("target Aiden registry", () => {
  it("exposes only target tools and builds the signal index dynamically", async () => {
    const signals = {
      compactIndex: () => [{ id: "demo-een", titel: "Demo", laag: 1, domein: "sociaal", type: "zacht" }],
      find: async () => undefined,
    };
    const host = createTargetToolHost({
      signals: signals as never,
      board: {} as never,
      notes: {} as never,
      generateImage: async () => ({ ok: true }),
      searchWeb: async () => ({ ok: true }),
    });
    expect(host.specs().map((spec) => spec.name)).toEqual([
      "zoek_signaal", "toon_op_bord", "maak_notitie", "genereer_beeld", "zoek_web",
    ]);
    expect(host.specs()[0].description).toContain("demo-een");
    expect(await host.invoke("zoek_signaal", { id: "onbekend" })).toMatchObject({
      ok: false,
      validIndex: [{ id: "demo-een" }],
    });
  });

  it("feature-gates webcam and recap while keeping one registry", async () => {
    const look = vi.fn(async () => "Een flipover met drie leesbare woorden.");
    const start = vi.fn(() => ({ started: true }));
    const host = createTargetToolHost({
      signals: { compactIndex: () => [], find: async () => undefined } as never,
      board: {} as never,
      notes: {} as never,
      generateImage: async () => ({ ok: true }),
      searchWeb: async () => ({ ok: true }),
      cameraVision: { enabled: true, look },
      recap: { enabled: true, start },
    });
    expect(host.specs().map((spec) => spec.name)).toEqual([
      "zoek_signaal", "toon_op_bord", "maak_notitie", "genereer_beeld", "zoek_web", "kijk_mee", "start_recap",
    ]);
    expect(await host.invoke("kijk_mee", { frames: 3 })).toMatchObject({ ok: true, beschrijving: expect.any(String) });
    expect(look).toHaveBeenCalledWith(3, expect.any(AbortSignal));
    expect(await host.invoke("start_recap", {})).toMatchObject({ ok: true, started: true });
    expect(start).toHaveBeenCalledOnce();
  });
});
