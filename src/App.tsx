import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Expand, History, Keyboard, Mic, MicOff, MonitorCog, PanelRight, Power, Send } from "lucide-react";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { AidenFace } from "./components/AidenFace";
import { ActivationController, type ActivationCloseReason } from "./main/activationController";
import { newEntry, AidenRealtimeClient, type MouthShape, type RealtimeTranscriptEntry, type AidenConnectionState, type AidenMood } from "./lib/realtime";
import { MicHub, type MicHubState, type RealtimeMicLease } from "./renderer/audio/micHub";
import type { OpsStateEvent } from "./shared/ipc";
import type { AidenArtifact } from "./shared/types";

type AidenMode = "display" | "computer";

export default function App() {
  const [connectionState, setConnectionState] = useState<AidenConnectionState>("idle");
  const [mood, setMood] = useState<AidenMood>("idle");
  const [mode, setMode] = useState<AidenMode>("display");
  const [artifact, setArtifact] = useState<AidenArtifact | null>(null);
  const [artifactVisible, setArtifactVisible] = useState(true);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showTypeInput, setShowTypeInput] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [mouthShape, setMouthShape] = useState<MouthShape>({ open: 0, width: 0.18, round: 0, teeth: 0 });
  const [transcript, setTranscript] = useState<RealtimeTranscriptEntry[]>([
    newEntry("system", "Aiden is ready. Connect, then talk naturally."),
  ]);
  const [status, setStatus] = useState("Click Connect, then talk or type.");
  const [textPrompt, setTextPrompt] = useState("");
  const [computerUseEnabled, setComputerUseEnabled] = useState(false);
  const [micHubState, setMicHubState] = useState<MicHubState>({ capture: "stopped", vadSpeech: false });
  const [opsState, setOpsState] = useState<OpsStateEvent | null>(null);
  const clientRef = useRef<AidenRealtimeClient | null>(null);
  const realtimeMicLeaseRef = useRef<RealtimeMicLease | null>(null);
  const micHubRef = useRef<MicHub | null>(null);
  const activationSourceRef = useRef<"ui" | "shortcut">("ui");
  const controllerRef = useRef<ActivationController | null>(null);

  if (!micHubRef.current) micHubRef.current = new MicHub(setMicHubState);
  if (!controllerRef.current) {
    controllerRef.current = new ActivationController(
      () => startSession(activationSourceRef.current),
      (reason) => stopSession(reason),
    );
  }

  const isConnected = connectionState === "connected";

  useEffect(() => {
    void window.aiden.getFeatures().then((features) => setComputerUseEnabled(features.computerUse));
    void window.aiden.getOpsState().then(setOpsState);
    const unsubscribe = window.aiden.onSessionToggle(() => {
      activationSourceRef.current = "shortcut";
      void controllerRef.current?.toggle("shortcut");
    });
    const unsubscribeOps = window.aiden.onOpsState(setOpsState);
    const unsubscribeTranscript = window.aiden.onTranscriptAppended((entry) => {
      if (entry.source === "assistant") return;
      setTranscript((items) => [
        {
          id: entry.id,
          role: entry.source === "assistant" ? ("aiden" as const) : ("user" as const),
          text: entry.text,
          at: new Date(entry.tsStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        },
        ...items,
      ].slice(0, 80));
    });
    return () => {
      unsubscribe();
      unsubscribeOps();
      unsubscribeTranscript();
      clientRef.current?.disconnect();
      realtimeMicLeaseRef.current?.release();
      void micHubRef.current?.dispose();
      controllerRef.current?.dispose();
    };
  }, []);

  async function startSession(source: "ui" | "shortcut") {
    setShowLog(true);
    setMicMuted(false);
    setMood("thinking");
    setConnectionState("connecting");
    setStatus("Aiden wordt geactiveerd en bouwt context…");
    try {
      await micHubRef.current?.start();
    } catch {
      // Realtime retains its permission-safe direct microphone fallback.
    }
    const activation = await window.aiden.activateSession({ source });
    if (!controllerRef.current?.isActive) {
      await window.aiden.closeSession({ reason: source });
      return;
    }
    const client = new AidenRealtimeClient({
      onConnectionState: (state) => {
        setConnectionState(state);
        if (state === "error") setShowLog(true);
        if (state !== "connected") setMicMuted(false);
      },
      onMood: setMood,
      onMouthShape: setMouthShape,
      onTranscript: (entry) => {
        setTranscript((items) => [entry, ...items].slice(0, 80));
        if (entry.role === "aiden") {
          window.aiden.assistantSaid({ id: entry.id, text: entry.text, at: entry.at });
        }
      },
      onArtifact: (nextArtifact) => {
        setArtifact(nextArtifact);
        setArtifactVisible(true);
        if (nextArtifact.fullscreen) setArtifactFullscreen(true);
      },
      onMode: (nextMode) => {
        setMode(nextMode);
        if (nextMode === "computer") {
          setArtifactVisible(false);
          setArtifactFullscreen(false);
          setShowLog(false);
          setShowTypeInput(false);
          setMicMuted(false);
        } else {
          setArtifactVisible(true);
        }
      },
      onStatus: (message) => {
        setStatus(message);
        setTranscript((items) => [newEntry("system", message), ...items].slice(0, 80));
      },
      onThumbnailReady: playThumbnailReadySound,
      onActivity: () => controllerRef.current?.activity(),
      onOutputPlayback: (playing) => micHubRef.current?.setAidenOutputPlaying(playing),
    });
    clientRef.current = client;
    realtimeMicLeaseRef.current = micHubRef.current?.createRealtimeBranch() ?? null;
    await client.connect(activation, realtimeMicLeaseRef.current?.stream);
  }

  async function stopSession(reason: ActivationCloseReason) {
    clientRef.current?.disconnect();
    clientRef.current = null;
    realtimeMicLeaseRef.current?.release();
    realtimeMicLeaseRef.current = null;
    setMicMuted(false);
    setConnectionState("idle");
    setMood("idle");
    setStatus(reason === "inactivity" ? "Sessie gesloten na 20 seconden inactiviteit." : "Aiden is niet actief.");
    await window.aiden.closeSession({ reason });
  }

  function toggleActivation(source: "ui" | "shortcut") {
    activationSourceRef.current = source;
    void controllerRef.current?.toggle(source).catch((error: unknown) => {
      setConnectionState("error");
      setMood("error");
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }

  function toggleMute() {
    if (!isConnected) {
      setStatus("Click Connect first, then mute/unmute.");
      return;
    }
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    clientRef.current?.setMuted(nextMuted);
  }

  async function toggleAmbientCapture() {
    if (micHubState.capture === "stopped" || micHubState.capture === "error") {
      try {
        await micHubRef.current?.start();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    await micHubRef.current?.stop();
  }

  function toggleAmbientMute() {
    micHubRef.current?.setAmbientMuted(micHubState.capture !== "muted");
  }

  async function switchMode(nextMode: AidenMode) {
    setMode(nextMode);
    const result = await window.aiden.executeTool({ name: "set_mode", arguments: { mode: nextMode } });
    if (result.artifact) setArtifact(result.artifact);
    if (nextMode === "computer") {
      setArtifactVisible(false);
      setArtifactFullscreen(false);
      setShowLog(false);
      setShowTypeInput(false);
    } else {
      setArtifactVisible(true);
    }
    setTranscript((items) => [newEntry("system", `Mode switched to ${nextMode}.`), ...items].slice(0, 80));
  }

  function sendTextPrompt() {
    const trimmed = textPrompt.trim();
    if (!trimmed) return;
    if (!clientRef.current?.isConnected) {
      setStatus("Click Connect first, then type.");
      setShowLog(true);
      return;
    }
    clientRef.current.sendText(trimmed);
    setTextPrompt("");
  }

  if (mode === "computer") {
    return (
      <main className="app-shell app-shell-mini">
        <section className="mini-companion" aria-label="Aiden computer use mini mode">
          <AidenFace mood={mood} mouthShape={mouthShape} />
          <button
            className="mini-restore-button"
            onClick={() => void switchMode("display")}
            aria-label="Return to full Aiden window"
            title="Return to full Aiden window"
          >
            <Expand size={14} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" />
      <div className="window-drag-left-zone" aria-hidden="true" />
      <section className="companion-window">
        <section className="face-stage">
          <AidenFace mood={mood} mouthShape={mouthShape} />
        </section>

        <footer className="bottom-console">
          <p
            className={`status-banner status-${connectionState}`}
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
          <div className="room-status" role="status">
            <span>Room: {micHubState.capture}</span>
            <span>VAD: {micHubState.vadSpeech ? "speech" : "quiet"}</span>
            <span>Queue: {opsState?.queue.depth ?? 0}</span>
            <span>Block: {opsState?.block ?? "1-welkom"}</span>
            {opsState?.queue.lastError ? <span className="room-error">{opsState.queue.lastError}</span> : null}
          </div>

          {showTypeInput ? (
            <section className="prompt-box">
              <input
                value={textPrompt}
                onChange={(event) => setTextPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendTextPrompt();
                }}
                autoFocus
                placeholder={isConnected ? "Type to Aiden..." : "Click Connect first, then type..."}
              />
              <button onClick={sendTextPrompt} aria-label="Send typed prompt" title="Send typed prompt">
                <Send size={15} />
              </button>
            </section>
          ) : null}

          <section className="control-strip">
            <button
              className={isConnected ? "simple-button active" : connectionState === "error" ? "simple-button danger" : "simple-button"}
              onClick={() => toggleActivation("ui")}
              disabled={connectionState === "connecting"}
              aria-label={isConnected ? "Deactivate Aiden" : "Activate Aiden"}
              title={isConnected ? "Deactivate Aiden" : "Activate Aiden"}
            >
              <Power size={16} />
            </button>
            <button
              className={micMuted ? "simple-button danger active" : "simple-button"}
              onClick={toggleMute}
              disabled={!isConnected}
              aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
              title={micMuted ? "Unmute mic" : "Mute mic"}
            >
              {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              className={micHubState.capture === "capturing" ? "simple-button active room-control" : "simple-button room-control"}
              onClick={() => void toggleAmbientCapture()}
              disabled={micHubState.capture === "starting"}
              aria-label={micHubState.capture === "stopped" ? "Start room capture" : "Stop room capture"}
              title={micHubState.capture === "stopped" ? "Start room capture" : "Stop room capture"}
            >
              Room
            </button>
            <button
              className={micHubState.capture === "muted" ? "simple-button danger active room-control" : "simple-button room-control"}
              onClick={toggleAmbientMute}
              disabled={!["capturing", "muted"].includes(micHubState.capture)}
              aria-label={micHubState.capture === "muted" ? "Resume room capture" : "Mute room capture"}
              title={micHubState.capture === "muted" ? "Resume room capture" : "Mute room capture"}
            >
              {micHubState.capture === "muted" ? "Resume" : "Pause"}
            </button>
            <button
              className={showTypeInput ? "simple-button active" : "simple-button"}
              onClick={() => {
                setShowTypeInput((value) => !value);
                if (!isConnected && connectionState !== "connecting") {
                  setStatus("Click Connect first, then type.");
                }
              }}
              aria-label="Type to Aiden"
              title="Type to Aiden"
            >
              <Keyboard size={16} />
            </button>
            <button
              className={mode === "display" ? "simple-button active" : "simple-button"}
              onClick={() => void switchMode("display")}
              aria-label="Display mode"
              title="Display mode"
            >
              <PanelRight size={16} />
            </button>
            {computerUseEnabled ? (
              <button
                className="simple-button danger"
                onClick={() => void switchMode("computer")}
                aria-label="Computer use mode"
                title="Computer use mode"
              >
                <MonitorCog size={16} />
              </button>
            ) : null}
            <button
              className={artifactVisible ? "simple-button active" : "simple-button"}
              onClick={() => setArtifactVisible((value) => !value)}
              aria-label="Toggle artifacts"
              title="Toggle artifacts"
            >
              <BrainCircuit size={16} />
            </button>
            <button
              className={showLog ? "simple-button active" : "simple-button"}
              onClick={() => setShowLog((value) => !value)}
              aria-label="Toggle live log"
              title="Toggle live log"
            >
              <History size={16} />
            </button>
          </section>
        </footer>

        {showLog ? (
          <section className="transcript">
            <div className="section-title">
              <span>Live Log</span>
              <small>{transcript.length} events</small>
            </div>
            <div className="transcript-list">
              {transcript.map((entry) => (
                <article className={`entry entry-${entry.role}`} key={entry.id}>
                  <div>
                    <strong>{entry.role === "aiden" ? "Aiden" : entry.role}</strong>
                    <time>{entry.at}</time>
                  </div>
                  <p>{entry.text}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <ArtifactPanel
        artifact={artifact}
        visible={artifactVisible}
        fullscreen={artifactFullscreen}
        onToggleVisible={() => setArtifactVisible((value) => !value)}
        onToggleFullscreen={() => setArtifactFullscreen((value) => !value)}
      />
    </main>
  );
}

function playThumbnailReadySound() {
  try {
    const AudioContextClass = window.AudioContext;
    const audio = new AudioContextClass();
    const gain = audio.createGain();
    const osc = audio.createOscillator();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, audio.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, audio.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.13);

    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.14);
    window.setTimeout(() => void audio.close(), 220);
  } catch {
    // Audio cues are optional; ignore browsers that block short sounds.
  }
}
