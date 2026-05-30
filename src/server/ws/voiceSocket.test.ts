import { createServer } from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachVoiceSocket,
  type VoiceSocketLifecycle,
  type VoiceSocketRecordedEvent,
  type VoiceSocketSessionContext,
} from "./voiceSocket";

let server: ReturnType<typeof createServer> | null = null;
let voiceSocket: VoiceSocketLifecycle | null = null;

afterEach(async () => {
  await voiceSocket?.close();
  await closeServer();
  voiceSocket = null;
  server = null;
});

describe("voice socket", () => {
  it("emits failed when local runtimes are not configured", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: false, reason: "runtime_not_configured" }),
      processAudio: async () => {
        throw new Error("not reached");
      },
    });

    await listen();
    const ws = connect("/api/realtime");
    const message = await readJsonMessage(ws);

    expect(message).toEqual({ type: "status", status: "failed", reason: "runtime_not_configured" });
  });

  it("closes active websocket clients from the lifecycle handle", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async () => ({ events: [] }),
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);

    const closed = waitForClose(ws);
    await voiceSocket.close();
    await closed;
    await closeServer();

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("allows lifecycle close to be called more than once", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async () => ({ events: [] }),
    });

    await listen();

    await expect(voiceSocket.close()).resolves.toBeUndefined();
    await expect(voiceSocket.close()).resolves.toBeUndefined();
    await closeServer();
  });

  it("returns invalid_message for malformed JSON", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async () => ({ events: [] }),
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send("{");

    await expect(readJsonMessage(ws)).resolves.toEqual({ type: "error", reason: "invalid_message" });
  });

  it("returns invalid_message for structurally invalid JSON", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async () => ({ events: [] }),
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm" }));

    await expect(readJsonMessage(ws)).resolves.toEqual({ type: "error", reason: "invalid_message" });
  });

  it("emits ready audio status sequence and forwards returned events", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async (input) => ({
        events: [
          { type: "transcript", actor: "user", payload: { text: `heard:${input.mimeType}` } },
          { type: "audio", actor: "assistant", payload: { mimeType: "audio/wav", audioBase64: "out" } },
        ],
      }),
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "in" }));

    await expect(readJsonMessages(ws, 5)).resolves.toEqual([
      { type: "status", status: "listening" },
      { type: "status", status: "thinking" },
      { type: "status", status: "speaking" },
      { type: "transcript", actor: "user", payload: { text: "heard:audio/webm" } },
      { type: "audio", actor: "assistant", payload: { mimeType: "audio/wav", audioBase64: "out" } },
    ]);
  });

  it("records realtime statuses and returned events when a call session is available", async () => {
    const recordedEvents: VoiceSocketRecordedEvent[] = [];
    const finishedCalls: Array<Record<string, unknown>> = [];
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      createCallSession: async () => ({
        record: async (event) => {
          recordedEvents.push(event);
        },
        finish: async (input) => {
          finishedCalls.push(input);
        },
      }),
      processAudio: async () => ({
        events: [
          { type: "transcript", actor: "user", payload: { text: "hello" } },
          { type: "audio", actor: "assistant", payload: { mimeType: "audio/wav", audioBase64: "out" } },
        ],
      }),
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "in" }));
    await readJsonMessages(ws, 5);

    const closed = waitForClose(ws);
    ws.close();
    await closed;
    await waitUntil(() => finishedCalls.length === 1);

    expect(recordedEvents).toEqual([
      { type: "status", actor: "system", payload: { status: "listening" }, severity: "info" },
      { type: "status", actor: "system", payload: { status: "thinking" }, severity: "info" },
      { type: "status", actor: "system", payload: { status: "speaking" }, severity: "info" },
      { type: "transcript", actor: "user", payload: { text: "hello" }, severity: "info" },
      {
        type: "audio",
        actor: "assistant",
        payload: { mimeType: "audio/wav", audioBase64: "out" },
        severity: "info",
      },
    ]);
    expect(finishedCalls).toEqual([{ status: "disconnected", failureReason: null }]);
  });

  it("emits failed when audio processing throws", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async () => {
        throw new Error("boom");
      },
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "in" }));

    await expect(readJsonMessages(ws, 3)).resolves.toEqual([
      { type: "status", status: "listening" },
      { type: "status", status: "thinking" },
      { type: "status", status: "failed", reason: "processing_failed" },
    ]);
  });

  it("records failed processing and finishes the call as failed", async () => {
    const recordedEvents: VoiceSocketRecordedEvent[] = [];
    const finishedCalls: Array<Record<string, unknown>> = [];
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      createCallSession: async () => ({
        record: async (event) => {
          recordedEvents.push(event);
        },
        finish: async (input) => {
          finishedCalls.push(input);
        },
      }),
      processAudio: async () => {
        throw new Error("boom");
      },
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "in" }));

    await readJsonMessages(ws, 3);

    expect(recordedEvents).toEqual([
      { type: "status", actor: "system", payload: { status: "listening" }, severity: "info" },
      { type: "status", actor: "system", payload: { status: "thinking" }, severity: "info" },
      {
        type: "status",
        actor: "system",
        payload: { status: "failed", reason: "processing_failed" },
        severity: "error",
      },
    ]);
    expect(finishedCalls).toEqual([{ status: "failed", failureReason: "processing_failed" }]);
  });

  it("rejects websocket upgrades outside realtime path", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async () => ({ events: [] }),
    });

    await listen();
    const ws = connect("/not-realtime");

    await expect(waitForRejectedConnection(ws)).resolves.toBe("rejected");
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it("rejects realtime connections when a session token is missing or invalid", async () => {
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      validateSessionToken: (token) => token === "valid_token",
      checkReady: async () => ({ ready: true }),
      processAudio: async () => ({ events: [] }),
    });

    await listen();

    await expect(waitForRejectedConnection(connect("/api/realtime"))).resolves.toBe("rejected");
    await expect(waitForRejectedConnection(connect("/api/realtime?token=bad_token"))).resolves.toBe("rejected");

    const ws = connect("/api/realtime?token=valid_token");
    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("passes validated realtime session context to call creation and audio processing", async () => {
    const contexts: Array<VoiceSocketSessionContext | undefined> = [];
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      validateSessionToken: (token) => token === "valid_token" && { agentId: "agent_support" },
      checkReady: async (context) => {
        contexts.push(context);
        return { ready: true };
      },
      createCallSession: async (context) => {
        contexts.push(context);
        return null;
      },
      processAudio: async (_input, context) => {
        contexts.push(context);
        return { events: [] };
      },
    });

    await listen();
    const ws = connect("/api/realtime?token=valid_token");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "in" }));
    await readJsonMessages(ws, 3);

    expect(contexts).toEqual([
      { agentId: "agent_support" },
      { agentId: "agent_support" },
      { agentId: "agent_support" },
    ]);
  });

  it("rejects audio chunks that exceed the configured decoded byte limit", async () => {
    let calls = 0;
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      maxAudioBytes: 3,
      checkReady: async () => ({ ready: true }),
      processAudio: async () => {
        calls += 1;
        return { events: [] };
      },
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "dm9pY2U=" }));

    await expect(readJsonMessage(ws)).resolves.toEqual({ type: "error", reason: "audio_payload_too_large" });
    expect(calls).toBe(0);
  });

  it("rejects a second audio chunk while processing is already in progress", async () => {
    let calls = 0;
    const processing = createDeferred<{ events: [] }>();
    server = createServer();
    voiceSocket = attachVoiceSocket(server, {
      checkReady: async () => ({ ready: true }),
      processAudio: async () => {
        calls += 1;
        return processing.promise;
      },
    });

    await listen();
    const ws = connect("/api/realtime");
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "one" }));
    ws.send(JSON.stringify({ type: "audio_chunk", mimeType: "audio/webm", audioBase64: "two" }));

    await expect(readJsonMessages(ws, 3)).resolves.toEqual([
      { type: "status", status: "listening" },
      { type: "status", status: "thinking" },
      { type: "error", reason: "processing_in_progress" },
    ]);
    expect(calls).toBe(1);
    processing.resolve({ events: [] });
  });
});

function connect(path: string) {
  return new WebSocket(`ws://127.0.0.1:${serverPort()}${path}`);
}

async function listen() {
  await new Promise<void>((resolve) => server!.listen(0, resolve));
}

async function closeServer() {
  if (!server?.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function serverPort() {
  const address = server?.address();
  if (!address || typeof address === "string") throw new Error("missing test address");

  return address.port;
}

async function waitForOpen(ws: WebSocket) {
  await waitForEvent(ws, "open");
}

async function waitForClose(ws: WebSocket) {
  await waitForEvent(ws, "close");
}

function waitForEvent(ws: WebSocket, event: "open" | "close") {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.once(event, () => resolve());
      ws.once("error", reject);
    }),
  );
}

function waitForRejectedConnection(ws: WebSocket) {
  return withTimeout(
    new Promise<"rejected">((resolve, reject) => {
      ws.once("open", () => {
        reject(new Error("unexpected websocket open"));
      });
      ws.once("close", () => resolve("rejected"));
      ws.once("error", () => resolve("rejected"));
    }),
  );
}

async function readJsonMessage(ws: WebSocket) {
  const messages = await readJsonMessages(ws, 1);

  return messages[0];
}

function readJsonMessages(ws: WebSocket, count: number) {
  return withTimeout(
    new Promise<Record<string, unknown>[]>((resolve) => {
      const messages: Record<string, unknown>[] = [];

      ws.on("message", (data) => {
        messages.push(JSON.parse(String(data)) as Record<string, unknown>);

        if (messages.length === count) {
          resolve(messages);
        }
      });
    }),
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function withTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for websocket test event")), 500);
    }),
  ]);
}

function waitUntil(predicate: () => boolean) {
  return withTimeout(
    new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        }
      }, 1);
    }),
  );
}
