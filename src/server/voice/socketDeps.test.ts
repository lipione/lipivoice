import { describe, expect, it } from "vitest";
import { createRemoteWorkspace } from "@/domain/defaults";
import { loadServerConfig } from "@/server/config";
import { createDatabase } from "@/server/store/database";
import { createRepositories } from "@/server/store/repositories";
import { createVoiceSocketDeps } from "./socketDeps";

describe("voice socket dependencies", () => {
  it("processes one remote voice turn with configured runtimes", async () => {
    const repositories = createRepositories(createDatabase(":memory:"));
    repositories.seedWorkspace(
      createRemoteWorkspace({
        now: "2026-05-29T00:00:00.000Z",
        vllmEndpoint: "http://127.0.0.1:8002/v1",
        vllmModel: "gemma-4",
        lipiMlEndpoint: "http://127.0.0.1:5001",
      }),
    );
    const llmCalls: Array<{ model: string; messages: Array<{ role: "user" | "assistant"; content: string }> }> = [];
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({
        LIPIVOICE_RUNTIME_PRESET: "remote",
        VLLM_BASE_URL: "http://127.0.0.1:8002/v1",
        VLLM_MODEL: "gemma-4",
        LIPI_ML_BASE_URL: "http://127.0.0.1:5001",
      }),
      repositories,
      runtimes: {
        llm: {
          health: async () => ({ status: "healthy", reason: null }),
          chat: async (input) => {
            llmCalls.push({ model: input.model, messages: input.messages });
            return "Remote answer";
          },
        },
        stt: {
          health: async () => ({ status: "healthy", reason: null }),
          transcribe: async () => ({ text: "Remote question", confidence: 0.8 }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async () => ({ audioBase64: "UklGRg==", mimeType: "audio/wav" }),
        },
      },
      writeAudioChunkToWav: async () => ({ wavPath: "/tmp/remote-turn.wav", cleanup: async () => undefined }),
    });

    await expect(deps.checkReady()).resolves.toEqual({ ready: true });
    await expect(deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" })).resolves.toEqual({
      events: [
        { type: "transcript", actor: "user", payload: { text: "Remote question", confidence: 0.8 } },
        { type: "transcript", actor: "assistant", payload: { text: "Remote answer" } },
        { type: "audio", actor: "assistant", payload: { audioBase64: "UklGRg==", mimeType: "audio/wav" } },
      ],
    });
    expect(llmCalls).toEqual([
      {
        model: "gemma-4",
        messages: [{ role: "user", content: "Remote question" }],
      },
    ]);

    repositories.close();
  });

  it("passes assigned agent tools into the remote voice turn", async () => {
    const repositories = createRepositories(createDatabase(":memory:"));
    repositories.seedWorkspace(
      createRemoteWorkspace({
        now: "2026-05-29T00:00:00.000Z",
        vllmEndpoint: "http://127.0.0.1:8002/v1",
        vllmModel: "gemma-4",
        lipiMlEndpoint: "http://127.0.0.1:5001",
      }),
    );
    const agent = repositories.agents.list()[0];
    repositories.agents.save({ ...agent, toolIds: ["tool_order_lookup"] });
    const requestedUrls: string[] = [];
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote", VLLM_MODEL: "gemma-4" }),
      repositories,
      runtimes: {
        llm: {
          health: async () => ({ status: "healthy", reason: null }),
          chat: async (input) =>
            input.messages.some((message) => message.content.includes("Tool result"))
              ? "Order A123 arrives Friday."
              : 'TOOL_CALL {"toolId":"tool_order_lookup","arguments":{"orderId":"A123"}}',
        },
        stt: {
          health: async () => ({ status: "healthy", reason: null }),
          transcribe: async () => ({ text: "Track order A123", confidence: 0.9 }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async () => ({ audioBase64: "UklGRg==", mimeType: "audio/wav" }),
        },
      },
      writeAudioChunkToWav: async () => ({ wavPath: "/tmp/remote-turn.wav", cleanup: async () => undefined }),
      toolFetch: async (url) => {
        requestedUrls.push(String(url));
        return Response.json({ status: "in_transit", eta: "Friday" });
      },
    });

    const result = await deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" });

    expect(requestedUrls).toEqual(["https://example.com/orders/A123"]);
    expect(result.events).toEqual([
      { type: "transcript", actor: "user", payload: { text: "Track order A123", confidence: 0.9 } },
      {
        type: "tool_call",
        actor: "tool",
        payload: expect.objectContaining({
          toolId: "tool_order_lookup",
          ok: true,
          status: 200,
        }),
      },
      { type: "transcript", actor: "assistant", payload: { text: "Order A123 arrives Friday." } },
      { type: "audio", actor: "assistant", payload: { audioBase64: "UklGRg==", mimeType: "audio/wav" } },
    ]);

    repositories.close();
  });

  it("reports runtime_not_configured when any remote runtime is unhealthy", async () => {
    const repositories = createRepositories(createDatabase(":memory:"));
    repositories.seedWorkspace(
      createRemoteWorkspace({
        now: "2026-05-29T00:00:00.000Z",
        vllmEndpoint: "http://127.0.0.1:8002/v1",
        vllmModel: "gemma-4",
        lipiMlEndpoint: "http://127.0.0.1:5001",
      }),
    );
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote" }),
      repositories,
      runtimes: {
        llm: { health: async () => ({ status: "healthy", reason: null }), chat: async () => "unused" },
        stt: {
          health: async () => ({ status: "unavailable", reason: "runtime_unavailable" }),
          transcribe: async () => ({ text: "unused", confidence: null }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async () => ({ audioBase64: "unused", mimeType: "audio/wav" }),
        },
      },
    });

    await expect(deps.checkReady()).resolves.toEqual({ ready: false, reason: "runtime_not_configured" });

    repositories.close();
  });
});
