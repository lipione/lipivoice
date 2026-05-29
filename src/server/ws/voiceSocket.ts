import type { Server } from "node:http";
import WebSocket, { WebSocketServer, type RawData } from "ws";

export interface VoiceSocketDeps {
  checkReady(): Promise<{ ready: true } | { ready: false; reason: string }>;
  processAudio(input: { mimeType: string; audioBase64: string }): Promise<{
    events: Array<{ type: string; actor?: string; payload?: unknown }>;
  }>;
}

interface AudioChunkMessage {
  type: "audio_chunk";
  mimeType: string;
  audioBase64: string;
}

export function attachVoiceSocket(server: Server, deps: VoiceSocketDeps) {
  const socketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    if (path !== "/api/realtime") {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      socketServer.emit("connection", webSocket, request);
    });
  });

  socketServer.on("connection", (webSocket) => {
    const ready = deps.checkReady().then(
      (result) => {
        if (!result.ready) {
          sendJson(webSocket, { type: "status", status: "failed", reason: result.reason });
          closeAfterSend(webSocket);
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
      void handleMessage(webSocket, deps, ready, data);
    });
  });

  server.on("close", () => {
    for (const client of socketServer.clients) {
      client.close();
    }

    socketServer.close();
  });

  return socketServer;
}

async function handleMessage(
  webSocket: WebSocket,
  deps: VoiceSocketDeps,
  ready: Promise<{ ready: true } | { ready: false; reason: string }>,
  data: RawData,
) {
  const message = parseClientMessage(data);

  if (!message) {
    sendJson(webSocket, { type: "error", reason: "invalid_message" });
    return;
  }

  const readiness = await ready;
  if (!readiness.ready) {
    return;
  }

  try {
    sendJson(webSocket, { type: "status", status: "listening" });
    sendJson(webSocket, { type: "status", status: "thinking" });
    const result = await deps.processAudio({ mimeType: message.mimeType, audioBase64: message.audioBase64 });
    sendJson(webSocket, { type: "status", status: "speaking" });

    for (const event of result.events) {
      sendJson(webSocket, event);
    }
  } catch {
    sendJson(webSocket, { type: "status", status: "failed", reason: "processing_failed" });
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

function sendJson(webSocket: WebSocket, value: unknown) {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(value));
  }
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
