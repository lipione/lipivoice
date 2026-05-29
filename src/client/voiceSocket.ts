export type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "failed" | "stopped";

export interface TranscriptEntry {
  actor: "user" | "assistant" | string;
  text: string;
}

export interface AudioQueueEntry {
  audioBase64: string;
  mimeType: string;
}

export interface VoiceState {
  status: VoiceStatus;
  transcript: TranscriptEntry[];
  audioQueue: AudioQueueEntry[];
  error: string | null;
}

export type VoiceServerEvent =
  | { type: "status"; status: VoiceStatus; reason?: string }
  | { type: "transcript"; actor?: string; payload?: { text?: unknown } | unknown }
  | { type: "audio"; payload?: { audioBase64?: unknown; mimeType?: unknown } | unknown }
  | { type: "error"; reason?: string }
  | { type: string; [key: string]: unknown };

export interface VoiceSocketHandlers {
  onOpen?(): void;
  onEvent?(event: VoiceServerEvent): void;
  onError?(reason: string): void;
  onClose?(): void;
}

export interface VoiceSocketClient {
  send(value: unknown): void;
  close(): void;
}

export function reduceVoiceEvent(state: VoiceState, event: VoiceServerEvent): VoiceState {
  switch (event.type) {
    case "status": {
      if (!("status" in event) || !isVoiceStatus(event.status)) {
        return state;
      }

      const reason = "reason" in event && typeof event.reason === "string" ? event.reason : null;

      return {
        ...state,
        status: event.status,
        error: event.status === "failed" ? reason ?? "voice_runtime_failed" : null,
      };
    }
    case "transcript": {
      const text = getPayloadText(event.payload);

      if (!text) {
        return state;
      }

      return {
        ...state,
        transcript: [...state.transcript, { actor: typeof event.actor === "string" ? event.actor : "assistant", text }],
      };
    }
    case "audio": {
      const audio = getAudioPayload(event.payload);

      if (!audio) {
        return state;
      }

      return {
        ...state,
        audioQueue: [...state.audioQueue, audio],
      };
    }
    case "error":
      return {
        ...state,
        error: "reason" in event && typeof event.reason === "string" ? event.reason : "voice_socket_error",
      };
    default:
      return state;
  }
}

export function createVoiceSocket(url: string, handlers: VoiceSocketHandlers): VoiceSocketClient {
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    handlers.onOpen?.();
  });

  socket.addEventListener("message", (event) => {
    const parsed = parseVoiceServerEvent(event.data);

    if (parsed) {
      handlers.onEvent?.(parsed);
    }
  });

  socket.addEventListener("error", () => {
    handlers.onError?.("voice_socket_error");
  });

  socket.addEventListener("close", () => {
    handlers.onClose?.();
  });

  return {
    send(value) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(value));
      }
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}

function parseVoiceServerEvent(data: unknown): VoiceServerEvent | null {
  try {
    const value = JSON.parse(String(data)) as unknown;

    if (typeof value === "object" && value !== null && "type" in value && typeof value.type === "string") {
      return value as VoiceServerEvent;
    }
  } catch {
    return null;
  }

  return null;
}

function isVoiceStatus(value: unknown): value is VoiceStatus {
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

function getPayloadText(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "text" in payload &&
    typeof payload.text === "string" &&
    payload.text.trim().length > 0
  ) {
    return payload.text;
  }

  return null;
}

function getAudioPayload(payload: unknown): AudioQueueEntry | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "audioBase64" in payload &&
    typeof payload.audioBase64 === "string" &&
    "mimeType" in payload &&
    typeof payload.mimeType === "string"
  ) {
    return { audioBase64: payload.audioBase64, mimeType: payload.mimeType };
  }

  return null;
}
