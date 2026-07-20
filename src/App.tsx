import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Expand, History, Keyboard, Mic, MicOff, MonitorCog, PanelRight, Power, Send } from "lucide-react";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { RickyFace } from "./components/RickyFace";
import { ActivationController, type ActivationCloseReason } from "./main/activationController";
import { newEntry, RickyRealtimeClient, type MouthShape, type RickyConnectionState, type RickyMood, type TranscriptEntry } from "./lib/realtime";
import type { RickyArtifact } from "./shared/types";

type RickyMode = "display" | "computer";

export default function App() {
  const [connectionState, setConnectionState] = useState<RickyConnectionState>("idle");
  const [mood, setMood] = useState<RickyMood>("idle");
  const [mode, setMode] = useState<RickyMode>("display");
  const [artifact, setArtifact] = useState<RickyArtifact | null>(null);
  const [artifactVisible, setArtifactVisible] = useState(true);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showTypeInput, setShowTypeInput] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [mouthShape, setMouthShape] = useState<MouthShape>({ open: 0, width: 0.18, round: 0, teeth: 0 });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    newEntry("system", "Ricky is ready. Connect, then talk naturally."),
  ]);
  const [status, setStatus] = useState("Click Connect, then talk or type.");
  const [textPrompt, setTextPrompt] = useState("");
  const [computerUseEnabled, setComputerUseEnabled] = useState(false);
  const clientRef = useRef<RickyRealtimeClient | null>(null);
  const activationSourceRef = useRef<"ui" | "shortcut">("ui");
  const controllerRef = useRef<ActivationController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new ActivationController(
      () => startSession(activationSourceRef.current),
      (reason) => stopSession(reason),
    );
  }

  const isConnected = connectionState === "connected";

  useEffect(() => {
    void window.ricky.getFeatures().then((features) => setComputerUseEnabled(features.computerUse));
    const unsubscribe = window.ricky.onSessionToggle(() => {
      activationSourceRef.current = "shortcut";
      void controllerRef.current?.toggle("shortcut");
    });
    return () => {
      unsubscribe();
      clientRef.current?.disconnect();
      controllerRef.current?.dispose();
    };
  }, []);

  async function startSession(source: "ui" | "shortcut") {
    setShowLog(true);
    setMicMuted(false);
    setMood("thinking");
    setConnectionState("connecting");
    setStatus("Ricky wordt geactiveerd en bouwt context…");
    const activation = await window.ricky.activateSession({ source });
    if (!controllerRef.current?.isActive) {
      await window.ricky.closeSession({ reason: source });
      return;
    }
    const client = new RickyRealtimeClient({
      onConnectionState: (state) => {
        setConnectionState(state);
        if (state === "error") setShowLog(true);
        if (state !== "connected") setMicMuted(false);
      },
      onMood: setMood,
      onMouthShape: setMouthShape,
      onTranscript: (entry) => {
        setTranscript((items) => [entry, ...items].slice(0, 80));
        if (entry.role === "ricky") {
          window.ricky.assistantSaid({ id: entry.id, text: entry.text, at: entry.at });
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
    });
    clientRef.current = client;
    await client.connect(activation);
  }

  async function stopSession(reason: ActivationCloseReason) {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setMicMuted(false);
    setConnectionState("idle");
    setMood("idle");
    setStatus(reason === "inactivity" ? "Sessie gesloten na 20 seconden inactiviteit." : "Ricky is niet actief.");
    await window.ricky.closeSession({ reason });
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

  async function switchMode(nextMode: RickyMode) {
    setMode(nextMode);
    const result = await window.ricky.executeTool({ name: "set_mode", arguments: { mode: nextMode } });
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
        <section className="mini-companion" aria-label="Ricky computer use mini mode">
          <RickyFace mood={mood} mouthShape={mouthShape} />
          <button
            className="mini-restore-button"
            onClick={() => void switchMode("display")}
            aria-label="Return to full Ricky window"
            title="Return to full Ricky window"
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
          <RickyFace mood={mood} mouthShape={mouthShape} />
        </section>

        <footer className="bottom-console">
          <p
            className={`status-banner status-${connectionState}`}
            role="status"
            aria-live="polite"
          >
            {status}
          </p>

          {showTypeInput ? (
            <section className="prompt-box">
              <input
                value={textPrompt}
                onChange={(event) => setTextPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendTextPrompt();
                }}
                autoFocus
                placeholder={isConnected ? "Type to Ricky..." : "Click Connect first, then type..."}
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
              aria-label={isConnected ? "Deactivate Ricky" : "Activate Ricky"}
              title={isConnected ? "Deactivate Ricky" : "Activate Ricky"}
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
              className={showTypeInput ? "simple-button active" : "simple-button"}
              onClick={() => {
                setShowTypeInput((value) => !value);
                if (!isConnected && connectionState !== "connecting") {
                  setStatus("Click Connect first, then type.");
                }
              }}
              aria-label="Type to Ricky"
              title="Type to Ricky"
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
                    <strong>{entry.role === "ricky" ? "Ricky" : entry.role}</strong>
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
