import { VadChunker } from "./chunker";
import { EnergyVad, resampleMono } from "./vad";
import { encodeMonoPcm16Wav } from "./wav";

export type CaptureState = "stopped" | "starting" | "capturing" | "muted" | "error";

export type MicHubState = {
  capture: CaptureState;
  vadSpeech: boolean;
  deviceId?: string;
  error?: string;
};

export type RealtimeMicLease = {
  stream: MediaStream;
  release: () => void;
};

export class MicHub {
  private sourceStream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private startPromise: Promise<void> | null = null;
  private resumeTimer = 0;
  private muted = false;
  private state: MicHubState = { capture: "stopped", vadSpeech: false };
  private readonly vad = new EnergyVad();
  private readonly chunker = new VadChunker((chunk) => {
    const wav = encodeMonoPcm16Wav(chunk.samples);
    window.ricky.submitAudioChunk({ wav, tsStart: chunk.tsStart, tsEnd: chunk.tsEnd });
  });

  constructor(private readonly onState: (state: MicHubState) => void) {
    navigator.mediaDevices?.addEventListener("devicechange", this.handleDeviceChange);
  }

  get currentState(): MicHubState {
    return this.state;
  }

  async start(deviceId?: string): Promise<void> {
    if (this.sourceStream) return;
    if (this.startPromise) return this.startPromise;
    this.setState({ capture: "starting", vadSpeech: false, deviceId });
    this.startPromise = this.acquire(deviceId).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  createRealtimeBranch(): RealtimeMicLease | null {
    const sourceTrack = this.sourceStream?.getAudioTracks()[0];
    if (!sourceTrack) return null;
    return createRealtimeTrackLease(sourceTrack);
  }

  setAmbientMuted(muted: boolean): void {
    if (!this.sourceStream) return;
    this.muted = muted;
    this.chunker.setPaused(muted);
    this.vad.reset();
    this.setState({ ...this.state, capture: muted ? "muted" : "capturing", vadSpeech: false, error: undefined });
  }

  setRickyOutputPlaying(playing: boolean): void {
    window.clearTimeout(this.resumeTimer);
    if (playing) {
      this.chunker.setPaused(true);
      this.vad.reset();
      this.setState({ ...this.state, vadSpeech: false });
      return;
    }
    this.resumeTimer = window.setTimeout(() => {
      if (!this.muted && this.sourceStream) this.chunker.setPaused(false);
    }, 500);
  }

  async stop(): Promise<void> {
    window.clearTimeout(this.resumeTimer);
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.silentGain?.disconnect();
    this.sourceStream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.sourceStream = null;
    this.context = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.silentGain = null;
    this.muted = false;
    this.chunker.reset();
    this.vad.reset();
    this.setState({ capture: "stopped", vadSpeech: false });
  }

  async dispose(): Promise<void> {
    navigator.mediaDevices?.removeEventListener("devicechange", this.handleDeviceChange);
    await this.stop();
  }

  private async acquire(deviceId?: string): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("No microphone audio track was returned.");
      track.addEventListener("ended", () => {
        if (this.sourceStream === stream) {
          this.setState({ ...this.state, capture: "error", vadSpeech: false, error: "Microphone disconnected." });
        }
      });

      const context = new AudioContext({ sampleRate: 16_000 });
      await context.audioWorklet.addModule(new URL("audio/pcm-capture-worklet.js", document.baseURI).href);
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "ricky-pcm-capture");
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(context.destination);
      worklet.port.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
        if (this.muted || !event.data?.samples) return;
        const samples = resampleMono(event.data.samples, event.data.sampleRate, 16_000);
        const vad = this.vad.process(samples);
        if (vad.speech !== this.state.vadSpeech) this.setState({ ...this.state, vadSpeech: vad.speech });
        this.chunker.feed(samples, vad.speech);
      };

      this.sourceStream = stream;
      this.context = context;
      this.sourceNode = source;
      this.workletNode = worklet;
      this.silentGain = silentGain;
      this.chunker.start();
      this.setState({
        capture: "capturing",
        vadSpeech: false,
        deviceId: track.getSettings().deviceId || deviceId,
      });
    } catch (error) {
      await this.stop();
      this.setState({
        capture: "error",
        vadSpeech: false,
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private readonly handleDeviceChange = (): void => {
    if (this.sourceStream && this.sourceStream.getAudioTracks().some((track) => track.readyState === "ended")) {
      this.setState({ ...this.state, capture: "error", vadSpeech: false, error: "Selected microphone is unavailable." });
    }
  };

  private setState(state: MicHubState): void {
    this.state = state;
    this.onState(state);
    window.ricky.reportCaptureState(state);
  }
}

export function createRealtimeTrackLease(
  sourceTrack: MediaStreamTrack,
  makeStream: (track: MediaStreamTrack) => MediaStream = (track) => new MediaStream([track]),
): RealtimeMicLease {
  const branchTrack = sourceTrack.clone();
  branchTrack.enabled = true;
  return {
    stream: makeStream(branchTrack),
    release: () => branchTrack.stop(),
  };
}
