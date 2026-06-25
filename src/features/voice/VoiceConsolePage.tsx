import { useCallback, useEffect, useReducer, useRef, useState, type MutableRefObject } from "react";
import { MessageSquareText, Mic, PhoneCall, Send, Square, TriangleAlert } from "lucide-react";

import {
  createVoiceSocket,
  reduceVoiceEvent,
  type VoiceSocketClient,
  type VoiceServerEvent,
  type VoiceState,
  type VoiceStatus,
} from "@/client/voiceSocket";
import { apiPath, authHeaders, getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Agent, Call, CallEvent, ModelRuntime, Voice } from "@/domain/types";
import { formatVoiceOption, sortVoicesForDisplay } from "@/domain/voiceLabels";
import { cn } from "@/lib/utils";

const voiceSegmentMs = 2200;
const nextSegmentDelayMs = 150;

const initialVoiceState: VoiceState = {
  status: "idle",
  transcript: [],
  audioQueue: [],
  error: null,
};

export function VoiceConsolePage() {
  const [voiceState, dispatchVoiceEvent] = useReducer(reduceVoiceEvent, initialVoiceState);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [runtimes, setRuntimes] = useState<ModelRuntime[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [simulatedCall, setSimulatedCall] = useState<Call | null>(null);
  const [simulatedEvents, setSimulatedEvents] = useState<CallEvent[]>([]);
  const [simulatedText, setSimulatedText] = useState("नमस्ते, म एउटा परीक्षण कल गर्दैछु।");
  const [simulatedVoiceId, setSimulatedVoiceId] = useState("voice_lipi_ml_ne");
  const [simulatedState, setSimulatedState] = useState<"idle" | "starting" | "sending" | "failed">("idle");
  const [simulatedError, setSimulatedError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<VoiceSocketClient | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const awaitingServerResponseRef = useRef(false);
  const lastServerStatusRef = useRef<VoiceStatus | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const nextSessionIdRef = useRef(0);
  const isCleaningUpRef = useRef(false);
  const isMountedRef = useRef(true);

  const error = localError ?? voiceState.error;
  const isRecording = voiceState.status !== "idle" && voiceState.status !== "stopped" && voiceState.status !== "failed";
  const simulatedTranscript = simulatedEvents.filter((event) => event.type === "transcript");
  const simulatedAudio = simulatedEvents.filter(
    (event) =>
      event.type === "audio" &&
      typeof event.payload.audioBase64 === "string" &&
      typeof event.payload.mimeType === "string",
  );
  const simulatorVoices = voices.filter((voice) => voice.language === "ne-NP" || voice.language.startsWith("ne"));

  useEffect(() => {
    let isCurrent = true;

    void Promise.all([
      getJson<Agent[]>("/api/agents"),
      getJson<Voice[]>("/api/voices").catch(() => []),
      getJson<ModelRuntime[]>("/api/model-runtimes").catch(() => []),
    ])
      .then(([nextAgents, nextVoices, nextRuntimes]) => {
        if (!isCurrent) {
          return;
        }

        setAgents(nextAgents);
        setVoices(sortVoicesForDisplay(nextVoices));
        setRuntimes(nextRuntimes);
        setSelectedAgentId((currentAgentId) => currentAgentId || nextAgents[0]?.id || "");
        setSimulatedVoiceId((currentVoiceId) => {
          if (nextVoices.some((voice) => voice.id === currentVoiceId)) {
            return currentVoiceId;
          }

          return nextVoices.find((voice) => voice.tags.includes("native-target"))?.id ??
            nextVoices.find((voice) => voice.id === "voice_lipi_ml_ne")?.id ??
            nextVoices.find((voice) => voice.language === "ne-NP" || voice.language.startsWith("ne"))?.id ??
            currentVoiceId;
        });
      })
      .catch(() => {
        if (isCurrent) {
          setLocalError("agents_load_failed");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const cleanupSession = useCallback(
    ({
      status = "stopped",
      reason = null,
      updateState = true,
    }: {
      status?: Extract<VoiceStatus, "stopped" | "failed">;
      reason?: string | null;
      updateState?: boolean;
    } = {}) => {
      if (isCleaningUpRef.current) {
        return;
      }

      isCleaningUpRef.current = true;
      activeSessionIdRef.current = null;
      awaitingServerResponseRef.current = false;
      lastServerStatusRef.current = null;
      clearTimer(segmentTimerRef);
      clearTimer(restartTimerRef);

      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The recorder may already be stopping; cleanup continues for the socket and tracks.
        }
      }

      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();

      stopStream(streamRef.current);
      streamRef.current = null;

      if (updateState && isMountedRef.current) {
        setLocalError(reason);
        setSessionExpiresAt(null);
        dispatchVoiceEvent({ type: "status", status, reason: reason ?? undefined });
      }

      isCleaningUpRef.current = false;
    },
    [],
  );

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupSession({ updateState: false });
    };
  }, [cleanupSession]);

  async function startSession() {
    if (!selectedAgentId) {
      setLocalError("agent_required");
      return;
    }

    setLocalError(null);
    setSessionExpiresAt(null);
    dispatchVoiceEvent({ type: "status", status: "connecting" });
    const sessionId = nextSessionIdRef.current + 1;
    nextSessionIdRef.current = sessionId;
    activeSessionIdRef.current = sessionId;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (activeSessionIdRef.current === sessionId) {
        cleanupSession({ status: "failed", reason: "mic_permission_denied" });
      }
      return;
    }

    if (activeSessionIdRef.current !== sessionId) {
      stopStream(stream);
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      streamRef.current = stream;
      cleanupSession({ status: "failed", reason: "media_recorder_unsupported" });
      return;
    }

    streamRef.current = stream;

    let realtimeSession: RealtimeSessionResponse;
    try {
      realtimeSession = await createRealtimeSession(selectedAgentId);
    } catch {
      cleanupSession({ status: "failed", reason: "realtime_session_failed" });
      return;
    }

    if (activeSessionIdRef.current !== sessionId) {
      return;
    }
    setSessionExpiresAt(realtimeSession.expiresAt);

    const socket = createVoiceSocket(getRealtimeSocketUrl(realtimeSession.token), {
      onOpen() {
        if (activeSessionIdRef.current !== sessionId) {
          return;
        }

        dispatchVoiceEvent({ type: "status", status: "listening" });
        startRecordingSegment(sessionId);
      },
      onEvent(event) {
        if (activeSessionIdRef.current !== sessionId) {
          return;
        }

        dispatchVoiceEvent(event);
        continueCaptureAfterServerEvent(event, sessionId);
      },
      onError(reason) {
        if (activeSessionIdRef.current !== sessionId) {
          return;
        }

        cleanupSession({ status: "failed", reason });
      },
      onClose() {
        if (activeSessionIdRef.current !== sessionId) {
          return;
        }

        cleanupSession({ status: "stopped" });
      },
    });
    socketRef.current = socket;
  }

  function startRecordingSegment(sessionId: number) {
    if (activeSessionIdRef.current !== sessionId || awaitingServerResponseRef.current || isCleaningUpRef.current) {
      return;
    }

    const stream = streamRef.current;
    if (!stream) {
      return;
    }

    clearTimer(segmentTimerRef);
    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      let receivedAudio = false;
      recorder.ondataavailable = (event) => {
        if (activeSessionIdRef.current !== sessionId) {
          return;
        }

        if (event.data.size === 0) {
          return;
        }

        receivedAudio = true;
        void sendRecordedBlob(event.data, sessionId);
      };
      recorder.onstop = () => {
        if (recorderRef.current === recorder) {
          recorderRef.current = null;
        }

        if (!receivedAudio && activeSessionIdRef.current === sessionId && !isCleaningUpRef.current) {
          scheduleNextSegment(sessionId);
        }
      };
      recorder.start();
      segmentTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }, voiceSegmentMs);
    } catch {
      cleanupSession({ status: "failed", reason: "media_recorder_failed" });
    }
  }

  function continueCaptureAfterServerEvent(event: VoiceServerEvent, sessionId: number) {
    if (event.type === "status" && "status" in event && isVoiceStatusValue(event.status)) {
      const previousStatus = lastServerStatusRef.current;
      const status = event.status;
      lastServerStatusRef.current = status;

      if (status === "failed") {
        cleanupSession({
          status: "failed",
          reason: "reason" in event && typeof event.reason === "string" ? event.reason : "processing_failed",
        });
        return;
      }

      if (awaitingServerResponseRef.current && status === "listening" && previousStatus === "thinking") {
        awaitingServerResponseRef.current = false;
        scheduleNextSegment(sessionId);
      }

      return;
    }

    if (event.type === "audio" && awaitingServerResponseRef.current) {
      awaitingServerResponseRef.current = false;
      scheduleNextSegment(sessionId);
    }
  }

  function scheduleNextSegment(sessionId: number) {
    clearTimer(restartTimerRef);
    restartTimerRef.current = window.setTimeout(() => {
      startRecordingSegment(sessionId);
    }, nextSegmentDelayMs);
  }

  function stopSession() {
    cleanupSession({ status: "stopped" });
  }

  async function sendRecordedBlob(blob: Blob, sessionId: number) {
    const audioBase64 = await blobToBase64(blob);

    if (activeSessionIdRef.current !== sessionId) {
      return;
    }

    awaitingServerResponseRef.current = true;
    socketRef.current?.send({
      type: "audio_chunk",
      mimeType: blob.type || "audio/webm",
      audioBase64,
    });
  }

  async function startSimulatedCall() {
    if (!selectedAgentId) {
      setSimulatedError("agent_required");
      return null;
    }

    setSimulatedState("starting");
    setSimulatedError(null);

    try {
      const result = await postJson<{ call: Call; events: CallEvent[] }>("/api/calls/simulate", {
        agentId: selectedAgentId,
      });
      setSimulatedCall(result.call);
      setSimulatedEvents(result.events);
      setSimulatedState("idle");

      return result.call;
    } catch {
      setSimulatedState("failed");
      setSimulatedError("simulation_start_failed");
      return null;
    }
  }

  async function sendSimulatedTurn() {
    const text = simulatedText.trim();
    if (!text) {
      return;
    }

    setSimulatedState("sending");
    setSimulatedError(null);

    const call = simulatedCall ?? await startSimulatedCall();
    if (!call) {
      return;
    }

    const selectedVoiceRuntime = runtimes.find((runtime) => runtime.id === voices.find((voice) => voice.id === simulatedVoiceId)?.runtimeId);
    const ttsProvider = selectedVoiceRuntime?.adapter === "google_tts" ? "google_tts" : "piper";

    try {
      const result = await postJson<SimulatedTurnResponse>(`/api/calls/${call.id}/simulate-turn`, {
        text,
        language: "ne",
        voiceId: simulatedVoiceId,
        ttsProvider,
      });
      setSimulatedCall(result.call);
      setSimulatedEvents((currentEvents) => [
        ...currentEvents,
        ...result.events.filter((event) => !currentEvents.some((currentEvent) => currentEvent.id === event.id)),
      ]);
      setSimulatedText("");
      setSimulatedState("idle");
    } catch {
      setSimulatedState("failed");
      setSimulatedError("simulation_turn_failed");
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Web Voice">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Voice demo console</h2>
          <p className="mt-1 text-sm text-muted-foreground">Run Nepali simulation now, or start a realtime microphone session with the LipiVoice pipeline.</p>
        </div>
        <Badge variant={voiceState.status === "failed" ? "danger" : isRecording ? "success" : "outline"}>
          Live mic {voiceState.status}
        </Badge>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          {error}
        </div>
      ) : null}

      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Nepali call simulator</CardTitle>
            <CardDescription>Demo-ready back-and-forth call turns with spoken assistant replies</CardDescription>
          </div>
          <Badge variant={simulatedCall ? "success" : "outline"}>
            {simulatedCall ? "Call active" : "Ready"}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-3">
            <div className="grid gap-2">
              <Label htmlFor="simulated-voice">Voice</Label>
              <select
                id="simulated-voice"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={simulatedVoiceId}
                onChange={(event) => setSimulatedVoiceId(event.target.value)}
                disabled={simulatedState === "sending" || simulatedState === "starting"}
              >
                {simulatorVoices.length === 0 ? (
                  <>
                    <option value="voice_lipi_ml_ne">Mina - Nepali-native target</option>
                    <option value="voice_google_tts_ne">Sita - Preview - accent review</option>
                  </>
                ) : (
                  simulatorVoices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {formatVoiceOption(voice)}
                    </option>
                  ))
                )}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() => void startSimulatedCall()}
              disabled={!selectedAgentId || simulatedState === "starting" || simulatedState === "sending"}
            >
              <PhoneCall aria-hidden="true" />
              {simulatedState === "starting" ? "Starting..." : "Begin Nepali simulation"}
            </Button>
            {simulatedError ? <Badge variant="danger">{simulatedError}</Badge> : null}
            {simulatedCall ? (
              <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{simulatedCall.id}</div>
                <div>{simulatedCall.status}</div>
              </div>
            ) : null}
          </div>

          <div className="grid min-w-0 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="simulated-text">Caller message</Label>
              <textarea
                id="simulated-text"
                className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm leading-6"
                value={simulatedText}
                onChange={(event) => setSimulatedText(event.target.value)}
                disabled={simulatedState === "sending" || simulatedState === "starting"}
              />
            </div>
            <Button
              type="button"
              className="w-fit justify-start"
              onClick={() => void sendSimulatedTurn()}
              disabled={!selectedAgentId || simulatedText.trim() === "" || simulatedState === "sending" || simulatedState === "starting"}
            >
              <Send aria-hidden="true" />
              {simulatedState === "sending" ? "Sending..." : "Send turn"}
            </Button>
            <div className="grid gap-3">
              {simulatedTranscript.length === 0 ? (
                <p className="text-sm text-muted-foreground">No simulated transcript yet.</p>
              ) : (
                simulatedTranscript.map((event) => (
                  <div
                    key={event.id}
                    className={cn(
                      "rounded-md border border-border bg-background p-3",
                      event.actor === "assistant" && "bg-muted/60",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                      <MessageSquareText aria-hidden="true" className="size-3" />
                      {event.actor}
                    </div>
                    <p className="text-sm leading-6">{typeof event.payload.text === "string" ? event.payload.text : ""}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="grid content-start gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Simulated audio</span>
              <Badge variant="secondary">{simulatedAudio.length} replies</Badge>
            </div>
            {simulatedAudio.length === 0 ? (
              <p className="text-sm text-muted-foreground">No simulated audio yet.</p>
            ) : (
              simulatedAudio.map((event) => (
                <audio
                  key={event.id}
                  className="w-full"
                  controls
                  src={`data:${String(event.payload.mimeType)};base64,${String(event.payload.audioBase64)}`}
                />
              ))
            )}
            {simulatedEvents
              .filter((event) => event.type === "runtime" || event.type === "error")
              .map((event) => (
                <Badge key={event.id} variant={event.severity === "error" ? "danger" : "outline"}>
                  {formatSimulatedRuntimeEvent(event)}
                </Badge>
              ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Live microphone session</CardTitle>
            <CardDescription>Realtime browser microphone capture and socket control</CardDescription>
          </div>
          <Badge variant={voiceState.status === "failed" ? "danger" : isRecording ? "success" : "outline"}>
            {voiceState.status}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Live microphone sessions use LiveKit media on the remote server. If connection fails, check browser microphone permission and LiveKit logs.</span>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="voice-agent">Agent</Label>
              <select
                id="voice-agent"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                disabled={isRecording}
              >
                {agents.length === 0 ? <option value="">No agents available</option> : null}
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" className="justify-start" onClick={() => void startSession()} disabled={isRecording}>
              <Mic aria-hidden="true" />
              Start live mic
            </Button>
            <Button type="button" variant="outline" className="justify-start" onClick={stopSession} disabled={!isRecording}>
              <Square aria-hidden="true" />
              Stop
            </Button>
            <div className="rounded-md border border-border bg-background p-3 text-sm">
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Transcript</span>
                  <Badge variant="secondary">{voiceState.transcript.length} transcript</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Audio responses</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary">{voiceState.audioQueue.length} audio</Badge>
                    <Badge variant="outline">{voiceState.audioQueue.length} queued</Badge>
                  </div>
                </div>
                {sessionExpiresAt ? (
                  <p className="text-xs text-muted-foreground">Session token expires {sessionExpiresAt}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">No active realtime token.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="rounded-lg border border-border bg-background p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold leading-none tracking-normal">Live transcript</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">Live user and assistant messages</p>
              </div>
              <div>
                {voiceState.transcript.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transcript events yet.</p>
                ) : (
                  <ol className="grid gap-3">
                    {voiceState.transcript.map((entry, index) => (
                      <li
                        key={`${entry.actor}-${index}`}
                        className={cn(
                          "rounded-md border border-border bg-background p-3",
                          entry.actor === "assistant" && "bg-muted/60",
                        )}
                      >
                        <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{entry.actor}</div>
                        <p className="text-sm leading-6">{entry.text}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-background p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold leading-none tracking-normal">Live playback</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">Spoken responses from the assistant</p>
              </div>
              <div className="grid gap-3">
                {voiceState.audioQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No playable audio queued.</p>
                ) : (
                  voiceState.audioQueue.map((audio, index) => (
                    <audio
                      key={`${audio.mimeType}-${index}`}
                      className="w-full"
                      controls
                      src={`data:${audio.mimeType};base64,${audio.audioBase64}`}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

interface RealtimeSessionResponse {
  token: string;
  agentId: string;
  expiresAt: string;
}

interface SimulatedTurnResponse {
  call: Call;
  events: CallEvent[];
  assistantText: string;
  audio: { audioBase64: string; mimeType: string } | null;
  voiceId: string;
  providerId: string;
  fallbackReason: string | null;
  latencyMs: number;
}

async function createRealtimeSession(agentId: string): Promise<RealtimeSessionResponse> {
  const response = await fetch(apiPath("/api/realtime/session"), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ agentId }),
  });
  if (!response.ok) {
    throw new Error("realtime_session_failed");
  }

  const body = (await response.json()) as Partial<RealtimeSessionResponse>;
  if (typeof body.token !== "string" || typeof body.expiresAt !== "string" || typeof body.agentId !== "string") {
    throw new Error("realtime_session_failed");
  }

  return { token: body.token, agentId: body.agentId, expiresAt: body.expiresAt };
}

function getRealtimeSocketUrl(token: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${window.location.host}${apiPath("/api/realtime")}?token=${encodeURIComponent(token)}`;
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

function clearTimer(ref: MutableRefObject<number | null>) {
  if (ref.current !== null) {
    window.clearTimeout(ref.current);
    ref.current = null;
  }
}

function isVoiceStatusValue(value: unknown): value is VoiceStatus {
  return (
    value === "idle" ||
    value === "connecting" ||
    value === "listening" ||
    value === "thinking" ||
    value === "speaking" ||
    value === "failed" ||
    value === "stopped"
  );
}

function formatSimulatedRuntimeEvent(event: CallEvent) {
  const code = event.payload.code;
  const reason = event.payload.reason;

  if (typeof code === "string" && typeof reason === "string") {
    return `${code}: ${reason}`;
  }

  if (typeof code === "string") {
    return code;
  }

  return event.type;
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
