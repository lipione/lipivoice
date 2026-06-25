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
        {
          type: "audio",
          actor: "assistant",
          payload: {
            audioBase64: "UklGRg==",
            mimeType: "audio/wav",
            providerId: "piper",
            voiceId: "voice_lipi_ml_ne",
          },
        },
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

  it("uses VLLM_MODEL hint for the default remote LLM runtime model", async () => {
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
        VLLM_MODEL: "gemma-4-finetuned-indic-4b",
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

    await expect(deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" })).resolves.toEqual({
      events: [
        { type: "transcript", actor: "user", payload: { text: "Remote question", confidence: 0.8 } },
        { type: "transcript", actor: "assistant", payload: { text: "Remote answer" } },
        {
          type: "audio",
          actor: "assistant",
          payload: {
            audioBase64: "UklGRg==",
            mimeType: "audio/wav",
            providerId: "piper",
            voiceId: "voice_lipi_ml_ne",
          },
        },
      ],
    });
    expect(llmCalls).toEqual([
      {
        model: "gemma-4-finetuned-indic-4b",
        messages: [{ role: "user", content: "Remote question" }],
      },
    ]);

    repositories.close();
  });

  it("skips empty transcriptions without calling the LLM or TTS", async () => {
    const repositories = createRepositories(createDatabase(":memory:"));
    repositories.seedWorkspace(
      createRemoteWorkspace({
        now: "2026-05-29T00:00:00.000Z",
        vllmEndpoint: "http://127.0.0.1:8002/v1",
        vllmModel: "gemma-4",
        lipiMlEndpoint: "http://127.0.0.1:5001",
      }),
    );
    let llmCalls = 0;
    let ttsCalls = 0;
    let cleanedUp = false;
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote", VLLM_MODEL: "gemma-4" }),
      repositories,
      runtimes: {
        llm: {
          health: async () => ({ status: "healthy", reason: null }),
          chat: async () => {
            llmCalls += 1;
            return "unused";
          },
        },
        stt: {
          health: async () => ({ status: "healthy", reason: null }),
          transcribe: async () => ({ text: " \n ", confidence: null }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async () => {
            ttsCalls += 1;
            return { audioBase64: "unused", mimeType: "audio/wav" };
          },
        },
      },
      writeAudioChunkToWav: async () => ({
        wavPath: "/tmp/remote-turn.wav",
        cleanup: async () => {
          cleanedUp = true;
        },
      }),
    });

    await expect(deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" })).resolves.toEqual({
      events: [],
      skippedReason: "no_speech_detected",
    });
    expect(llmCalls).toBe(0);
    expect(ttsCalls).toBe(0);
    expect(cleanedUp).toBe(true);

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
    const requestedUrls: string[] = [];
    if (!repositories.tools.get("tool_collect_callback")) {
      throw new Error("Expected default tool to exist");
    }
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote", VLLM_MODEL: "gemma-4" }),
      repositories,
      runtimes: {
        llm: {
          health: async () => ({ status: "healthy", reason: null }),
          chat: async (input) =>
            input.messages.some((message) => message.content.includes("Tool result"))
              ? "Callback A123 will be arranged in 15 minutes."
              : 'TOOL_CALL {"toolId":"tool_collect_callback","arguments":{"name":"Amit","phoneNumber":"+97798123456","reason":"claim callback"}}',
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
    repositories.agents.save({ ...agent, toolIds: ["tool_collect_callback"] });

    const result = await deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" });

    expect(requestedUrls).toEqual(["https://example.com/insurance/callbacks"]);
    expect(result.events).toEqual([
      { type: "transcript", actor: "user", payload: { text: "Track order A123", confidence: 0.9 } },
      {
        type: "tool_call",
        actor: "tool",
        payload: expect.objectContaining({
          toolId: "tool_collect_callback",
          ok: true,
          status: 200,
        }),
      },
      { type: "transcript", actor: "assistant", payload: { text: "Callback A123 will be arranged in 15 minutes." } },
      {
        type: "audio",
        actor: "assistant",
        payload: {
          audioBase64: "UklGRg==",
          mimeType: "audio/wav",
          providerId: "piper",
          voiceId: "voice_lipi_ml_ne",
        },
      },
    ]);

    repositories.close();
  });

  it("uses the realtime session agent when processing audio", async () => {
    const repositories = createRepositories(createDatabase(":memory:"));
    repositories.seedWorkspace(
      createRemoteWorkspace({
        now: "2026-05-29T00:00:00.000Z",
        vllmEndpoint: "http://127.0.0.1:8002/v1",
        vllmModel: "gemma-4",
        lipiMlEndpoint: "http://127.0.0.1:5001",
      }),
    );
    const reception = repositories.agents.list()[0];
    repositories.agents.save({
      ...reception,
      id: "agent_support",
      name: "Support Agent",
      systemPrompt: "Use the support playbook.",
      voiceId: "voice_lipi_ml_ne",
    });
    const llmSystems: string[] = [];
    const ttsVoicePaths: string[] = [];
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote", VLLM_MODEL: "gemma-4" }),
      repositories,
      runtimes: {
        llm: {
          health: async () => ({ status: "healthy", reason: null }),
          chat: async (input) => {
            llmSystems.push(input.system);
            return "Support answer";
          },
        },
        stt: {
          health: async () => ({ status: "healthy", reason: null }),
          transcribe: async () => ({ text: "Need support", confidence: 0.9 }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async (input) => {
            ttsVoicePaths.push(input.voicePath);
            return { audioBase64: "UklGRg==", mimeType: "audio/wav" };
          },
        },
      },
      writeAudioChunkToWav: async () => ({ wavPath: "/tmp/remote-turn.wav", cleanup: async () => undefined }),
    });

    await deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" }, { agentId: "agent_support" });
    const session = await deps.createCallSession?.({ agentId: "agent_support" });
    await session?.finish({ status: "disconnected", failureReason: null });

    expect(llmSystems[0]).toContain("Use the support playbook.");
    expect(ttsVoicePaths).toEqual(["voice_lipi_ml_ne"]);
    expect(repositories.calls.list()[0]).toMatchObject({ agentId: "agent_support" });

    repositories.close();
  });

  it("routes realtime TTS through the selected agent voice runtime", async () => {
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
    repositories.agents.save({ ...agent, voiceId: "voice_piper_ne_sita" });
    const lipiMlVoicePaths: string[] = [];
    const piperHttpVoicePaths: string[] = [];
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote", VLLM_MODEL: "gemma-4" }),
      repositories,
      runtimes: {
        llm: {
          health: async () => ({ status: "healthy", reason: null }),
          chat: async () => "Piper HTTP voice answer",
        },
        stt: {
          health: async () => ({ status: "healthy", reason: null }),
          transcribe: async () => ({ text: "म बीमाको बारेमा बुझ्न चाहन्छु", confidence: 0.9 }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async (input) => {
            lipiMlVoicePaths.push(input.voicePath);
            return { audioBase64: "lipi_ml", mimeType: "audio/wav" };
          },
        },
      },
      ttsAdapters: {
        piper_http: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async (input) => {
            piperHttpVoicePaths.push(input.voicePath);
            return { audioBase64: "piper_http", mimeType: "audio/wav" as const, providerId: "piper_http", voiceId: input.voicePath };
          },
        },
      },
      writeAudioChunkToWav: async () => ({ wavPath: "/tmp/remote-turn.wav", cleanup: async () => undefined }),
    });

    await expect(deps.checkReady({ agentId: agent.id })).resolves.toEqual({ ready: true });
    const result = await deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" }, { agentId: agent.id });

    expect(lipiMlVoicePaths).toEqual([]);
    expect(piperHttpVoicePaths).toEqual(["voice_piper_ne_sita"]);
    expect(result.events).toContainEqual({
      type: "audio",
      actor: "assistant",
      payload: {
        audioBase64: "piper_http",
        mimeType: "audio/wav",
        providerId: "piper_http",
        voiceId: "voice_piper_ne_sita",
      },
    });

    repositories.close();
  });

  it("keeps realtime conversation history scoped to each session", async () => {
    const repositories = createRepositories(createDatabase(":memory:"));
    repositories.seedWorkspace(
      createRemoteWorkspace({
        now: "2026-05-29T00:00:00.000Z",
        vllmEndpoint: "http://127.0.0.1:8002/v1",
        vllmModel: "gemma-4",
        lipiMlEndpoint: "http://127.0.0.1:5001",
      }),
    );
    const llmMessages: Array<Array<{ role: "user" | "assistant"; content: string }>> = [];
    let turn = 0;
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote", VLLM_MODEL: "gemma-4" }),
      repositories,
      runtimes: {
        llm: {
          health: async () => ({ status: "healthy", reason: null }),
          chat: async (input) => {
            llmMessages.push(input.messages);
            turn += 1;
            return `answer ${turn}`;
          },
        },
        stt: {
          health: async () => ({ status: "healthy", reason: null }),
          transcribe: async () => ({ text: `question ${turn + 1}`, confidence: 0.9 }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async () => ({ audioBase64: "audio", mimeType: "audio/wav" }),
        },
      },
      writeAudioChunkToWav: async () => ({ wavPath: "/tmp/remote-turn.wav", cleanup: async () => undefined }),
    });
    const sessionA = { agentId: "agent_reception" };
    const sessionB = { agentId: "agent_reception" };

    await deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" }, sessionA);
    await deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" }, sessionA);
    await deps.processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" }, sessionB);

    expect(llmMessages).toEqual([
      [{ role: "user", content: "question 1" }],
      [
        { role: "user", content: "question 1" },
        { role: "assistant", content: "answer 1" },
        { role: "user", content: "question 2" },
      ],
      [{ role: "user", content: "question 3" }],
    ]);

    repositories.close();
  });

  it("applies workspace private URL policy to voice tool calls", async () => {
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
    const claimTool = repositories.tools.get("tool_claim_intake");
    if (!claimTool) {
      throw new Error("Expected default tool to exist");
    }
    const localTool = {
      ...claimTool,
      id: "tool_local_lookup",
      name: "Local lookup",
      url: "http://127.0.0.1:5001/orders/{orderId}",
      parameters: [{ name: "orderId", type: "string" as const, required: true }],
    };
    repositories.tools.save(localTool);
    repositories.agents.save({ ...agent, toolIds: ["tool_local_lookup"] });
    const requestedUrls: string[] = [];
    const createDeps = () =>
      createVoiceSocketDeps({
        config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote", VLLM_MODEL: "gemma-4" }),
        repositories,
        runtimes: {
          llm: {
            health: async () => ({ status: "healthy", reason: null }),
          chat: async (input) =>
            input.messages.some((message) => message.content.includes("Tool result"))
              ? "The local order is ready."
              : 'TOOL_CALL {"toolId":"tool_local_lookup","arguments":{"orderId":"A123"}}',
          },
          stt: {
            health: async () => ({ status: "healthy", reason: null }),
            transcribe: async () => ({ text: "Track local order A123", confidence: 0.9 }),
          },
          tts: {
            health: async () => ({ status: "healthy", reason: null }),
            synthesize: async () => ({ audioBase64: "UklGRg==", mimeType: "audio/wav" }),
          },
        },
        writeAudioChunkToWav: async () => ({ wavPath: "/tmp/remote-turn.wav", cleanup: async () => undefined }),
        toolFetch: async (url) => {
          requestedUrls.push(String(url));
          return Response.json({ status: "ready" });
        },
      });

    const blocked = await createDeps().processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" });
    repositories.settings.save({ ...repositories.settings.get(), allowPrivateToolUrls: true });
    repositories.agents.save({ ...agent, toolIds: ["tool_local_lookup"] });
    const allowed = await createDeps().processAudio({ mimeType: "audio/webm", audioBase64: "aW4=" });

    expect(blocked.events[1]).toEqual(
      expect.objectContaining({
        type: "tool_call",
        payload: expect.objectContaining({ ok: false, error: "unsafe_tool_url", attempts: 0 }),
      }),
    );
    expect(allowed.events[1]).toEqual(
      expect.objectContaining({
        type: "tool_call",
        payload: expect.objectContaining({ ok: true, status: 200 }),
      }),
    );
    expect(requestedUrls).toEqual(["http://127.0.0.1:5001/orders/A123"]);

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

  it("persists realtime call sessions and sanitizes stored audio events", async () => {
    const repositories = createRepositories(createDatabase(":memory:"));
    repositories.seedWorkspace(
      createRemoteWorkspace({
        now: "2026-05-29T00:00:00.000Z",
        vllmEndpoint: "http://127.0.0.1:8002/v1",
        vllmModel: "gemma-4",
        lipiMlEndpoint: "http://127.0.0.1:5001",
      }),
    );
    const dates = [
      new Date("2026-05-29T00:00:00.000Z"),
      new Date("2026-05-29T00:00:01.000Z"),
      new Date("2026-05-29T00:00:02.000Z"),
      new Date("2026-05-29T00:00:12.000Z"),
    ];
    const deps = createVoiceSocketDeps({
      config: loadServerConfig({ LIPIVOICE_RUNTIME_PRESET: "remote" }),
      repositories,
      runtimes: {
        llm: { health: async () => ({ status: "healthy", reason: null }), chat: async () => "unused" },
        stt: {
          health: async () => ({ status: "healthy", reason: null }),
          transcribe: async () => ({ text: "unused", confidence: null }),
        },
        tts: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async () => ({ audioBase64: "unused", mimeType: "audio/wav" }),
        },
      },
      now: () => dates.shift() ?? new Date("2026-05-29T00:00:12.000Z"),
    });

    const session = await deps.createCallSession?.();
    await session?.record({ type: "transcript", actor: "user", payload: { text: "hello" }, severity: "info" });
    await session?.record({
      type: "audio",
      actor: "assistant",
      payload: { mimeType: "audio/wav", audioBase64: "UklGRg==" },
      severity: "info",
    });
    await session?.finish({ status: "disconnected", failureReason: null });

    const [call] = repositories.calls.list();
    expect(call).toMatchObject({
      channel: "web",
      direction: "inbound",
      status: "disconnected",
      startedAt: "2026-05-29T00:00:00.000Z",
      endedAt: "2026-05-29T00:00:12.000Z",
      durationSeconds: 12,
      failureReason: null,
    });
    expect(repositories.callEvents.listForCall(call.id).map((event) => ({
      type: event.type,
      actor: event.actor,
      payload: event.payload,
      severity: event.severity,
    }))).toEqual([
      { type: "status", actor: "system", payload: { status: "connected" }, severity: "info" },
      { type: "transcript", actor: "user", payload: { text: "hello" }, severity: "info" },
      {
        type: "audio",
        actor: "assistant",
        payload: { mimeType: "audio/wav", audioBytes: 4 },
        severity: "info",
      },
    ]);

    repositories.close();
  });
});
