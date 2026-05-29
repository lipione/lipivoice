import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("CallsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders call records and failure reasons", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(calls)));

    render(<CallsPage />);

    await waitFor(() => expect(screen.getByText("runtime_not_configured")).toBeInTheDocument());
    expect(screen.getByText("call_1")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: /call_1/ }));

    await waitFor(() => expect(screen.getAllByText("runtime_not_configured")).toHaveLength(2));
    expect(screen.getByText("system")).toBeInTheDocument();
  });

  it("selects the newest call and separates transcript from debug events", async () => {
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

    expect(await screen.findByText("Call detail")).toBeInTheDocument();
    expect(screen.getByText("inbound web")).toBeInTheDocument();
    expect(screen.getByText("$0.02")).toBeInTheDocument();
    expect(await screen.findByText("I need order help")).toBeInTheDocument();
    expect(screen.getByText("Order lookup")).toBeInTheDocument();
  });

  it("summarizes tool call status, attempts, and errors", async () => {
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

    await user.click(await screen.findByRole("button", { name: /call_1/ }));
    await user.click(await screen.findByRole("button", { name: /call_2/ }));
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

  it("shows an empty state when there are no calls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));

    render(<CallsPage />);

    expect(await screen.findByText("No calls recorded.")).toBeInTheDocument();
  });

  it("shows a fetch error state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "internal_error" }, { status: 500 })));

    render(<CallsPage />);

    expect(await screen.findByText("Request failed: 500")).toBeInTheDocument();
  });
});
