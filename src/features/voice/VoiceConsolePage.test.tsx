import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceConsolePage } from "./VoiceConsolePage";

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
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      }
    });
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

  constructor(readonly stream: MediaStream, readonly options?: MediaRecorderOptions) {
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

const defaultAgents = [
  {
    id: "agent_reception",
    name: "Reception Agent",
    greeting: "Hi",
    systemPrompt: "Help callers.",
    language: "en",
    modelRuntimeId: "runtime_vllm",
    modelAssetId: "model_vllm_remote",
    voiceId: "voice_lipi_ml_en",
    transcriberRuntimeId: "runtime_lipi_ml_stt",
    recordingEnabled: false,
    interruptionSensitivity: "medium",
    toolIds: [],
    knowledgeBaseIds: [],
    deploymentState: "ready",
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
  },
];

const defaultVoices = [
  {
    id: "voice_google_tts_ne",
    name: "Sita",
    runtimeId: "runtime_google_tts",
    type: "builtin",
    language: "ne-NP",
    tags: ["lipivoice", "nepali", "managed-preview", "accent-review"],
    previewUrl: "",
    privacy: "workspace",
    cloneStatus: "not_clone",
    consentId: null,
  },
  {
    id: "voice_google_gemini_puck_ne",
    name: "Nabin",
    runtimeId: "runtime_google_tts",
    type: "builtin",
    language: "ne-NP",
    tags: ["lipivoice", "nepali", "male", "managed-preview", "accent-review"],
    previewUrl: "",
    privacy: "workspace",
    cloneStatus: "not_clone",
    consentId: null,
  },
  {
    id: "voice_lipi_ml_ne",
    name: "Mina",
    runtimeId: "runtime_lipi_ml_tts",
    type: "builtin",
    language: "ne-NP",
    tags: ["remote", "piper", "nepali", "native-target"],
    previewUrl: "",
    privacy: "workspace",
    cloneStatus: "not_clone",
    consentId: null,
  },
];

function stubRealtimeSession(
  token = "session_token",
  options: {
    agents?: typeof defaultAgents;
    voices?: typeof defaultVoices;
    sessionResponse?: Response;
  } = {},
) {
  const agents = options.agents ?? defaultAgents;
  const voices = options.voices ?? defaultVoices;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/agents") {
      return Response.json(agents);
    }

    if (url === "/api/voices") {
      return Response.json(voices);
    }

    if (url === "/api/realtime/session") {
      return options.sessionResponse ?? Response.json(
        { token, agentId: agents[0]?.id ?? null, expiresAt: "2026-05-30T00:00:30.000Z" },
        { status: 201 },
      );
    }

    return Response.json({ code: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);

  return fetch;
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
  beforeEach(() => {
    stubRealtimeSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
    MockMediaRecorder.instances = [];
    MockMediaRecorder.throwOnConstruct = false;
    MockMediaRecorder.throwOnStart = false;
  });

  it("loads agents, starts the selected agent session, and shows session metrics", async () => {
    const user = userEvent.setup();
    const fetch = stubRealtimeSession("token_support", {
      agents: [
        defaultAgents[0],
        {
          ...defaultAgents[0],
          id: "agent_support",
          name: "Support Agent",
        },
      ],
    });
    stubMic();
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.selectOptions(await screen.findByLabelText("Agent"), "agent_support");
    await user.click(screen.getByRole("button", { name: /Start/ }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/realtime/session",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ agentId: "agent_support" }),
        }),
      ),
    );
    expect(await screen.findByText("Session token expires 2026-05-30T00:00:30.000Z")).toBeInTheDocument();
    expect(screen.getByText("0 transcript")).toBeInTheDocument();
    expect(screen.getByText("0 audio")).toBeInTheDocument();
  });

  it("loads additional simulator voices from the API", async () => {
    render(<VoiceConsolePage />);

    expect(await screen.findByRole("option", { name: "Mina - ne-NP - Nepali-native target" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sita - ne-NP - Preview - accent review" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Nabin - ne-NP - Preview - accent review" })).toBeInTheDocument();
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
    const fetch = stubRealtimeSession("token_123");
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ agentId: "agent_reception" }),
      }),
    );
    expect(MockWebSocket.instances[0]?.url).toBe("ws://localhost:3000/api/realtime?token=token_123");
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
    stubRealtimeSession();
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    const { container } = render(<VoiceConsolePage />);

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
          payload: { audioBase64: "SUQz", mimeType: "audio/mpeg", providerId: "google_tts" },
        }),
      }),
    );

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText("1 queued")).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector("audio")?.getAttribute("src")).toBe("data:audio/mpeg;base64,SUQz"),
    );
  });

  it("runs a Nepali simulated call turn and renders assistant audio", async () => {
    const user = userEvent.setup();
    const simulatedCall = {
      id: "call_sim_1",
      channel: "simulation",
      direction: "inbound",
      agentId: "agent_reception",
      status: "connected",
      startedAt: "2026-05-30T00:00:00.000Z",
      endedAt: null,
      durationSeconds: 0,
      costEstimateUsd: 0,
      recordingUrl: null,
      failureReason: null,
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agents") {
        return Response.json(defaultAgents);
      }

      if (url === "/api/calls/simulate" && init?.method === "POST") {
        return Response.json(
          {
            call: simulatedCall,
            events: [
              {
                id: "evt_connected",
                callId: simulatedCall.id,
                timestamp: "2026-05-30T00:00:00.000Z",
                type: "status",
                actor: "system",
                payload: { status: "connected" },
                severity: "info",
              },
            ],
          },
          { status: 201 },
        );
      }

      if (url === "/api/calls/call_sim_1/simulate-turn" && init?.method === "POST") {
        return Response.json({
          call: simulatedCall,
          assistantText: "नमस्ते, म तपाईंलाई सहयोग गर्न तयार छु।",
          audio: { audioBase64: "UklGRg==", mimeType: "audio/wav" },
          voiceId: "voice_lipi_ml_ne",
          providerId: "piper",
          fallbackReason: "tts_synthesis_failed",
          latencyMs: 250,
          events: [
            {
              id: "evt_user",
              callId: simulatedCall.id,
              timestamp: "2026-05-30T00:00:01.000Z",
              type: "transcript",
              actor: "user",
              payload: { text: "नमस्ते, म एउटा परीक्षण कल गर्दैछु।" },
              severity: "info",
            },
            {
              id: "evt_assistant",
              callId: simulatedCall.id,
              timestamp: "2026-05-30T00:00:01.000Z",
              type: "transcript",
              actor: "assistant",
              payload: { text: "नमस्ते, म तपाईंलाई सहयोग गर्न तयार छु।" },
              severity: "info",
            },
            {
              id: "evt_audio",
              callId: simulatedCall.id,
              timestamp: "2026-05-30T00:00:01.000Z",
              type: "audio",
              actor: "assistant",
              payload: { audioBase64: "UklGRg==", mimeType: "audio/wav", providerId: "piper" },
              severity: "info",
            },
          ],
        });
      }

      return Response.json({ code: "not_found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    render(<VoiceConsolePage />);

    await user.click(await screen.findByRole("button", { name: "Send turn" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/calls/call_sim_1/simulate-turn",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "नमस्ते, म एउटा परीक्षण कल गर्दैछु।",
            language: "ne",
            voiceId: "voice_lipi_ml_ne",
            ttsProvider: "piper",
          }),
        }),
      ),
    );
    expect(await screen.findByText("नमस्ते, म तपाईंलाई सहयोग गर्न तयार छु।")).toBeInTheDocument();
    expect(screen.getByText("1 replies")).toBeInTheDocument();
  });

  it("cleans up recorder, socket, and tracks on unmount", async () => {
    const user = userEvent.setup();
    const { stop } = stubMic();
    stubRealtimeSession();
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
    stubRealtimeSession();
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
    stubRealtimeSession();
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
    stubRealtimeSession();
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
    stubRealtimeSession();
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
    stubRealtimeSession();
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
    stubRealtimeSession();
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
    stubRealtimeSession();
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

  it("stops before opening a socket when realtime session creation fails", async () => {
    const user = userEvent.setup();
    const { stop } = stubMic();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/agents"
          ? Response.json(defaultAgents)
          : Response.json({ code: "runtime_not_configured" }, { status: 409 }),
      ),
    );
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);

    render(<VoiceConsolePage />);

    await user.click(screen.getByRole("button", { name: /Start/ }));

    expect(await screen.findByText("realtime_session_failed")).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(MockMediaRecorder.instances).toHaveLength(0);
    expect(stop).toHaveBeenCalled();
  });
});
