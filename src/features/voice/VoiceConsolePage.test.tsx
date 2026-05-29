import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceConsolePage } from "./VoiceConsolePage";

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

class MockMediaRecorder extends EventTarget {
  static instances: MockMediaRecorder[] = [];

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(readonly stream: MediaStream) {
    super();
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }

  emitAudio(blob: Blob) {
    this.ondataavailable?.({ data: blob } as BlobEvent);
  }
}

function stubMic() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });

  return { getUserMedia, stop };
}

describe("VoiceConsolePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
    MockMediaRecorder.instances = [];
  });

  it("shows a clear unsupported error when recording is unavailable", async () => {
    const user = userEvent.setup();
    stubMic();
    vi.stubGlobal("MediaRecorder", undefined);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));

    expect(await screen.findByText("media_recorder_unsupported")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("captures microphone audio and sends chunks to the realtime socket", async () => {
    const user = userEvent.setup();
    const { getUserMedia, stop } = stubMic();
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(MockWebSocket.instances[0]?.url).toBe("ws://localhost:3000/api/realtime");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });

    MockMediaRecorder.instances[0]?.emitAudio(new Blob(["voice"], { type: "audio/webm" }));

    await waitFor(() => {
      expect(JSON.parse(MockWebSocket.instances[0]?.sent[0] ?? "{}")).toMatchObject({
        type: "audio_chunk",
        mimeType: "audio/webm",
        audioBase64: "dm9pY2U=",
      });
    });

    await user.click(screen.getByRole("button", { name: /Stop/ }));

    expect(stop).toHaveBeenCalled();
    expect(MockWebSocket.instances[0]?.readyState).toBe(3);
  });

  it("renders transcript and audio events from the server", async () => {
    const user = userEvent.setup();
    stubMic();
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));

    MockWebSocket.instances[0]?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "transcript", actor: "user", payload: { text: "hello" } }),
      }),
    );
    MockWebSocket.instances[0]?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "audio",
          actor: "assistant",
          payload: { audioBase64: "UklGRg==", mimeType: "audio/wav" },
        }),
      }),
    );

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText("1 queued")).toBeInTheDocument();
  });
});
