import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

import {
  createVoiceSocket,
  reduceVoiceEvent,
  type VoiceSocketClient,
  type VoiceState,
  type VoiceStatus,
} from "@/client/voiceSocket";
import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Agent } from "@/domain/types";
import { cn } from "@/lib/utils";

const initialVoiceState: VoiceState = {
  status: "idle",
  transcript: [],
  audioQueue: [],
  error: null,
};

export function VoiceConsolePage() {
  const [voiceState, dispatchVoiceEvent] = useReducer(reduceVoiceEvent, initialVoiceState);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<VoiceSocketClient | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const nextSessionIdRef = useRef(0);
  const isCleaningUpRef = useRef(false);
  const isMountedRef = useRef(true);

  const error = localError ?? voiceState.error;
  const isRecording = voiceState.status !== "idle" && voiceState.status !== "stopped" && voiceState.status !== "failed";

  useEffect(() => {
    let isCurrent = true;

    void getJson<Agent[]>("/api/agents")
      .then((nextAgents) => {
        if (!isCurrent) {
          return;
        }

        setAgents(nextAgents);
        setSelectedAgentId((currentAgentId) => currentAgentId || nextAgents[0]?.id || "");
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
      },
      onEvent(event) {
        if (activeSessionIdRef.current !== sessionId) {
          return;
        }

        dispatchVoiceEvent(event);
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

    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (activeSessionIdRef.current !== sessionId) {
          return;
        }

        if (event.data.size === 0) {
          return;
        }

        void sendRecordedBlob(event.data, sessionId);
      };
      recorder.start(1000);
    } catch {
      cleanupSession({ status: "failed", reason: "media_recorder_failed" });
    }
  }

  function stopSession() {
    cleanupSession({ status: "stopped" });
  }

  async function sendRecordedBlob(blob: Blob, sessionId: number) {
    const audioBase64 = await blobToBase64(blob);

    if (activeSessionIdRef.current !== sessionId) {
      return;
    }

    socketRef.current?.send({
      type: "audio_chunk",
      mimeType: blob.type || "audio/webm",
      audioBase64,
    });
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Web Voice">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Browser voice console</h2>
          <p className="mt-1 text-sm text-muted-foreground">Capture microphone audio and stream turns to self-hosted runtimes.</p>
        </div>
        <Badge variant={voiceState.status === "failed" ? "danger" : isRecording ? "success" : "outline"}>
          {voiceState.status}
        </Badge>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Microphone capture and socket control</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
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
              Start
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
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
              <CardDescription>Live user and assistant messages</CardDescription>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Playback</CardTitle>
              <CardDescription>WAV responses from the assistant</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {voiceState.audioQueue.filter((audio) => audio.mimeType === "audio/wav").length === 0 ? (
                <p className="text-sm text-muted-foreground">No playable WAV audio queued.</p>
              ) : (
                voiceState.audioQueue
                  .filter((audio) => audio.mimeType === "audio/wav")
                  .map((audio, index) => (
                    <audio
                      key={`${audio.mimeType}-${index}`}
                      className="w-full"
                      controls
                      src={`data:${audio.mimeType};base64,${audio.audioBase64}`}
                    />
                  ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

interface RealtimeSessionResponse {
  token: string;
  agentId: string;
  expiresAt: string;
}

async function createRealtimeSession(agentId: string): Promise<RealtimeSessionResponse> {
  const response = await fetch("/api/realtime/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

  return `${protocol}//${window.location.host}/api/realtime?token=${encodeURIComponent(token)}`;
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
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
