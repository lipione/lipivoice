import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvalsPage } from "./EvalsPage";

const agents = [
  {
    id: "agent_reception",
    name: "Reception Agent",
    greeting: "Hi, this is LipiVoice.",
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

const evals = [
  {
    id: "eval_reception_greeting",
    name: "Greeting eval",
    description: "Checks greeting.",
    agentId: "agent_reception",
    cases: [
      {
        id: "case_greeting",
        input: "Say hello.",
        checks: [{ type: "includes", value: "LipiVoice" }],
      },
    ],
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
];

describe("EvalsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves eval definitions and runs the selected eval", async () => {
    const user = userEvent.setup();
    let savedEval: Record<string, unknown> | null = null;
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/agents")) {
        return Response.json(agents);
      }

      if (url.endsWith("/api/evals/runs")) {
        return Response.json([]);
      }

      if (url.endsWith("/api/evals/eval_reception_greeting/run")) {
        return Response.json(
          {
            id: "run_1",
            evalId: "eval_reception_greeting",
            agentId: "agent_reception",
            status: "passed",
            score: 100,
            startedAt: "2026-05-31T00:00:00.000Z",
            completedAt: "2026-05-31T00:00:00.000Z",
            caseResults: [
              {
                caseId: "case_greeting",
                input: "Say hello.",
                response: "Hi, this is LipiVoice.",
                passed: true,
                checkResults: [{ type: "includes", value: "LipiVoice", passed: true }],
                recommendation: null,
              },
            ],
          },
          { status: 201 },
        );
      }

      if (url.endsWith("/api/evals") && init?.method === "POST") {
        savedEval = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(savedEval);
      }

      if (url.endsWith("/api/evals")) {
        return Response.json(evals);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<EvalsPage />);

    expect(await screen.findAllByText("Greeting eval")).not.toHaveLength(0);
    expect(screen.getByText("LipiVoice")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Greeting eval" } });
    fireEvent.change(screen.getByLabelText("User input"), { target: { value: "Say hello." } });
    fireEvent.change(screen.getByLabelText("Expected include"), { target: { value: "LipiVoice" } });
    await user.click(screen.getByRole("button", { name: "Save eval" }));

    await waitFor(() =>
      expect(savedEval).toMatchObject({
        name: "Greeting eval",
        agentId: "agent_reception",
        cases: [
          expect.objectContaining({
            input: "Say hello.",
            checks: [{ type: "includes", value: "LipiVoice" }],
          }),
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Run eval" }));

    await waitFor(() => expect(screen.getAllByText("100%")).not.toHaveLength(0));
    expect(screen.getByText("Hi, this is LipiVoice.")).toBeInTheDocument();
  });
});
