import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraCaptureService, clampFrameCount, mapCameraError, scaledFrameSize } from "./cameraCapture";

afterEach(() => vi.useRealTimers());

describe("camera capture helpers", () => {
  it("clamps frame counts and scales without enlarging", () => {
    expect(clampFrameCount(undefined)).toBe(1);
    expect(clampFrameCount(0)).toBe(1);
    expect(clampFrameCount(9)).toBe(3);
    expect(scaledFrameSize(1280, 720)).toEqual({ width: 1024, height: 576 });
    expect(scaledFrameSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it.each([
    ["NotAllowedError", "DENIED"],
    ["NotFoundError", "NOT_FOUND"],
    ["NotReadableError", "BUSY"],
  ])("maps %s to %s", (name, code) => {
    expect(mapCameraError(Object.assign(new Error("native"), { name })).code).toBe(code);
  });
});

describe("CameraCaptureService", () => {
  it("captures requested JPEG frames and always stops tracks", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/jpeg;base64,FRAME");
    const service = new CameraCaptureService({
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream),
      createVideo: () =>
        ({
          muted: false,
          playsInline: false,
          srcObject: null,
          videoWidth: 1280,
          videoHeight: 720,
          play: vi.fn(async () => undefined),
          pause: vi.fn(),
        }) as unknown as HTMLVideoElement,
      createCanvas: () =>
        ({
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL,
        }) as unknown as HTMLCanvasElement,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });

    const promise = service.capture({ frames: 2, timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    const frames = await promise;

    expect(frames).toEqual([
      { mediaType: "image/jpeg", data: "FRAME", width: 1024, height: 576 },
      { mediaType: "image/jpeg", data: "FRAME", width: 1024, height: 576 },
    ]);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.7);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops a stream that arrives after timeout", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    let resolveMedia!: (stream: MediaStream) => void;
    const service = new CameraCaptureService({
      getUserMedia: () => new Promise((resolve) => { resolveMedia = resolve; }),
      createVideo: vi.fn(),
      createCanvas: vi.fn(),
      sleep: vi.fn(),
    });

    const capture = service.capture({ timeoutMs: 1_000 });
    const rejection = expect(capture).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    resolveMedia({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
});
