import type { CameraFramePayload } from "../../shared/ipc";

export type CameraCaptureErrorCode = "DENIED" | "NOT_FOUND" | "BUSY" | "TIMEOUT" | "CAPTURE_FAILED";

export class CameraCaptureError extends Error {
  constructor(
    readonly code: CameraCaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CameraCaptureError";
  }
}

type CaptureDependencies = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createVideo: () => HTMLVideoElement;
  createCanvas: () => HTMLCanvasElement;
  sleep: (milliseconds: number) => Promise<void>;
};

const browserDependencies: CaptureDependencies = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createVideo: () => document.createElement("video"),
  createCanvas: () => document.createElement("canvas"),
  sleep: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
};

export function clampFrameCount(value: unknown): 1 | 2 | 3 {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 1;
  return Math.max(1, Math.min(3, number)) as 1 | 2 | 3;
}

export function scaledFrameSize(width: number, height: number, maxWidth = 1024): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new CameraCaptureError("CAPTURE_FAILED", "De camera leverde geen geldig beeld.");
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export class CameraCaptureService {
  constructor(private readonly deps: CaptureDependencies = browserDependencies) {}

  async capture(options: { frames?: number; cameraId?: string; timeoutMs?: number }): Promise<CameraFramePayload[]> {
    const count = clampFrameCount(options.frames);
    const timeoutMs = Math.max(1_000, Math.min(30_000, options.timeoutMs ?? 8_000));
    const deadline = Date.now() + timeoutMs;
    let stream: MediaStream | undefined;
    let timedOut = false;
    const mediaPromise = this.deps.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        ...(options.cameraId ? { deviceId: { exact: options.cameraId } } : {}),
      },
    });
    mediaPromise.then((lateStream) => {
      if (timedOut) stopTracks(lateStream);
    }).catch(() => undefined);

    try {
      stream = await raceTimeout(mediaPromise, remaining(deadline), () => {
        timedOut = true;
      });
      const video = this.deps.createVideo();
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await raceTimeout(Promise.resolve(video.play()), remaining(deadline));
      if (!video.videoWidth || !video.videoHeight) {
        await raceTimeout(waitForMetadata(video), remaining(deadline));
      }

      const frames: CameraFramePayload[] = [];
      for (let index = 0; index < count; index += 1) {
        if (index > 0) await raceTimeout(this.deps.sleep(1_000), remaining(deadline));
        frames.push(drawFrame(video, this.deps.createCanvas()));
      }
      video.pause();
      video.srcObject = null;
      return frames;
    } catch (error) {
      throw mapCameraError(error);
    } finally {
      if (stream) stopTracks(stream);
    }
  }
}

function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): CameraFramePayload {
  const size = scaledFrameSize(video.videoWidth, video.videoHeight);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new CameraCaptureError("CAPTURE_FAILED", "Het camerabeeld kon niet worden verwerkt.");
  context.drawImage(video, 0, 0, size.width, size.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new CameraCaptureError("CAPTURE_FAILED", "Het camerabeeld kon niet worden gecodeerd.");
  return { mediaType: "image/jpeg", data: dataUrl.slice(separator + 1), ...size };
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new CameraCaptureError("CAPTURE_FAILED", "De camera leverde geen beeld."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("error", failed);
    };
    video.addEventListener("loadedmetadata", ready, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

async function raceTimeout<T>(promise: Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new CameraCaptureError("TIMEOUT", "De camera reageerde niet op tijd."));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export function mapCameraError(error: unknown): CameraCaptureError {
  if (error instanceof CameraCaptureError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new CameraCaptureError("DENIED", "Cameratoegang is geweigerd. Sta de camera toe en probeer opnieuw.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new CameraCaptureError("NOT_FOUND", "De gekozen camera is niet gevonden.");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return new CameraCaptureError("BUSY", "De camera is bezet door een andere app.");
  }
  return new CameraCaptureError("CAPTURE_FAILED", "Het camerabeeld kon niet worden vastgelegd.");
}
