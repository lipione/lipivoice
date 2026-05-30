import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhoneNumbersPage } from "./PhoneNumbersPage";

const agents = [
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
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
];

const phoneNumbers = [
  {
    id: "phone_demo_main",
    label: "Main line",
    number: "+15551201001",
    provider: "simulation",
    status: "active",
    agentId: "agent_reception",
    inboundEnabled: true,
    outboundEnabled: false,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
];

describe("PhoneNumbersPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders routed numbers, saves updates, and starts an inbound test call", async () => {
    const user = userEvent.setup();
    let savedNumber: Record<string, unknown> | null = null;
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/agents")) {
        return Response.json(agents);
      }

      if (url.endsWith("/api/phone-numbers") && init?.method === "POST") {
        savedNumber = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(savedNumber);
      }

      if (url.endsWith("/api/phone-numbers")) {
        return Response.json(phoneNumbers);
      }

      if (url.endsWith("/api/calls/phone/start")) {
        return Response.json(
          {
            call: {
              id: "call_phone_1",
              channel: "phone",
              direction: "inbound",
              agentId: "agent_reception",
              phoneNumberId: "phone_demo_main",
              status: "connected",
              startedAt: "2026-05-31T00:00:00.000Z",
              endedAt: null,
              durationSeconds: 0,
              costEstimateUsd: 0,
              recordingUrl: null,
              failureReason: null,
            },
            events: [],
          },
          { status: 201 },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<PhoneNumbersPage />);

    expect(await screen.findByText("Main line")).toBeInTheDocument();
    expect(screen.getAllByText("+15551201001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reception Agent").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Support line" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+15551201002" } });
    await user.click(screen.getByRole("checkbox", { name: "Outbound calls" }));
    await user.click(screen.getByRole("button", { name: "Save number" }));

    await waitFor(() =>
      expect(savedNumber).toMatchObject({
        label: "Support line",
        number: "+15551201002",
        agentId: "agent_reception",
        outboundEnabled: true,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Start inbound test call" }));

    await waitFor(() => expect(screen.getByText("Test call started")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/calls/phone/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phoneNumberId: "phone_demo_main", direction: "inbound" }),
      }),
    );
  });
});
