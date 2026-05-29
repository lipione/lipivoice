import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
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
    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    if (closing || path !== "/api/realtime") {
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
    webSocket.once("close", () => {
      clients.delete(webSocket);
    });

    let processing = false;
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
      void handleMessage(webSocket, deps, ready, data, {
        isProcessing: () => processing,
        setProcessing(value) {
          processing = value;
        },
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
  state: { isProcessing(): boolean; setProcessing(value: boolean): void },
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

  if (state.isProcessing()) {
    sendJson(webSocket, { type: "error", reason: "processing_in_progress" });
    return;
  }

  state.setProcessing(true);
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
