import { act, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as livekitCall from "@/client/livekitCall";
import { CallsPage } from "./CallsPage";

const calls = [
  {
    id: "call_1",
    status: "failed",
    channel: "web",
    direction: "inbound",
    agentId: "agent_1",
    startedAt: "2026-05-29T00:00:00.000Z",
    endedAt: "2026-05-29T00:00:12.000Z",
    durationSeconds: 12,
    costEstimateUsd: 0.02,
    recordingUrl: null,
    failureReason: "runtime_not_configured",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

const fullReceptionAgent = {
  id: "agent_reception",
  name: "Reception Agent",
  greeting: "Namaste",
  systemPrompt: "Insurance receptionist",
  language: "ne",
  modelRuntimeId: "runtime_vllm",
  modelAssetId: "model_gemma",
  voiceId: "voice_google_tts_ne",
  transcriberRuntimeId: "runtime_lipi_ml_stt",
  recordingEnabled: false,
  interruptionSensitivity: "medium" as const,
  toolIds: [],
  knowledgeBaseIds: [],
  deploymentState: "ready" as const,
  createdAt: "2026-05-31T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z",
};

async function openCallLog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Call log" }));
  return within(await screen.findByLabelText("Call records"));
}

describe("CallsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders call records and failure reasons", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(calls)));

    render(<CallsPage />);

    const records = await openCallLog(user);
    expect(records.getByText("runtime_not_configured")).toBeInTheDocument();
    expect(records.getAllByText("call_1").length).toBeGreaterThan(0);
    expect(records.getByText(/inbound web/)).toBeInTheDocument();
    expect(records.getAllByText("failed").length).toBeGreaterThan(0);
    expect(records.getAllByText("12s").length).toBeGreaterThan(0);
  });

  it("filters call records by channel and status", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/events")) {
          return Response.json([]);
        }

        return Response.json([
          {
            ...calls[0],
            id: "call_web_failed",
            status: "failed",
            channel: "web",
            startedAt: "2026-05-29T00:00:00.000Z",
          },
          {
            ...calls[0],
            id: "call_sim_done",
            status: "disconnected",
            channel: "simulation",
            startedAt: "2026-05-29T00:01:00.000Z",
            failureReason: null,
          },
          {
            ...calls[0],
            id: "call_phone_live",
            status: "connected",
            channel: "phone",
            endedAt: null,
            startedAt: "2026-05-29T00:02:00.000Z",
            failureReason: null,
          },
        ]);
      }),
    );

    render(<CallsPage />);

    const records = await openCallLog(user);
    expect(records.getByText("call_web_failed")).toBeInTheDocument();
    expect(records.getByText("call_sim_done")).toBeInTheDocument();
    expect(records.getByText("call_phone_live")).toBeInTheDocument();

    await user.click(records.getByRole("button", { name: "Channel: Web" }));
    expect(records.getByText("call_web_failed")).toBeInTheDocument();
    expect(records.queryByText("call_sim_done")).not.toBeInTheDocument();
    expect(records.queryByText("call_phone_live")).not.toBeInTheDocument();

    await user.click(records.getByRole("button", { name: "Status: Failed" }));
    expect(records.getByText("call_web_failed")).toBeInTheDocument();

    await user.click(records.getByRole("button", { name: "Channel: Phone" }));
    expect(records.getByText("No calls match the current filters.")).toBeInTheDocument();

    await user.click(records.getByRole("button", { name: "Status: Active" }));
    expect(records.getByText("call_phone_live")).toBeInTheDocument();
  });

  it("keeps call records in the call log tab", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(calls)));

    render(<CallsPage />);

    await screen.findByRole("button", { name: "Transcript" });
    expect(screen.getByRole("button", { name: "Transcript" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Call records")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Call log" }));

    expect(screen.getByLabelText("Call records")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call log" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not render unwired call controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(calls)));

    render(<CallsPage />);

    await screen.findByRole("button", { name: "Transcript" });
    expect(screen.queryByRole("button", { name: "Mute call" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Call options" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open chat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute active call" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand system prompt" })).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.queryByText("Analysis")).not.toBeInTheDocument();
    expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
  });

  it("loads and renders a call event timeline when a call is selected", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/calls/call_1/events")) {
          return Response.json([
            {
              id: "event_1",
              callId: "call_1",
              timestamp: "2026-05-29T00:00:00.000Z",
              type: "error",
              actor: "system",
              severity: "error",
              payload: { code: "runtime_not_configured" },
            },
          ]);
        }

        return Response.json(calls);
      }),
    );

    render(<CallsPage />);

    const records = await openCallLog(user);
    await user.click(await records.findByRole("button", { name: /call_1/ }));

    await waitFor(() => expect(screen.getAllByText("runtime_not_configured").length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText("system")).toBeInTheDocument();
  });

  it("selects the newest call and separates transcript from debug events", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/calls/call_1/events")) {
          return Response.json([
            {
              id: "event_user",
              callId: "call_1",
              timestamp: "2026-05-29T00:00:03.000Z",
              type: "transcript",
              actor: "user",
              severity: "info",
              payload: { text: "I need order help" },
            },
            {
              id: "event_tool",
              callId: "call_1",
              timestamp: "2026-05-29T00:00:04.000Z",
              type: "tool_call",
              actor: "tool",
              severity: "info",
              payload: { toolName: "Order lookup" },
            },
          ]);
        }

        return Response.json(calls);
      }),
    );

    render(<CallsPage />);

    expect(await screen.findByText("I need order help")).toBeInTheDocument();
    const records = await openCallLog(user);
    expect(records.getByText("Call detail")).toBeInTheDocument();
    expect(screen.getByText(/inbound web/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$0\.02/).length).toBeGreaterThan(0);
    expect(screen.getByText("Order lookup")).toBeInTheDocument();
  });

  it("summarizes tool call status, attempts, and errors", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/calls/call_1/events")) {
          return Response.json([
            {
              id: "event_tool",
              callId: "call_1",
              timestamp: "2026-05-29T00:00:04.000Z",
              type: "tool_call",
              actor: "tool",
              severity: "error",
              payload: {
                toolName: "Order lookup",
                ok: false,
                status: 0,
                attempts: 2,
                error: "socket closed",
              },
            },
          ]);
        }

        return Response.json(calls);
      }),
    );

    render(<CallsPage />);

    await openCallLog(user);
    expect(await screen.findByText("Order lookup · failed · 2 attempts · socket closed")).toBeInTheDocument();
  });

  it("ignores stale event responses after selecting another call", async () => {
    const user = userEvent.setup();
    const slowCallEvents = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/calls/call_1/events")) {
          return slowCallEvents.promise;
        }

        if (url.endsWith("/api/calls/call_2/events")) {
          return Response.json([
            {
              id: "event_2",
              callId: "call_2",
              timestamp: "2026-05-29T00:00:01.000Z",
              type: "status",
              actor: "system",
              severity: "info",
              payload: { status: "connected" },
            },
          ]);
        }

        return Response.json([
          ...calls,
          {
            id: "call_2",
            status: "connected",
            channel: "web",
            durationSeconds: 2,
            failureReason: null,
          },
        ]);
      }),
    );

    render(<CallsPage />);

    const records = await openCallLog(user);
    await user.click(await records.findByRole("button", { name: /call_1/ }));
    await user.click(await records.findByRole("button", { name: /call_2/ }));
    await waitFor(() => expect(screen.getAllByText("connected").length).toBeGreaterThan(0));

    await act(async () => {
      slowCallEvents.resolve(
        Response.json([
          {
            id: "event_1",
            callId: "call_1",
            timestamp: "2026-05-29T00:00:02.000Z",
            type: "error",
            actor: "system",
            severity: "error",
            payload: { code: "stale_event_payload" },
          },
        ]),
      );
      await slowCallEvents.promise;
    });

    expect(screen.queryByText("stale_event_payload")).not.toBeInTheDocument();
    expect(screen.getAllByText("connected").length).toBeGreaterThan(0);
  });

  it("ends an active call from the detail panel", async () => {
    const user = userEvent.setup();
    const activeCall = {
      id: "call_phone_1",
      status: "connected",
      channel: "phone",
      direction: "inbound",
      agentId: "agent_reception",
      phoneNumberId: "phone_demo_main",
      startedAt: "2026-05-31T00:00:00.000Z",
      endedAt: null,
      durationSeconds: 0,
      costEstimateUsd: 0,
      recordingUrl: null,
      failureReason: null,
    };
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/calls/call_phone_1/end") && init?.method === "POST") {
        return Response.json({
          call: {
            ...activeCall,
            status: "disconnected",
            endedAt: "2026-05-31T00:00:30.000Z",
            durationSeconds: 30,
          },
          events: [
            {
              id: "event_end",
              callId: "call_phone_1",
              timestamp: "2026-05-31T00:00:30.000Z",
              type: "status",
              actor: "system",
              severity: "info",
              payload: { status: "disconnected" },
            },
          ],
        });
      }

      if (url.endsWith("/api/calls/call_phone_1/events")) {
        return Response.json([]);
      }

      return Response.json([activeCall]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<CallsPage />);

    await openCallLog(user);
    expect(await screen.findByText(/inbound phone/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "End call" }));

    await waitFor(() => expect(screen.getAllByText("disconnected").length).toBeGreaterThan(0));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/calls/call_phone_1/end",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("starts a livekit call from the selected agent", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
    const livekitCallResult = {
      id: "call_sim_1",
      status: "connected",
      channel: "web",
      direction: "inbound",
      agentId: "agent_reception",
      startedAt: "2026-05-31T00:00:00.000Z",
      endedAt: null,
      durationSeconds: 0,
      costEstimateUsd: 0,
      recordingUrl: null,
      failureReason: null,
    };
    const connectSpy = vi.spyOn(livekitCall, "connectLiveKitCall").mockResolvedValue({ close: vi.fn() });
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/agents") && init?.method === "POST") {
        const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : null;
        const payloadAgentId = parsedBody && "id" in parsedBody ? parsedBody.id : null;
        if (payloadAgentId === "agent_reception") {
          return Response.json(parsedBody);
        }

        return Response.json(fullReceptionAgent);
      }

      if (url.endsWith("/api/agents")) {
        return Response.json([fullReceptionAgent]);
      }

      if (url.endsWith("/api/livekit/web-call/start") && init?.method === "POST") {
        return Response.json(
          {
            call: livekitCallResult,
            events: [
              {
                id: "event_connected",
                callId: livekitCallResult.id,
                timestamp: "2026-05-31T00:00:00.000Z",
                type: "status",
                actor: "system",
                severity: "info",
                payload: {
                  status: "connected",
                  transport: "livekit",
                  roomName: "lipivoice-call-call_sim_1",
                },
              },
            ],
            livekit: {
              wsUrl: "ws://127.0.0.1:7880",
              token: "jwt-token",
              roomName: "lipivoice-call-call_sim_1",
              participantIdentity: "caller_call_sim_1",
              dispatchId: "dispatch_1",
            },
          },
          { status: 201 },
        );
      }

      if (url.endsWith("/api/calls")) {
        return Response.json([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<CallsPage />);

    await screen.findByRole("button", { name: "Transcript" });
    await user.click(screen.getByRole("button", { name: "Start live call" }));

    await waitFor(() => {
      const called = fetchSpy.mock.calls.find(([url, init]) => {
        const requestUrl = String(url);
        return requestUrl.endsWith("/api/livekit/web-call/start") && init?.method === "POST";
      });

      expect(called).toBeDefined();
      expect(called?.[1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({ agentId: "agent_reception" }),
      });
    });
    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        wsUrl: "ws://127.0.0.1:7880",
        token: "jwt-token",
      }),
    );
    expect((await screen.findAllByText("call_sim_1")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Transcript" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Transcript messages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show setup" })).toBeInTheDocument();
    await openCallLog(user);
    expect(screen.getByText(/inbound web/)).toBeInTheDocument();
    expect(screen.getByText("lipivoice-call-call_sim_1")).toBeInTheDocument();
  });

  it("shows microphone permission guidance before starting a live call when access is denied", async () => {
    const user = userEvent.setup();
    const mediaDevices = {
      getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
    };
    vi.stubGlobal("navigator", { mediaDevices });
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/agents")) {
        return Response.json([fullReceptionAgent]);
      }

      if (url.endsWith("/api/livekit/web-call/start") && init?.method === "POST") {
        return Response.json(
          {
            call: {
              id: "call_mic_denied",
              status: "connected",
              channel: "web",
              direction: "inbound",
              agentId: "agent_reception",
              startedAt: "2026-06-02T11:00:00.000Z",
              durationSeconds: 0,
              costEstimateUsd: 0,
            },
            events: [
              {
                id: "event_connected",
                callId: "call_mic_denied",
                timestamp: "2026-06-02T11:00:00.000Z",
                type: "status",
                actor: "system",
                severity: "info",
                payload: { status: "connected" },
              },
            ],
            livekit: {
              wsUrl: "ws://127.0.0.1:7880",
              token: "jwt-token",
              roomName: "lipivoice-call-call_mic_denied",
              participantIdentity: "caller_call_mic_denied",
              dispatchId: "dispatch_1",
            },
          },
          { status: 201 },
        );
      }

      if (url.endsWith("/api/calls/call_mic_denied/end") && init?.method === "POST") {
        return Response.json({
          call: {
            id: "call_mic_denied",
            status: "failed",
            channel: "web",
            direction: "inbound",
            agentId: "agent_reception",
            startedAt: "2026-06-02T11:00:00.000Z",
            endedAt: "2026-06-02T11:00:01.000Z",
            durationSeconds: 1,
            costEstimateUsd: 0,
            failureReason: "microphone_permission_failed",
          },
          events: [
            {
              id: "event_failed",
              callId: "call_mic_denied",
              timestamp: "2026-06-02T11:00:01.000Z",
              type: "status",
              actor: "system",
              severity: "error",
              payload: { status: "failed", reason: "microphone_permission_failed" },
            },
          ],
        });
      }

      if (url.endsWith("/api/calls")) {
        return Response.json([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<CallsPage />);

    await screen.findByRole("button", { name: "Transcript" });
    await user.click(screen.getByRole("button", { name: "Start live call" }));

    expect(await screen.findByText(/Microphone permission is required/)).toBeInTheDocument();
    const micDeniedStartCallCall = fetchSpy.mock.calls.find(([url, init]) => {
      const requestUrl = String(url);
      return requestUrl.endsWith("/api/livekit/web-call/start") && init?.method === "POST";
    });

    expect(micDeniedStartCallCall).toBeDefined();
    expect(micDeniedStartCallCall?.[1]).toMatchObject({ method: "POST" });
    expect(await screen.findByText("microphone_permission_failed")).toBeInTheDocument();
  });

  it("explains when the browser cannot provide microphone capture", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {});
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/agents")) {
        return Response.json([fullReceptionAgent]);
      }

      if (url.endsWith("/api/livekit/web-call/start") && init?.method === "POST") {
        return Response.json(
          {
            call: {
              id: "call_no_capture",
              status: "connected",
              channel: "web",
              direction: "inbound",
              agentId: "agent_reception",
              startedAt: "2026-06-02T11:00:00.000Z",
              durationSeconds: 0,
              costEstimateUsd: 0,
            },
            events: [
              {
                id: "event_connected",
                callId: "call_no_capture",
                timestamp: "2026-06-02T11:00:00.000Z",
                type: "status",
                actor: "system",
                severity: "info",
                payload: { status: "connected" },
              },
            ],
            livekit: {
              wsUrl: "ws://127.0.0.1:7880",
              token: "jwt-token",
              roomName: "lipivoice-call-call_no_capture",
              participantIdentity: "caller_call_no_capture",
              dispatchId: "dispatch_1",
            },
          },
          { status: 201 },
        );
      }

      if (url.endsWith("/api/calls/call_no_capture/end") && init?.method === "POST") {
        return Response.json({
          call: {
            id: "call_no_capture",
            status: "failed",
            channel: "web",
            direction: "inbound",
            agentId: "agent_reception",
            startedAt: "2026-06-02T11:00:00.000Z",
            endedAt: "2026-06-02T11:00:01.000Z",
            durationSeconds: 1,
            costEstimateUsd: 0,
            failureReason: "microphone_permission_failed",
          },
          events: [
            {
              id: "event_failed",
              callId: "call_no_capture",
              timestamp: "2026-06-02T11:00:01.000Z",
              type: "status",
              actor: "system",
              severity: "error",
              payload: { status: "failed", reason: "microphone_permission_failed" },
            },
          ],
        });
      }

      if (url.endsWith("/api/calls")) {
        return Response.json([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<CallsPage />);

    await screen.findByRole("button", { name: "Transcript" });
    await user.click(screen.getByRole("button", { name: "Start live call" }));

    expect(await screen.findByText(/This browser cannot access microphone capture/)).toBeInTheDocument();
    const noCaptureStartCallCall = fetchSpy.mock.calls.find(([url, init]) => {
      const requestUrl = String(url);
      return requestUrl.endsWith("/api/livekit/web-call/start") && init?.method === "POST";
    });

    expect(noCaptureStartCallCall).toBeDefined();
    expect(noCaptureStartCallCall?.[1]).toMatchObject({ method: "POST" });
    expect(await screen.findByText("microphone_permission_failed")).toBeInTheDocument();
  });

  it("starts a no-microphone demo call from the calls page", async () => {
    const user = userEvent.setup();
    const simulatedCall = {
      id: "call_demo_1",
      status: "connected",
      channel: "simulation",
      direction: "inbound",
      agentId: "agent_reception",
      startedAt: "2026-05-31T00:00:00.000Z",
      endedAt: null,
      durationSeconds: 0,
      costEstimateUsd: 0,
      recordingUrl: null,
      failureReason: null,
    };
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/agents") && init?.method === "POST") {
        const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : null;
        return Response.json(parsedBody ?? fullReceptionAgent);
      }

      if (url.endsWith("/api/agents")) {
        return Response.json([fullReceptionAgent]);
      }

      if (url.endsWith("/api/calls/simulate") && init?.method === "POST") {
        return Response.json({
          call: simulatedCall,
          events: [
            {
              id: "event_demo",
              callId: simulatedCall.id,
              timestamp: "2026-05-31T00:00:00.000Z",
              type: "status",
              actor: "system",
              severity: "info",
              payload: { status: "connected", mode: "demo" },
            },
          ],
        });
      }

      if (url.endsWith("/api/calls")) {
        return Response.json([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<CallsPage />);

    await screen.findByRole("button", { name: "Transcript" });
    await user.click(screen.getByRole("button", { name: "Start demo call" }));

    await waitFor(() => {
      const called = fetchSpy.mock.calls.find(([url, init]) => {
        const requestUrl = String(url);
        return requestUrl.endsWith("/api/calls/simulate") && init?.method === "POST";
      });

      expect(called).toBeDefined();
      expect(called?.[1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({ agentId: "agent_reception" }),
      });
    });
    expect((await screen.findAllByText("call_demo_1")).length).toBeGreaterThan(0);
    await openCallLog(user);
    expect(screen.getByText(/inbound simulation/)).toBeInTheDocument();
  });

  it("lets the selected agent choose STT, LLM, and TTS providers", async () => {
    const user = userEvent.setup();
    const agent = {
      id: "agent_reception",
      name: "Reception Agent",
      greeting: "Namaste",
      systemPrompt: "Insurance receptionist",
      language: "ne",
      modelRuntimeId: "runtime_vllm",
      modelAssetId: "model_gemma",
      voiceId: "voice_google_tts_ne",
      transcriberRuntimeId: "runtime_lipi_ml_stt",
      recordingEnabled: false,
      interruptionSensitivity: "medium",
      toolIds: [],
      knowledgeBaseIds: [],
      deploymentState: "ready",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };
    let savedAgent: Record<string, unknown> | null = null;
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/agents") && init?.method === "POST") {
        savedAgent = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(savedAgent);
      }

      if (url.endsWith("/api/agents")) {
        return Response.json([agent]);
      }

      if (url.endsWith("/api/model-runtimes")) {
        return Response.json([
          {
            id: "runtime_lipi_ml_stt",
            kind: "stt",
            adapter: "faster_whisper",
            endpoint: "https://lipi-ml/stt",
            configuredState: "configured",
            healthStatus: "healthy",
            defaultModelId: "model_whisper",
            concurrencyLimit: 1,
            hardwareHints: ["remote"],
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          },
          {
            id: "runtime_google_stt",
            kind: "stt",
            adapter: "google_stt",
            endpoint: "https://speech.googleapis.com",
            configuredState: "configured",
            healthStatus: "healthy",
            defaultModelId: "model_google_stt_ne",
            concurrencyLimit: 2,
            hardwareHints: ["cloud"],
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          },
          {
            id: "runtime_vllm",
            kind: "llm",
            adapter: "vllm",
            endpoint: "https://vllm",
            configuredState: "configured",
            healthStatus: "healthy",
            defaultModelId: "model_gemma",
            concurrencyLimit: 2,
            hardwareHints: ["gpu"],
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          },
          {
            id: "runtime_gemini",
            kind: "llm",
            adapter: "gemini",
            endpoint: "https://generativelanguage.googleapis.com",
            configuredState: "configured",
            healthStatus: "healthy",
            defaultModelId: "model_gemini_flash",
            concurrencyLimit: 4,
            hardwareHints: ["cloud"],
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          },
          {
            id: "runtime_google_tts",
            kind: "tts",
            adapter: "google_tts",
            endpoint: "https://texttospeech.googleapis.com",
            configuredState: "configured",
            healthStatus: "healthy",
            defaultModelId: "model_google_tts_ne",
            concurrencyLimit: 2,
            hardwareHints: ["cloud"],
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          },
          {
            id: "runtime_lipi_ml_tts",
            kind: "tts",
            adapter: "piper",
            endpoint: "https://lipi-ml/tts",
            configuredState: "configured",
            healthStatus: "healthy",
            defaultModelId: "model_piper_ne",
            concurrencyLimit: 2,
            hardwareHints: ["remote"],
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          },
        ]);
      }

      if (url.endsWith("/api/model-assets")) {
        return Response.json([
          { id: "model_gemma", runtimeId: "runtime_vllm", name: "LipiCore Realtime", kind: "llm" },
          { id: "model_gemini_flash", runtimeId: "runtime_gemini", name: "LipiSense Realtime", kind: "llm" },
          { id: "model_whisper", runtimeId: "runtime_lipi_ml_stt", name: "LipiHear Remote", kind: "stt" },
          { id: "model_google_stt_ne", runtimeId: "runtime_google_stt", name: "LipiHear Nepali", kind: "stt" },
        ]);
      }

      if (url.endsWith("/api/voices")) {
        return Response.json([
          { id: "voice_google_tts_ne", name: "Sita", runtimeId: "runtime_google_tts", language: "ne-NP" },
          { id: "voice_lipi_ml_ne", name: "Mina", runtimeId: "runtime_lipi_ml_tts", language: "ne-NP" },
        ]);
      }

      if (url.endsWith("/api/calls")) {
        return Response.json([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<CallsPage />);

    await screen.findByLabelText("STT provider");
    expect(screen.getAllByText("LipiHear")).toHaveLength(1);
    expect(screen.getByText("LipiCore Realtime")).toBeInTheDocument();
    expect(screen.getByText("Sita")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("STT provider"), "runtime_google_stt");
    await user.selectOptions(screen.getByLabelText("LLM provider"), "runtime_gemini");
    await user.selectOptions(screen.getByLabelText("TTS voice"), "voice_lipi_ml_ne");
    await user.click(screen.getByRole("button", { name: "Save runtime stack" }));

    await waitFor(() => expect(savedAgent).toEqual(
      expect.objectContaining({
        transcriberRuntimeId: "runtime_google_stt",
        modelRuntimeId: "runtime_gemini",
        modelAssetId: "model_gemini_flash",
        voiceId: "voice_lipi_ml_ne",
      }),
    ));
    expect(await screen.findByText("Runtime stack saved")).toBeInTheDocument();
    expect(screen.getByText("LipiHear Nepali")).toBeInTheDocument();
    expect(screen.getByText("LipiSense Realtime")).toBeInTheDocument();
    expect(screen.getByText("Mina")).toBeInTheDocument();
  });

  it("shows an empty state when there are no calls", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));

    render(<CallsPage />);

    await openCallLog(user);
    expect(await screen.findByText("No calls recorded.")).toBeInTheDocument();
  });

  it("shows a fetch error state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "internal_error" }, { status: 500 })));

    render(<CallsPage />);

    expect(await screen.findByText("internal_error")).toBeInTheDocument();
  });
});
