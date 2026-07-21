import type { CameraCaptureRequest, CameraCaptureResponse } from "../../shared/ipc";
import { CameraCaptureError, CameraCaptureService } from "./cameraCapture";

export type CameraBridge = {
  onCameraCaptureRequest: (listener: (request: CameraCaptureRequest) => void) => () => void;
  respondCameraCapture: (response: CameraCaptureResponse) => void;
};

export function installCameraBridge(
  bridge: CameraBridge,
  service = new CameraCaptureService(),
): () => void {
  let busy = false;
  return bridge.onCameraCaptureRequest((request) => {
    if (busy) {
      bridge.respondCameraCapture({
        correlationId: request.correlationId,
        ok: false,
        code: "BUSY",
        error: "De camera is al bezig met een andere opname.",
      });
      return;
    }
    busy = true;
    void service
      .capture(request)
      .then((frames) => {
        bridge.respondCameraCapture({ correlationId: request.correlationId, ok: true, frames });
      })
      .catch((error: unknown) => {
        const mapped =
          error instanceof CameraCaptureError
            ? error
            : new CameraCaptureError("CAPTURE_FAILED", "Het camerabeeld kon niet worden vastgelegd.");
        bridge.respondCameraCapture({
          correlationId: request.correlationId,
          ok: false,
          code: mapped.code,
          error: mapped.message,
        });
      })
      .finally(() => {
        busy = false;
      });
  });
}
