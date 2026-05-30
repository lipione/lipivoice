import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentsPage } from "./AgentsPage";

const agents = [
  {
    id: "agent_1",
    name: "Reception",
    systemPrompt: "Be concise.",
    greeting: "Hi",
    language: "en",
    modelRuntimeId: "runtime_ollama",
    modelAssetId: "model_llama32_3b",
    voiceId: "voice_piper_amy",
    transcriberRuntimeId: "runtime_whisper_cpp",
    recordingEnabled: false,
    interruptionSensitivity: "medium",
    toolIds: [],
    knowledgeBaseIds: [],
    deploymentState: "draft",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
  },
  {
    id: "agent_2",
    name: "Support",
    systemPrompt: "Be helpful.",
    greeting: "Hello",
    language: "en",
    modelRuntimeId: "runtime_ollama",
    modelAssetId: "model_llama32_3b",
    voiceId: "voice_piper_amy",
    transcriberRuntimeId: "runtime_whisper_cpp",
    recordingEnabled: true,
    interruptionSensitivity: "high",
    toolIds: ["tool_order_lookup"],
    knowledgeBaseIds: [],
    deploymentState: "ready",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
  },
];

function stubAgentsApi({
    agentsResponse = agents,
    runtimesResponse = [
      {
        id: "runtime_ollama",
        kind: "llm",
        adapter: "ollama",
        endpoint: "http://127.0.0.1:11434",
        healthStatus: "healthy",
        configuredState: "configured",
        defaultModelId: "model_llama32_3b",
        concurrencyLimit: 1,
        hardwareHints: ["local"],
      },
      {
        id: "runtime_whisper_cpp",
        kind: "stt",
        adapter: "whisper_cpp",
        endpoint: "",
        healthStatus: "missing_model",
        configuredState: "not_configured",
        defaultModelId: "model_whisper_base_en",
        concurrencyLimit: 1,
        hardwareHints: ["cpu"],
      },
      {
        id: "runtime_piper",
        kind: "tts",
        adapter: "piper",
        endpoint: "",
        healthStatus: "missing_model",
        configuredState: "not_configured",
        defaultModelId: "model_piper_amy",
        concurrencyLimit: 1,
        hardwareHints: ["cpu"],
      },
    ],
    toolsResponse = [
      {
        id: "tool_order_lookup",
        name: "Order lookup",
        description: "Find order status.",
        method: "GET",
        url: "https://example.com/orders",
        authMode: "none",
        headers: [],
        parameters: [],
        timeoutMs: 5000,
        retryCount: 0,
        responseSchema: "{}",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
    ],
    voicesResponse = [
      {
        id: "voice_piper_amy",
        name: "Piper Amy",
        runtimeId: "runtime_piper",
        type: "builtin",
        language: "en-US",
        tags: ["local"],
        previewUrl: "",
        privacy: "workspace",
        cloneStatus: "not_clone",
        consentId: null,
      },
    ],
}: {
  agentsResponse?: unknown;
  runtimesResponse?: unknown;
  toolsResponse?: unknown;
  voicesResponse?: unknown;
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/agents")) {
        if (init?.method === "POST") {
          return Response.json(JSON.parse(String(init.body)));
        }
        return Response.json(agentsResponse);
      }
      if (url.endsWith("/api/model-runtimes")) {
        return Response.json(runtimesResponse);
      }
      if (url.endsWith("/api/tools")) {
        return Response.json(toolsResponse);
      }
      if (url.endsWith("/api/voices")) {
        return Response.json(voicesResponse);
      }
      return Response.json([]);
    }),
  );
}

describe("AgentsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows agent prompt and runtime health", async () => {
    stubAgentsApi();

    render(<AgentsPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Reception")).toBeInTheDocument());
    expect(screen.getByText("ollama")).toBeInTheDocument();
  });

  it("renders fallback runtime values when runtime data is incomplete", async () => {
    stubAgentsApi({
      runtimesResponse: [{ id: "runtime_broken", healthStatus: "not_a_status" }],
    });

    render(<AgentsPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Reception")).toBeInTheDocument());
    expect(screen.getAllByText("unknown")).toHaveLength(2);
    expect(screen.getByText("Unchecked")).toBeInTheDocument();
  });

  it("keeps local edits scoped to the selected agent", async () => {
    const user = userEvent.setup();
    stubAgentsApi();

    render(<AgentsPage />);

    const nameInput = await screen.findByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Front Desk");

    await user.click(screen.getByRole("button", { name: /Support/ }));
    expect(screen.getByDisplayValue("Support")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Front Desk")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Front Desk/ }));
    expect(screen.getByDisplayValue("Front Desk")).toBeInTheDocument();
  });

  it("saves runtime, recording, and tool selections for the selected agent", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/agents")) {
        if (init?.method === "POST") {
          return Response.json(JSON.parse(String(init.body)));
        }
        return Response.json(agents);
      }
      if (url.endsWith("/api/model-runtimes")) {
        return Response.json([
          {
            id: "runtime_ollama",
            kind: "llm",
            adapter: "ollama",
            endpoint: "http://127.0.0.1:11434",
            healthStatus: "healthy",
            configuredState: "configured",
            defaultModelId: "model_llama32_3b",
            concurrencyLimit: 1,
            hardwareHints: ["local"],
          },
          {
            id: "runtime_whisper_cpp",
            kind: "stt",
            adapter: "whisper_cpp",
            endpoint: "",
            healthStatus: "healthy",
            configuredState: "configured",
            defaultModelId: "model_whisper_base_en",
            concurrencyLimit: 1,
            hardwareHints: ["cpu"],
          },
          {
            id: "runtime_piper",
            kind: "tts",
            adapter: "piper",
            endpoint: "",
            healthStatus: "healthy",
            configuredState: "configured",
            defaultModelId: "model_piper_amy",
            concurrencyLimit: 1,
            hardwareHints: ["cpu"],
          },
        ]);
      }
      if (url.endsWith("/api/tools")) {
        return Response.json([
          {
            id: "tool_order_lookup",
            name: "Order lookup",
            description: "Find order status.",
            method: "GET",
            url: "https://example.com/orders",
            authMode: "none",
            headers: [],
            parameters: [],
            timeoutMs: 5000,
            retryCount: 0,
            responseSchema: "{}",
            createdAt: "2026-05-29T00:00:00.000Z",
            updatedAt: "2026-05-29T00:00:00.000Z",
          },
        ]);
      }
      if (url.endsWith("/api/knowledge-bases")) {
        return Response.json([
          {
            id: "kb_reception_faq",
            name: "Reception FAQ",
            description: "Common caller answers.",
            status: "ready",
            documentCount: 1,
            createdAt: "2026-05-31T00:00:00.000Z",
            updatedAt: "2026-05-31T00:00:00.000Z",
          },
        ]);
      }
      if (url.endsWith("/api/voices")) {
        return Response.json([
          {
            id: "voice_piper_amy",
            name: "Piper Amy",
            runtimeId: "runtime_piper",
            type: "builtin",
            language: "en-US",
            tags: ["local"],
            previewUrl: "",
            privacy: "workspace",
            cloneStatus: "not_clone",
            consentId: null,
          },
        ]);
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<AgentsPage />);

    await user.click(await screen.findByRole("checkbox", { name: "Order lookup" }));
    await user.click(screen.getByRole("checkbox", { name: "Reception FAQ" }));
    await user.click(screen.getByRole("checkbox", { name: "Record calls" }));
    await user.click(screen.getByRole("button", { name: "Save agent" }));

    await waitFor(() => expect(screen.getByText("Agent saved")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/agents",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"toolIds\":[\"tool_order_lookup\"]"),
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/agents",
      expect.objectContaining({
        body: expect.stringContaining("\"recordingEnabled\":true"),
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/agents",
      expect.objectContaining({
        body: expect.stringContaining("\"knowledgeBaseIds\":[\"kb_reception_faq\"]"),
      }),
    );
  });

  it("shows an error state when fetching agents fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/agents")) {
          return Response.json({ code: "internal_error" }, { status: 500 });
        }
        return Response.json([]);
      }),
    );

    render(<AgentsPage />);

    expect(await screen.findByText("Request failed: 500")).toBeInTheDocument();
  });

  it("shows an empty agent list state", async () => {
    stubAgentsApi({ agentsResponse: [] });

    render(<AgentsPage />);

    expect(await screen.findByText("No agents configured.")).toBeInTheDocument();
    expect(screen.getByText("0 configured")).toBeInTheDocument();
  });
});
