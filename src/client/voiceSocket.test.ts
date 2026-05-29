import { afterEach, describe, expect, it, vi } from "vitest";

import { createVoiceSocket, reduceVoiceEvent } from "./voiceSocket";

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

describe("reduceVoiceEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it("stores failed runtime status", () => {
    const state = reduceVoiceEvent(
      { status: "connecting", transcript: [], audioQueue: [], error: null },
      { type: "status", status: "failed", reason: "runtime_not_configured" },
    );

    expect(state.status).toBe("failed");
    expect(state.error).toBe("runtime_not_configured");
  });

  it("leaves state unchanged for unknown event types", () => {
    const current = { status: "listening" as const, transcript: [], audioQueue: [], error: null };

    const next = reduceVoiceEvent(current, { type: "vad", payload: { active: true } });

    expect(next).toBe(current);
  });
});

describe("createVoiceSocket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it("drops outgoing messages before the socket is open", () => {
    vi.stubGlobal("WebSocket", MockWebSocket);

    const socket = createVoiceSocket("ws://localhost/api/realtime", {});

    socket.send({ type: "audio_chunk" });

    expect(MockWebSocket.instances[0]?.sent).toEqual([]);
  });

  it("notifies close handlers", () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const onClose = vi.fn();

    const socket = createVoiceSocket("ws://localhost/api/realtime", { onClose });
    socket.close();

    expect(onClose).toHaveBeenCalled();
  });
});
