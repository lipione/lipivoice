import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceConsolePage } from "./VoiceConsolePage";

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

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
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

class MockMediaRecorder extends EventTarget {
  static instances: MockMediaRecorder[] = [];
  static throwOnConstruct = false;
  static throwOnStart = false;

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });

  constructor(readonly stream: MediaStream) {
    super();
    if (MockMediaRecorder.throwOnConstruct) {
      throw new Error("recorder failed");
    }

    MockMediaRecorder.instances.push(this);
  }

  start() {
    if (MockMediaRecorder.throwOnStart) {
      throw new Error("start failed");
    }

    this.state = "recording";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("VoiceConsolePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
    MockMediaRecorder.instances = [];
    MockMediaRecorder.throwOnConstruct = false;
    MockMediaRecorder.throwOnStart = false;
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

  it("cleans up recorder, socket, and tracks on unmount", async () => {
    const user = userEvent.setup();
    const { stop } = stubMic();
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    const { unmount } = render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(MockMediaRecorder.instances[0]?.state).toBe("recording"));

    unmount();

    expect(MockMediaRecorder.instances[0]?.stop).toHaveBeenCalled();
    expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.CLOSED);
    expect(stop).toHaveBeenCalled();
  });

  it("does not start a recorder or socket when stopped while microphone permission is pending", async () => {
    const user = userEvent.setup();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const pendingMic = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => pendingMic.promise);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));
    await screen.findByText("connecting");
    await user.click(screen.getByRole("button", { name: /Stop/ }));

    await act(async () => {
      pendingMic.resolve(stream);
      await pendingMic.promise;
    });

    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect(MockMediaRecorder.instances).toHaveLength(0);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("stops capture when the socket closes", async () => {
    const user = userEvent.setup();
    const { stop } = stubMic();
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(MockMediaRecorder.instances[0]?.state).toBe("recording"));

    act(() => {
      MockWebSocket.instances[0]?.dispatchEvent(new Event("close"));
    });

    await waitFor(() => expect(screen.getByText("stopped")).toBeInTheDocument());
    expect(MockMediaRecorder.instances[0]?.stop).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("ignores stale socket close events after a newer session starts", async () => {
    const user = userEvent.setup();
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    const firstStream = { getTracks: () => [{ stop: stopFirst }] } as unknown as MediaStream;
    const secondStream = { getTracks: () => [{ stop: stopSecond }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const oldSocket = MockWebSocket.instances[0];

    await user.click(screen.getByRole("button", { name: /Stop/ }));
    expect(stopFirst).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));

    act(() => {
      oldSocket?.dispatchEvent(new Event("close"));
    });

    expect(stopSecond).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Stop/ })).not.toBeDisabled();
    expect(screen.queryByText("stopped")).not.toBeInTheDocument();
  });

  it("does not send stale recorder chunks to newer sessions", async () => {
    const user = userEvent.setup();
    const firstStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    const secondStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);
    const pendingChunk = deferred<ArrayBuffer>();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(MockMediaRecorder.instances).toHaveLength(1));

    MockMediaRecorder.instances[0]?.emitAudio({
      size: 5,
      type: "audio/webm",
      arrayBuffer: vi.fn(() => pendingChunk.promise),
    } as unknown as Blob);

    await user.click(screen.getByRole("button", { name: /Stop/ }));
    await user.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));

    await act(async () => {
      pendingChunk.resolve(new TextEncoder().encode("voice").buffer);
      await pendingChunk.promise;
    });

    expect(MockWebSocket.instances[0]?.sent).toHaveLength(0);
    expect(MockWebSocket.instances[1]?.sent).toHaveLength(0);
  });

  it("stops capture and marks failed when the socket errors", async () => {
    const user = userEvent.setup();
    const { stop } = stubMic();
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(MockMediaRecorder.instances[0]?.state).toBe("recording"));

    act(() => {
      MockWebSocket.instances[0]?.dispatchEvent(new Event("error"));
    });

    expect(await screen.findByText("voice_socket_error")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(MockMediaRecorder.instances[0]?.stop).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("cleans up and shows media_recorder_failed when recorder construction fails", async () => {
    const user = userEvent.setup();
    const { stop } = stubMic();
    MockMediaRecorder.throwOnConstruct = true;
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));

    expect(await screen.findByText("media_recorder_failed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.CLOSED);
    expect(stop).toHaveBeenCalled();
  });

  it("cleans up and shows media_recorder_failed when recorder start fails", async () => {
    const user = userEvent.setup();
    const { stop } = stubMic();
    MockMediaRecorder.throwOnStart = true;
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));

    expect(await screen.findByText("media_recorder_failed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(MockMediaRecorder.instances[0]?.stop).not.toHaveBeenCalled();
    expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.CLOSED);
    expect(stop).toHaveBeenCalled();
  });
});
