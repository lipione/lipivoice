import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CallsPage } from "./CallsPage";

const calls = [
  {
    id: "call_1",
    status: "failed",
    channel: "web",
    durationSeconds: 12,
    failureReason: "runtime_not_configured",
  },
];

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
