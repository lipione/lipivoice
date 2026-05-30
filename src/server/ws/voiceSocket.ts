import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";

export interface VoiceSocketDeps {
  checkReady(): Promise<{ ready: true } | { ready: false; reason: string }>;
  processAudio(input: { mimeType: string; audioBase64: string }): Promise<{
    events: VoiceSocketEvent[];
  }>;
  createCallSession?(): Promise<VoiceSocketCallSession | null>;
  validateSessionToken?(token: string): boolean;
  maxAudioBytes?: number;
}

export type VoiceSocketEvent = {
  type: string;
  actor?: string;
  payload?: unknown;
  severity?: EventSeverity;
};

export type EventSeverity = "info" | "warning" | "error";

export interface VoiceSocketRecordedEvent {
  type: string;
  actor: "system" | "user" | "assistant" | "tool";
  payload: Record<string, unknown>;
  severity: EventSeverity;
}

export interface VoiceSocketCallSession {
  record(event: VoiceSocketRecordedEvent): Promise<void> | void;
  finish(input: { status: string; failureReason: string | null }): Promise<void> | void;
}

interface AudioChunkMessage {
  type: "audio_chunk";
  mimeType: string;
  audioBase64: string;
}

export interface VoiceSocketLifecycle {
  close(): Promise<void>;
}

export function attachVoiceSocket(server: Server, deps: VoiceSocketDeps): VoiceSocketLifecycle {
  const socketServer = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (closing || path !== "/api/realtime") {
      socket.destroy();
      return;
    }

    if (deps.validateSessionToken && !deps.validateSessionToken(url.searchParams.get("token") ?? "")) {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      socketServer.emit("connection", webSocket, request);
    });
  }

  server.on("upgrade", handleUpgrade);

  socketServer.on("connection", (webSocket) => {
    clients.add(webSocket);
    let callSession: VoiceSocketCallSession | null = null;
    let callFinished = false;
    let socketClosed = false;
    function recordEvent(event: VoiceSocketRecordedEvent) {
      if (!callSession || callFinished) {
        return;
      }

      void Promise.resolve(callSession.record(event)).catch(() => undefined);
    }

    async function finishCall(input: { status: string; failureReason: string | null }) {
      if (!callSession || callFinished) {
        return;
      }

      callFinished = true;
      try {
        await callSession.finish(input);
      } catch {
        // Recording must not break realtime socket cleanup.
      }
    }

    webSocket.once("close", () => {
      clients.delete(webSocket);
      socketClosed = true;
      void finishCall({ status: "disconnected", failureReason: null });
    });

    let processing = false;
    const ready = deps.checkReady().then(
      async (result) => {
        if (!result.ready) {
          sendJson(webSocket, { type: "status", status: "failed", reason: result.reason });
          closeAfterSend(webSocket);
          return result;
        }

        if (deps.createCallSession) {
          callSession = await deps.createCallSession().catch(() => null);
          if (socketClosed) {
            await finishCall({ status: "disconnected", failureReason: null });
          }
        }

        return result;
      },
      () => {
        sendJson(webSocket, { type: "status", status: "failed", reason: "runtime_not_configured" });
        closeAfterSend(webSocket);
        return { ready: false as const, reason: "runtime_not_configured" };
      },
    );

    webSocket.on("message", (data) => {
      void handleMessage(webSocket, deps, ready, data, {
        isProcessing: () => processing,
        setProcessing(value) {
          processing = value;
        },
        recordEvent,
        finishCall,
      });
    });
  });

  server.on("close", () => {
    void close();
  });

  async function close() {
    if (closed) {
      return;
    }

    if (closePromise) {
      await closePromise;
      return;
    }

    closePromise = closeInternal();
    await closePromise;
  }

  async function closeInternal() {
    closing = true;
    server.off("upgrade", handleUpgrade);

    for (const client of clients) {
      closeClient(client);
    }

    await waitForClientsToClose(clients);

    for (const client of clients) {
      client.terminate();
    }

    await closeSocketServer(socketServer);
    closed = true;
  }

  return { close };
}

async function handleMessage(
  webSocket: WebSocket,
  deps: VoiceSocketDeps,
  ready: Promise<{ ready: true } | { ready: false; reason: string }>,
  data: RawData,
  state: {
    isProcessing(): boolean;
    setProcessing(value: boolean): void;
    recordEvent(event: VoiceSocketRecordedEvent): void;
    finishCall(input: { status: string; failureReason: string | null }): Promise<void>;
  },
) {
  const message = parseClientMessage(data);

  if (!message) {
    sendJson(webSocket, { type: "error", reason: "invalid_message" });
    state.recordEvent(recordedError("invalid_message"));
    return;
  }

  if (isAudioPayloadTooLarge(message.audioBase64, deps.maxAudioBytes)) {
    sendJson(webSocket, { type: "error", reason: "audio_payload_too_large" });
    state.recordEvent(recordedError("audio_payload_too_large"));
    return;
  }

  const readiness = await ready;
  if (!readiness.ready) {
    return;
  }

  if (state.isProcessing()) {
    sendJson(webSocket, { type: "error", reason: "processing_in_progress" });
    state.recordEvent(recordedError("processing_in_progress"));
    return;
  }

  state.setProcessing(true);
  try {
    sendStatus(webSocket, state.recordEvent, "listening");
    sendStatus(webSocket, state.recordEvent, "thinking");
    const result = await deps.processAudio({ mimeType: message.mimeType, audioBase64: message.audioBase64 });
    sendStatus(webSocket, state.recordEvent, "speaking");

    for (const event of result.events) {
      sendJson(webSocket, event);
      state.recordEvent(recordedEvent(event));
    }
  } catch {
    sendStatus(webSocket, state.recordEvent, "failed", "processing_failed");
    await state.finishCall({ status: "failed", failureReason: "processing_failed" });
  } finally {
    state.setProcessing(false);
  }
}

function parseClientMessage(data: RawData): AudioChunkMessage | null {
  try {
    const value = JSON.parse(String(data)) as unknown;

    if (isAudioChunkMessage(value)) {
      return value;
    }

    return null;
  } catch {
    return null;
  }
}

function isAudioChunkMessage(value: unknown): value is AudioChunkMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "audio_chunk" &&
    "mimeType" in value &&
    typeof value.mimeType === "string" &&
    "audioBase64" in value &&
    typeof value.audioBase64 === "string"
  );
}

function isAudioPayloadTooLarge(audioBase64: string, maxAudioBytes: number | undefined) {
  return typeof maxAudioBytes === "number" && Buffer.byteLength(audioBase64, "base64") > maxAudioBytes;
}

function sendJson(webSocket: WebSocket, value: unknown) {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(value));
  }
}

function sendStatus(
  webSocket: WebSocket,
  recordEvent: (event: VoiceSocketRecordedEvent) => void,
  status: string,
  reason?: string,
) {
  sendJson(webSocket, reason ? { type: "status", status, reason } : { type: "status", status });
  recordEvent(recordedStatus(status, reason));
}

function recordedStatus(status: string, reason?: string): VoiceSocketRecordedEvent {
  return {
    type: "status",
    actor: "system",
    payload: reason ? { status, reason } : { status },
    severity: status === "failed" ? "error" : "info",
  };
}

function recordedError(reason: string): VoiceSocketRecordedEvent {
  return {
    type: "error",
    actor: "system",
    payload: { reason },
    severity: "error",
  };
}

function recordedEvent(event: VoiceSocketEvent): VoiceSocketRecordedEvent {
  const payload = payloadRecord(event.payload);

  return {
    type: event.type,
    actor: actorForEvent(event.actor),
    payload,
    severity: event.severity ?? severityForEvent(event.type, payload),
  };
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (isRecord(payload)) {
    return payload;
  }

  if (payload === undefined) {
    return {};
  }

  return { value: payload };
}

function actorForEvent(actor: string | undefined): VoiceSocketRecordedEvent["actor"] {
  if (actor === "user" || actor === "assistant" || actor === "tool" || actor === "system") {
    return actor;
  }

  return "system";
}

function severityForEvent(type: string, payload: Record<string, unknown>): EventSeverity {
  if (type === "error") {
    return "error";
  }

  if (type === "tool_call" && payload.ok === false) {
    return "error";
  }

  return "info";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closeAfterSend(webSocket: WebSocket) {
  const timer = setTimeout(() => {
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.close();
    }
  }, 25);

  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

function closeClient(client: WebSocket) {
  try {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  } catch {
    client.terminate();
  }
}

function waitForClientsToClose(clients: Set<WebSocket>) {
  const closingClients = [...clients].filter((client) => client.readyState !== WebSocket.CLOSED);

  if (closingClients.length === 0) {
    return Promise.resolve();
  }

  return Promise.race([
    Promise.all(
      closingClients.map(
        (client) =>
          new Promise<void>((resolve) => {
            client.once("close", () => resolve());
          }),
      ),
    ).then(() => undefined),
    delay(100),
  ]);
}

function closeSocketServer(socketServer: WebSocketServer) {
  return new Promise<void>((resolve, reject) => {
    socketServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  });
}
