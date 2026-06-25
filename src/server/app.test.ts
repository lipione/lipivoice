import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace, createRemoteWorkspace } from "@/domain/defaults";
import { createAppContextForTest, createAppForTest } from "./app";
import { loadServerConfig } from "./config";

describe("server app", () => {
  it("requires the admin token when configured", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      adminToken: "admin-token",
    });

    await request(app).get("/api/agents").expect(401);
    await request(app).get("/api/agents").set("Authorization", "Bearer admin-token").expect(200);
    await request(app).get("/api/health").expect(200);
    await request(app)
      .get("/api/auth/status")
      .expect(200, { required: true, authenticated: false });
    await request(app)
      .get("/api/auth/status")
      .set("Authorization", "Bearer admin-token")
      .expect(200, { required: true, authenticated: true });
  });

  it("exchanges valid admin credentials for the admin token", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      adminToken: "admin-token",
      adminUsername: "operator",
      adminPassword: "secret-password",
    });

    await request(app)
      .post("/api/auth/login")
      .send({ username: "operator", password: "wrong" })
      .expect(401, { code: "invalid_credentials" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "operator", password: "secret-password" })
      .expect(200);

    expect(response.body).toEqual({ token: "admin-token" });
  });

  it("keeps worker-key endpoints separate from admin auth", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      adminToken: "admin-token",
      workerApiKey: "worker-token",
    });
    const call = context.repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: "agent_reception",
      status: "connected",
      startedAt: "2026-05-29T00:00:00.000Z",
    });

    await request(context.app)
      .get("/api/worker/session-config")
      .query({ callId: call.id })
      .set("x-lipivoice-worker-key", "worker-token")
      .expect(200);
    await request(context.app)
      .get("/api/worker/session-config")
      .query({ callId: call.id })
      .set("Authorization", "Bearer admin-token")
      .expect(401);
  });

  it("rate limits expensive session creation endpoints", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    for (let index = 0; index < 20; index += 1) {
      await request(app)
        .post("/api/realtime/session")
        .send({ agentId: "agent_reception" })
        .expect(201);
    }

    await request(app)
      .post("/api/realtime/session")
      .send({ agentId: "agent_reception" })
      .expect(429, { code: "rate_limited" });
  });

  it("returns seeded agents and runtimes", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const agents = await request(app).get("/api/agents").expect(200);
    const runtimes = await request(app).get("/api/model-runtimes").expect(200);

    expect(agents.body).toHaveLength(1);
    expect(runtimes.body.some((runtime: { adapter: string }) => runtime.adapter === "ollama")).toBe(
      true,
    );
  });

  it("overlays runtime health checks onto configured runtimes", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      runtimeHealth: {
        whisper_cpp: async () => ({ status: "missing_model", reason: "runtime_not_configured" }),
        piper: async () => ({ status: "healthy", reason: null }),
      },
    });

    const response = await request(app).get("/api/model-runtimes").expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "whisper_cpp",
          configuredState: "not_configured",
          healthStatus: "missing_model",
        }),
        expect.objectContaining({
          adapter: "piper",
          configuredState: "configured",
          healthStatus: "healthy",
        }),
      ]),
    );
  });

  it("returns model runtime health from the explicit health endpoint", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      runtimeHealth: {
        ollama: async () => ({ status: "healthy", reason: null }),
      },
    });

    const response = await request(app).post("/api/model-runtimes/health").send({}).expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "ollama",
          configuredState: "configured",
          healthStatus: "healthy",
        }),
      ]),
    );
  });

  it("lists the Nepali TTS provider candidates with current readiness", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      runtimeHealth: {
        piper: async () => ({ status: "healthy", reason: null }),
        piper_http: async () => ({ status: "healthy", reason: null }),
        coqui_http: async () => ({ status: "healthy", reason: null }),
        omnivoice: async () => ({ status: "healthy", reason: null }),
        indic_parler: async () => ({ status: "license_required", reason: "hf_token_required" }),
      },
    });

    const response = await request(app).get("/api/tts/providers").expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "piper_http_tts",
          name: "Piper HTTP TTS",
          access: "open",
          healthStatus: "healthy",
        }),
        expect.objectContaining({
          id: "coqui_xtts",
          name: "Coqui XTTS",
          healthStatus: "healthy",
        }),
        expect.objectContaining({
          id: "indic_parler_tts",
          name: "Indic Parler Nepali",
          role: "Nepali fine-tuned Parler-TTS evaluation candidate",
          healthStatus: "license_required",
        }),
        expect.objectContaining({
          id: "omnivoice",
          name: "OmniVoice",
          role: "experimental multilingual and cloning candidate",
          healthStatus: "healthy",
          runtimeId: null,
        }),
        expect.objectContaining({
          id: "chatterbox_nepali",
          name: "Chatterbox Nepali",
          access: "gated",
          healthStatus: "license_required",
        }),
        expect.objectContaining({
          id: "coqui_piper_vits",
          name: "LipiVoice Studio",
          healthStatus: "healthy",
          runtimeId: "runtime_piper",
        }),
      ]),
    );
  });

  it("benchmarks the available LipiVoice Studio provider through the configured TTS adapter", async () => {
    const tts = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav" as const,
      })),
    };
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      tts,
      runtimeHealth: {
        piper: tts.health,
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });

    const response = await request(app)
      .post("/api/tts/benchmark")
      .send({ providerId: "coqui_piper_vits", text: "नमस्ते, लिपिभ्वाइस परीक्षण हो।" })
      .expect(200);

    expect(tts.synthesize).toHaveBeenCalledWith({
      text: "नमस्ते, लिपिभ्वाइस परीक्षण हो।",
      voicePath: "voice_piper_amy",
    });
    expect(response.body).toEqual({
      id: expect.any(String),
      providerId: "coqui_piper_vits",
      providerName: "LipiVoice Studio",
      text: "नमस्ते, लिपिभ्वाइस परीक्षण हो।",
      status: "generated",
      healthStatus: "healthy",
      code: null,
      audioBase64: Buffer.from("wav-data").toString("base64"),
      mimeType: "audio/wav",
      latencyMs: expect.any(Number),
      createdAt: "2026-05-31T00:00:00.000Z",
    });
  });

  it("benchmarks Piper HTTP through the configured adapter", async () => {
    const piperHttp = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav" as const,
        providerId: "piper_http",
        voiceId: "voice_piper_ne_sita",
      })),
    };
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      ttsAdapters: {
        piper_http: piperHttp,
      },
      runtimeHealth: {
        piper_http: piperHttp.health,
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });

    const response = await request(app)
      .post("/api/tts/benchmark")
      .send({ providerId: "piper_http_tts", text: "नमस्ते" })
      .expect(200);

    expect(piperHttp.synthesize).toHaveBeenCalled();
    expect(response.body).toMatchObject({
      providerId: "piper_http_tts",
      providerName: "Piper HTTP TTS",
      status: "generated",
      healthStatus: "healthy",
      code: null,
      audioBase64: Buffer.from("wav-data").toString("base64"),
      mimeType: "audio/wav",
      createdAt: "2026-05-31T00:00:00.000Z",
    });
  });

  it("returns a benchmark readiness result when a provider is not installed", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      runtimeHealth: {
        indic_parler: async () => ({ status: "missing_model", reason: "model_catalog_not_found" }),
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });

    const response = await request(app)
      .post("/api/tts/benchmark")
      .send({ providerId: "indic_parler_tts", text: "नमस्ते" })
      .expect(409);

    expect(response.body).toMatchObject({
      providerId: "indic_parler_tts",
      providerName: "Indic Parler Nepali",
      status: "unavailable",
      healthStatus: "missing_model",
      code: "provider_not_installed",
      createdAt: "2026-05-31T00:00:00.000Z",
    });
  });

  it("returns a structured benchmark result when provider synthesis fails", async () => {
    const piperHttp = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    };
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      ttsAdapters: {
        piper_http: piperHttp,
      },
      runtimeHealth: {
        piper_http: piperHttp.health,
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });

    const response = await request(app)
      .post("/api/tts/benchmark")
      .send({ providerId: "piper_http_tts", text: "नमस्ते" })
      .expect(502);

    expect(response.body).toMatchObject({
      providerId: "piper_http_tts",
      status: "unavailable",
      healthStatus: "healthy",
      code: "provider_synthesis_failed",
      audioBase64: null,
      mimeType: null,
      createdAt: "2026-05-31T00:00:00.000Z",
    });
  });

  it("returns a local usage summary", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"));
    const agent = context.repositories.agents.list()[0];
    context.repositories.calls.update({
      ...context.repositories.calls.create({
        channel: "web",
        direction: "inbound",
        agentId: agent.id,
        status: "disconnected",
        startedAt: "2026-05-31T00:00:00.000Z",
      }),
      endedAt: "2026-05-31T00:02:00.000Z",
      durationSeconds: 120,
      costEstimateUsd: 0.15,
    });
    context.repositories.toolExecutions.append({
      toolId: "tool_order_lookup",
      toolName: "Order lookup",
      timestamp: "2026-05-31T00:00:00.000Z",
      ok: true,
      status: 200,
      attempts: 1,
      durationMs: 20,
      error: null,
      request: { method: "GET", url: "https://example.com/orders/A123", headers: [] },
      response: { body: "{\"status\":\"shipped\"}" },
    });

    const response = await request(context.app).get("/api/usage").expect(200);

    expect(response.body).toEqual({
      agents: 1,
      phoneNumbers: 1,
      callsTotal: 1,
      activeCalls: 0,
      callMinutes: 2,
      estimatedCostUsd: 0.15,
      toolExecutions: 1,
      knowledgeBases: 1,
      knowledgeDocuments: 1,
    });
  });

  it("expires stale connected calls before listing calls and usage", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      now: () => new Date("2026-05-31T00:20:00.000Z"),
    });
    const agent = context.repositories.agents.list()[0];
    const staleCall = context.repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: agent.id,
      status: "connected",
      startedAt: "2026-05-31T00:00:00.000Z",
    });
    context.repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: agent.id,
      status: "connected",
      startedAt: "2026-05-31T00:19:00.000Z",
    });
    const abandonedSimulation = context.repositories.calls.update({
      ...context.repositories.calls.create({
        channel: "simulation",
        direction: "inbound",
        agentId: agent.id,
        status: "disconnected",
        startedAt: "2026-05-31T00:00:00.000Z",
      }),
      endedAt: "2026-05-31T12:00:00.000Z",
      durationSeconds: 43_200,
    });

    const calls = await request(context.app).get("/api/calls").expect(200);
    const usage = await request(context.app).get("/api/usage").expect(200);

    expect(calls.body.find((call: { id: string }) => call.id === staleCall.id)).toMatchObject({
      status: "disconnected",
      endedAt: "2026-05-31T00:20:00.000Z",
      durationSeconds: 600,
      failureReason: "stale_session_expired",
    });
    expect(calls.body.find((call: { id: string }) => call.id === abandonedSimulation.id)).toMatchObject({
      durationSeconds: 600,
      failureReason: "stale_session_expired",
    });
    expect(usage.body).toMatchObject({
      callsTotal: 3,
      activeCalls: 1,
      callMinutes: 20,
    });
  });

  it("creates a simulated call with an initial event", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));
    const agentId = (await request(app).get("/api/agents")).body[0].id;

    const response = await request(app)
      .post("/api/calls/simulate")
      .send({ agentId })
      .expect(201);

    expect(response.body.call.status).toBe("connected");
    expect(response.body.events[0].payload.status).toBe("connected");
  });

  it("starts a LiveKit web call and returns connection data", async () => {
    const liveKit = {
      startWebCall: vi.fn().mockResolvedValue({
        wsUrl: "ws://127.0.0.1:7880",
        roomName: "lipivoice-call-call_123",
        participantIdentity: "caller_call_123",
        token: "jwt-token",
        dispatchId: "dispatch_1",
      }),
    };
    const { app } = createAppContextForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }), { liveKit });

    const response = await request(app)
      .post("/api/livekit/web-call/start")
      .send({ agentId: "agent_reception" })
      .expect(201);

    expect(response.body.call.channel).toBe("web");
    expect(response.body.events[0].type).toBe("status");
    expect(response.body.livekit.token).toBe("jwt-token");
    expect(liveKit.startWebCall).toHaveBeenCalledWith({
      callId: response.body.call.id,
      agentId: "agent_reception",
      participantIdentity: `caller_${response.body.call.id}`,
    });
  });

  it("persists worker events with a worker API key", async () => {
    const { app, repositories } = createAppContextForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }), { workerApiKey: "worker-secret" });
    const call = repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: "agent_reception",
      status: "connected",
      startedAt: "2026-06-02T00:00:00.000Z",
    });

    const response = await request(app)
      .post(`/api/worker/calls/${call.id}/events`)
      .set("x-lipivoice-worker-key", "worker-secret")
      .send({
        events: [
          {
            type: "transcript",
            actor: "assistant",
            payload: { text: "नमस्ते" },
            severity: "info",
          },
        ],
      })
      .expect(201);

    expect(response.body.events).toHaveLength(1);
    expect(repositories.callEvents.listForCall(call.id)).toMatchObject([
      expect.objectContaining({
        type: "transcript",
        actor: "assistant",
        payload: { text: "नमस्ते" },
      }),
    ]);
  });

  it("materializes operation records from worker transcript events when tools are not called", async () => {
    const { app, repositories } = createAppContextForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }), { workerApiKey: "worker-secret", now: () => new Date("2026-06-02T01:00:00.000Z") });
    const call = repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: "agent_reception",
      status: "connected",
      startedAt: "2026-06-02T00:00:00.000Z",
    });

    await request(app)
      .post(`/api/worker/calls/${call.id}/events`)
      .set("x-lipivoice-worker-key", "worker-secret")
      .send({
        events: [
          {
            type: "transcript",
            actor: "user",
            payload: { text: "मेरो नाम Sita हो। claim बारे supervisor follow-up चाहियो।" },
            severity: "info",
          },
          {
            type: "transcript",
            actor: "user",
            payload: { text: "मेरो फोन ९८ ०१ २३ ४५ ६७ हो।" },
            severity: "info",
          },
        ],
      })
      .expect(201);

    expect(repositories.customers.list()).toEqual([
      expect.objectContaining({
        name: "Sita",
        phoneNumber: "9801234567",
        lastCallId: call.id,
        source: "voice_call",
      }),
    ]);
    expect(repositories.tickets.list()).toEqual([
      expect.objectContaining({
        customerId: repositories.customers.list()[0]?.id,
        callId: call.id,
        status: "open",
        priority: "high",
        source: "voice_call",
      }),
    ]);
  });

  it("materializes a new insurance inquiry from Nepali transcript turns", async () => {
    const { app, repositories } = createAppContextForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }), { workerApiKey: "worker-secret", now: () => new Date("2026-06-02T01:00:00.000Z") });
    const call = repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: "agent_reception",
      status: "connected",
      startedAt: "2026-06-02T00:00:00.000Z",
    });

    await request(app)
      .post(`/api/worker/calls/${call.id}/events`)
      .set("x-lipivoice-worker-key", "worker-secret")
      .send({
        events: [
          { type: "transcript", actor: "user", payload: { text: "मेरो नाम उपेन्द्र मान श्रेष्ठ हो।" } },
          { type: "transcript", actor: "user", payload: { text: "मलाई खुट्टाको इन्सुरेन्स गर्ने थियो।" } },
          { type: "transcript", actor: "user", payload: { text: "मेरो नम्बर ९८ ४१ ५ १२ ३ १३ हो।" } },
        ],
      })
      .expect(201);

    expect(repositories.customers.list()).toEqual([
      expect.objectContaining({
        name: "उपेन्द्र मान श्रेष्ठ",
        phoneNumber: "9841512313",
        source: "voice_call",
      }),
    ]);
    expect(repositories.tickets.list()).toEqual([
      expect.objectContaining({
        callId: call.id,
        type: "policy_question",
        priority: "normal",
        source: "voice_call",
      }),
    ]);
  });

  it("executes worker business tools and records the tool call", async () => {
    const { app, repositories } = createAppContextForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }), { workerApiKey: "worker-secret", now: () => new Date("2026-06-02T01:00:00.000Z") });
    const call = repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: "agent_reception",
      status: "connected",
      startedAt: "2026-06-02T00:00:00.000Z",
    });

    const response = await request(app)
      .post(`/api/worker/calls/${call.id}/tools/customer-lookup`)
      .set("x-lipivoice-worker-key", "worker-secret")
      .send({ phoneNumber: "+977 9801234567" })
      .expect(200);

    expect(response.body.result).toMatchObject({
      ok: true,
      found: false,
      customer: {
        name: "Caller",
        phoneNumber: "9779801234567",
      },
    });
    expect(repositories.customers.list()).toEqual([
      expect.objectContaining({
        phoneNumber: "9779801234567",
        lastCallId: call.id,
        source: "voice_call",
      }),
    ]);
    expect(repositories.callEvents.listForCall(call.id)).toEqual([
      expect.objectContaining({
        type: "tool_call",
        actor: "tool",
        timestamp: "2026-06-02T01:00:00.000Z",
        payload: expect.objectContaining({
          toolName: "customer-lookup",
          input: { phoneNumber: "+977 9801234567" },
          result: expect.objectContaining({ found: false }),
        }),
      }),
    ]);
  });

  it("persists worker callback, transfer, and escalation records", async () => {
    const { app, repositories } = createAppContextForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }), { workerApiKey: "worker-secret", now: () => new Date("2026-06-02T01:00:00.000Z") });
    const call = repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: "agent_reception",
      status: "connected",
      startedAt: "2026-06-02T00:00:00.000Z",
    });

    await request(app)
      .post(`/api/worker/calls/${call.id}/tools/schedule-callback`)
      .set("x-lipivoice-worker-key", "worker-secret")
      .send({ name: "Sita", phoneNumber: "9801234567", preferredTime: "tomorrow morning", reason: "renewal" })
      .expect(200);
    await request(app)
      .post(`/api/worker/calls/${call.id}/tools/transfer-call`)
      .set("x-lipivoice-worker-key", "worker-secret")
      .send({ name: "Sita", phoneNumber: "9801234567", department: "claims", reason: "claim question" })
      .expect(200);
    await request(app)
      .post(`/api/worker/calls/${call.id}/tools/create-escalation`)
      .set("x-lipivoice-worker-key", "worker-secret")
      .send({ name: "Sita", phoneNumber: "9801234567", urgency: "urgent", reason: "complaint follow-up" })
      .expect(200);

    expect(repositories.customers.list()).toHaveLength(1);
    expect(repositories.appointments.list()).toEqual([
      expect.objectContaining({ callId: call.id, callerName: "Sita", status: "scheduled" }),
    ]);
    expect(repositories.transfers.list()).toEqual([
      expect.objectContaining({ callId: call.id, department: "claims", status: "queued" }),
    ]);
    expect(repositories.tickets.list()).toEqual([
      expect.objectContaining({ callId: call.id, priority: "urgent", status: "open" }),
    ]);
  });

  it("runs a conversational Nepali simulated call turn without replacing a selected managed voice with local fallback", async () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });
    const llm = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      chat: vi.fn(async () => "नमस्ते, म तपाईंलाई सहयोग गर्न तयार छु।"),
    };
    const piperHttpFailing = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => {
        throw new Error("piper_http blocked");
      }),
    };
    const piperTts = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav" as const,
        providerId: "piper",
        voiceId: "voice_lipi_ml_ne",
      })),
    };
    const app = createAppForTest(workspace, {
      llm,
      llmModel: "gemma-4",
      tts: piperTts,
      ttsAdapters: {
        piper_http: piperHttpFailing,
        piper: piperTts,
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const agentId = workspace.agents[0].id;
    const started = await request(app).post("/api/calls/simulate").send({ agentId }).expect(201);

    const response = await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({
        text: "नमस्ते, मेरो अर्डर कहाँ छ?",
        language: "ne",
        voiceId: "voice_lipi_ml_ne",
      })
      .expect(200);

    expect(llm.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemma-4",
        system: expect.stringContaining("नेपालीमा मात्र"),
        messages: [{ role: "user", content: "नमस्ते, मेरो अर्डर कहाँ छ?" }],
      }),
    );
    expect(response.body).toMatchObject({
      assistantText: "नमस्ते, म तपाईंलाई सहयोग गर्न तयार छु।",
    });
  });

  it("asks for Nepali or English instead of sending unsupported mixed speech to the LLM", async () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });
    const llm = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      chat: vi.fn(async () => "should not be called"),
    };
    const piperTts = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav" as const,
        providerId: "piper",
        voiceId: "voice_lipi_ml_ne",
      })),
    };
    const app = createAppForTest(workspace, {
      llm,
      llmModel: "gemma-4",
      tts: piperTts,
      ttsAdapters: {
        piper: piperTts,
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const started = await request(app).post("/api/calls/simulate").send({ agentId: workspace.agents[0].id }).expect(201);

    const response = await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({
        text: "पति पार्स तो इंचरेंस गरिक्प।",
        language: "ne",
        voiceId: "voice_lipi_ml_ne",
      })
      .expect(200);

    expect(llm.chat).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      assistantText: "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?",
      providerId: "piper",
      voiceId: "voice_lipi_ml_ne",
    });
  });

  it("moves repeated unsupported mixed speech to callback intake instead of repeating clarification", async () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });
    const llm = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      chat: vi.fn(async () => "हजुर, म विवरण नोट गरिदिन्छु। कृपया नाम, फोन नम्बर, र policy वा claim number भन्नुहोस्।"),
    };
    const piperTts = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav" as const,
        providerId: "piper",
        voiceId: "voice_lipi_ml_ne",
      })),
    };
    const app = createAppForTest(workspace, {
      llm,
      llmModel: "gemma-4",
      tts: piperTts,
      ttsAdapters: {
        piper: piperTts,
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const started = await request(app).post("/api/calls/simulate").send({ agentId: workspace.agents[0].id }).expect(201);

    await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({ text: "पति पार्स तो इंचरेंस गरिक्प।", language: "ne", voiceId: "voice_lipi_ml_ne" })
      .expect(200);

    const response = await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({ text: "ति पार्सा, गौन रुपो।", language: "ne", voiceId: "voice_lipi_ml_ne" })
      .expect(200);

    expect(llm.chat).toHaveBeenCalledTimes(1);
    const llmCalls = llm.chat.mock.calls as unknown as Array<[{ system: string }]>;
    const llmCall = llmCalls[0]?.[0];
    expect(llmCall?.system).toContain("The caller is still unclear after one clarification");
    expect(llmCall?.system).toContain("Do not say the earlier Nepali-or-English clarification again");
    expect(llmCall?.system).not.toContain("माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु");
    expect(llm.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: "user", content: "पति पार्स तो इंचरेंस गरिक्प।" },
          { role: "user", content: "ति पार्सा, गौन रुपो।" },
        ]),
      }),
    );
    expect(response.body.assistantText).toBe(
      "हजुर, म विवरण नोट गरिदिन्छु। कृपया नाम, फोन नम्बर, र policy वा claim number भन्नुहोस्।",
    );
  });

  it("falls back to intake if the LLM still repeats the unsupported-language clarification", async () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });
    const llm = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      chat: vi.fn(async () => "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?"),
    };
    const piperTts = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav" as const,
        providerId: "piper",
        voiceId: "voice_lipi_ml_ne",
      })),
    };
    const app = createAppForTest(workspace, {
      llm,
      llmModel: "gemma-4",
      tts: piperTts,
      ttsAdapters: { piper: piperTts },
    });
    const started = await request(app).post("/api/calls/simulate").send({ agentId: workspace.agents[0].id }).expect(201);

    await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({ text: "पति पार्स तो इंचरेंस गरिक्प।", language: "ne", voiceId: "voice_lipi_ml_ne" })
      .expect(200);

    const response = await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({ text: "ति पार्सा, गौन रुपो।", language: "ne", voiceId: "voice_lipi_ml_ne" })
      .expect(200);

    expect(response.body.assistantText).toContain("कृपया आफ्नो नाम, फोन नम्बर");
    expect(response.body.assistantText).not.toContain("नेपाली वा English मा मात्रै");
  });

  it("uses the VLLM_MODEL env model for the default remote LLM asset", async () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });
    const llm = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      chat: vi.fn(async () => "नमस्ते"),
    };

    const app = createAppForTest(workspace, {
      llm,
      llmModel: "gemma-4-finetuned-indic-4b",
      llmAdapters: {
        vllm: llm,
      },
      tts: {
        health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
        synthesize: vi.fn(async () => ({
          audioBase64: Buffer.from("audio").toString("base64"),
          mimeType: "audio/wav",
        })),
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });

    const started = await request(app).post("/api/calls/simulate").send({ agentId: workspace.agents[0].id }).expect(201);
    await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({
        text: "नमस्ते",
        language: "ne",
        voiceId: "voice_lipi_ml_ne",
      })
      .expect(200);

    expect(llm.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemma-4-finetuned-indic-4b",
      }),
    );
  });

  it("treats newari as unsupported for simulation", async () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });
    const llm = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      chat: vi.fn(async () => "should not be called"),
    };
    const piperTts = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav" as const,
        providerId: "piper",
        voiceId: "voice_lipi_ml_ne",
      })),
    };

    const app = createAppForTest(workspace, {
      llm,
      llmModel: "gemma-4",
      tts: piperTts,
      ttsAdapters: {
        piper: piperTts,
      },
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const agentId = workspace.agents[0].id;
    const started = await request(app).post("/api/calls/simulate").send({ agentId }).expect(201);

    const response = await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({
        text: "jaya, namaste",
        language: "newari",
      })
      .expect(200);

    expect(llm.chat).not.toHaveBeenCalled();
    expect(response.body.assistantText).toBe(
      "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?",
    );
  });

  it("rejects cloud Gemini simulation when running fully self-hosted", async () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });
    workspace.modelRuntimes.push({
      id: "runtime_gemini",
      kind: "llm",
      adapter: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      configuredState: "not_configured",
      healthStatus: "unknown",
      defaultModelId: "model_gemini_flash",
      concurrencyLimit: 4,
      hardwareHints: ["cloud"],
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    });
    workspace.modelAssets.push({
      id: "model_gemini_flash",
      runtimeId: "runtime_gemini",
      name: "Cloud Gemini",
      kind: "llm",
      family: "gemini",
      version: "2.5-flash",
      pathOrTag: "google:gemini-2.5-flash",
      license: "cloud",
      parameterSize: "managed",
      quantization: "managed",
      languageSupport: ["ne", "en"],
      installedState: "unknown",
    });
    workspace.agents[0] = {
      ...workspace.agents[0],
      modelRuntimeId: "runtime_gemini",
      modelAssetId: "model_gemini_flash",
    };

    const vllm = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      chat: vi.fn(async () => "vllm should not be used"),
    };
    const piperTts = {
      health: vi.fn(async () => ({ status: "healthy" as const, reason: null })),
      synthesize: vi.fn(async () => ({
        audioBase64: Buffer.from("wav-data").toString("base64"),
        mimeType: "audio/wav",
      })),
    };

    const app = createAppForTest(workspace, {
      llm: vllm,
      llmModel: "gemma-4",
      llmAdapters: {
        vllm,
      },
      tts: piperTts,
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const agentId = workspace.agents[0].id;
    const started = await request(app).post("/api/calls/simulate").send({ agentId }).expect(201);

    const response = await request(app)
      .post(`/api/calls/${started.body.call.id}/simulate-turn`)
      .send({
        text: "नमस्ते",
        language: "ne",
      })
      .expect(409);

    expect(vllm.chat).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      code: "runtime_not_configured",
    });
  });

  it("creates short-lived realtime session tokens", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      now: () => new Date("2026-05-30T00:00:00.000Z"),
    });

    const response = await request(app)
      .post("/api/realtime/session")
      .send({ agentId: "agent_reception" })
      .expect(201);

    expect(response.body).toEqual({
      token: expect.any(String),
      agentId: "agent_reception",
      expiresAt: "2026-05-30T00:01:00.000Z",
    });
    expect(response.body.token.length).toBeGreaterThan(20);
  });

  it("uses workspace realtime TTL and rejects unknown realtime session agents", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const settings = await request(app).get("/api/settings").expect(200);
    await request(app)
      .post("/api/settings")
      .send({ ...settings.body, realtimeSessionTtlSeconds: 120 })
      .expect(200);

    const session = await request(app)
      .post("/api/realtime/session")
      .send({ agentId: "agent_reception" })
      .expect(201);
    const missing = await request(app)
      .post("/api/realtime/session")
      .send({ agentId: "missing_agent" })
      .expect(404);

    expect(session.body).toMatchObject({
      agentId: "agent_reception",
      expiresAt: "2026-05-31T00:02:00.000Z",
    });
    expect(missing.body).toEqual({ code: "agent_not_found" });
  });

  it("returns seeded tool definitions", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const response = await request(app).get("/api/tools").expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool_collect_callback",
          method: "POST",
          name: "Collect callback",
        }),
        expect.objectContaining({
          id: "tool_claim_intake",
          method: "POST",
          name: "Claim intake",
        }),
        expect.objectContaining({
          id: "tool_document_request",
          method: "POST",
          name: "Document request",
        }),
        expect.objectContaining({
          id: "tool_office_hours",
          method: "GET",
          name: "Office hours",
        }),
      ]),
    );
  });

  it("returns and saves phone numbers", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"));
    const seeded = await request(app).get("/api/phone-numbers").expect(200);
    const phoneNumber = {
      id: "phone_support",
      label: "Support line",
      number: "+15551201002",
      provider: "simulation",
      status: "active",
      agentId: "agent_reception",
      inboundEnabled: true,
      outboundEnabled: true,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };

    const saved = await request(app).post("/api/phone-numbers").send(phoneNumber).expect(200);
    const current = await request(app).get("/api/phone-numbers").expect(200);

    expect(seeded.body).toEqual([
      expect.objectContaining({
        id: "phone_demo_main",
        agentId: "agent_reception",
      }),
    ]);
    expect(saved.body).toMatchObject({ id: "phone_support", outboundEnabled: true });
    expect(current.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "phone_support" })]));
  });

  it("stores knowledge base documents and returns search results", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"));
    const seeded = await request(app).get("/api/knowledge-bases").expect(200);
    const knowledgeBase = {
      id: "kb_support",
      name: "Support FAQ",
      description: "Support answers.",
      status: "ready",
      documentCount: 0,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };

    const savedBase = await request(app).post("/api/knowledge-bases").send(knowledgeBase).expect(200);
    const savedDocument = await request(app)
      .post("/api/knowledge-bases/kb_support/documents")
      .send({
        id: "doc_refunds",
        title: "Refund policy",
        sourceType: "text",
        content: "Refunds are available within 30 days for unused plans.",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
      })
      .expect(200);
    const documents = await request(app).get("/api/knowledge-bases/kb_support/documents").expect(200);
    const search = await request(app)
      .post("/api/knowledge-bases/kb_support/search")
      .send({ query: "refund unused plan" })
      .expect(200);

    expect(seeded.body).toEqual([expect.objectContaining({ id: "kb_reception_faq" })]);
    expect(savedBase.body).toMatchObject({ id: "kb_support", name: "Support FAQ" });
    expect(savedDocument.body).toMatchObject({
      id: "doc_refunds",
      knowledgeBaseId: "kb_support",
      tokenCount: expect.any(Number),
    });
    expect(documents.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "doc_refunds" })]));
    expect(search.body[0]).toMatchObject({
      documentId: "doc_refunds",
      title: "Refund policy",
    });
  });

  it("saves and runs evals with pass/fail check results", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      evalResponder: async () => "Hi, this is LipiVoice. I can help with orders.",
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const definition = {
      id: "eval_reception",
      name: "Reception eval",
      description: "Checks greeting and forbidden content.",
      agentId: "agent_reception",
      cases: [
        {
          id: "case_greeting",
          input: "Say hello.",
          checks: [
            { type: "includes", value: "LipiVoice" },
            { type: "excludes", value: "refund approved" },
          ],
        },
      ],
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };

    const saved = await request(context.app).post("/api/evals").send(definition).expect(200);
    const run = await request(context.app).post("/api/evals/eval_reception/run").send({}).expect(201);
    const runs = await request(context.app).get("/api/evals/runs").expect(200);

    expect(saved.body).toMatchObject({ id: "eval_reception", cases: expect.any(Array) });
    expect(run.body).toMatchObject({
      evalId: "eval_reception",
      status: "passed",
      score: 100,
      caseResults: [
        expect.objectContaining({
          caseId: "case_greeting",
          passed: true,
          response: "Hi, this is LipiVoice. I can help with orders.",
        }),
      ],
    });
    expect(runs.body[0]).toMatchObject({ id: run.body.id, status: "passed" });
  });

  it("returns and saves workspace settings", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"));
    const current = await request(app).get("/api/settings").expect(200);

    const saved = await request(app)
      .post("/api/settings")
      .send({
        ...current.body,
        workspaceName: "Production",
        publicBaseUrl: "https://voice.example.com",
        allowedOrigins: ["https://voice.example.com"],
        allowPrivateToolUrls: true,
        recordingRetentionDays: 14,
        updatedAt: "2026-05-31T00:00:01.000Z",
      })
      .expect(200);

    expect(current.body).toMatchObject({
      id: "workspace_settings",
      workspaceName: "LipiVoice",
      allowPrivateToolUrls: false,
      redactToolSecrets: true,
    });
    expect(saved.body).toMatchObject({
      workspaceName: "Production",
      publicBaseUrl: "https://voice.example.com",
      allowPrivateToolUrls: true,
      recordingRetentionDays: 14,
    });
  });

  it("saves SIP trunk settings for later LiveKit SIP wiring", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"));
    const current = await request(app).get("/api/settings").expect(200);

    expect(current.body.sipTrunk).toMatchObject({
      enabled: false,
      mode: "asterisk",
      transport: "udp",
    });

    const saved = await request(app)
      .post("/api/settings")
      .send({
        ...current.body,
        sipTrunk: {
          enabled: true,
          provider: "ntc_easy_phone",
          mode: "asterisk",
          sipServer: "ims.ntc.net.np",
          outboundProxy: "202.70.74.178:5060",
          domain: "ims.ntc.net.np",
          username: "+97760400011",
          authUsername: "+97760400011@ims.ntc.net.np",
          fromNumber: "+97760400011",
          transport: "udp",
        },
        updatedAt: "2026-05-31T00:00:01.000Z",
      })
      .expect(200);

    expect(saved.body.sipTrunk).toEqual({
      enabled: true,
      provider: "ntc_easy_phone",
      mode: "asterisk",
      sipServer: "ims.ntc.net.np",
      outboundProxy: "202.70.74.178:5060",
      domain: "ims.ntc.net.np",
      username: "+97760400011",
      authUsername: "+97760400011@ims.ntc.net.np",
      fromNumber: "+97760400011",
      transport: "udp",
    });
  });

  it("stores the SIP trunk password as a write-only secret", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      now: () => new Date("2026-05-31T00:00:02.000Z"),
    });

    const initial = await request(app).get("/api/settings/sip-secret").expect(200);

    expect(initial.body).toEqual({
      configured: false,
      updatedAt: null,
    });

    const saved = await request(app)
      .post("/api/settings/sip-secret")
      .send({ password: "236790_Ntc1" })
      .expect(200);

    expect(saved.body).toEqual({
      configured: true,
      updatedAt: "2026-05-31T00:00:02.000Z",
    });
    expect(saved.body).not.toHaveProperty("password");

    const current = await request(app).get("/api/settings/sip-secret").expect(200);
    expect(current.body).toEqual({
      configured: true,
      updatedAt: "2026-05-31T00:00:02.000Z",
    });
    expect(current.body).not.toHaveProperty("password");

    const cleared = await request(app).delete("/api/settings/sip-secret").expect(200);
    expect(cleared.body).toEqual({
      configured: false,
      updatedAt: null,
    });
  });

  it("returns lightweight health without probing model runtimes", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      now: () => new Date("2026-05-31T00:00:01.000Z"),
    });

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      timestamp: "2026-05-31T00:00:01.000Z",
      storage: "ok",
      settingsLoaded: true,
    });
  });

  it("uses workspace settings for private tool URL policy", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      toolFetch: fetchImpl,
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const tool = {
      id: "tool_local_probe",
      name: "Local probe",
      description: "Calls a trusted local service.",
      method: "GET",
      url: "http://127.0.0.1:5001/internal/{id}",
      authMode: "none",
      headers: [],
      parameters: [{ name: "id", type: "string", required: true }],
      timeoutMs: 5000,
      retryCount: 0,
      responseSchema: "{}",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };
    await request(context.app).post("/api/tools").send(tool).expect(200);

    const blocked = await request(context.app)
      .post("/api/tools/execute")
      .send({ toolId: "tool_local_probe", arguments: { id: "health" } })
      .expect(200);
    const settings = await request(context.app).get("/api/settings").expect(200);
    await request(context.app)
      .post("/api/settings")
      .send({ ...settings.body, allowPrivateToolUrls: true })
      .expect(200);
    const allowed = await request(context.app)
      .post("/api/tools/execute")
      .send({ toolId: "tool_local_probe", arguments: { id: "health" } })
      .expect(200);

    expect(blocked.body).toMatchObject({ ok: false, error: "unsafe_tool_url", attempts: 0 });
    expect(allowed.body).toMatchObject({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("saves valid tool definitions and rejects invalid tools", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));
    const validTool = {
      id: "tool_schedule_demo",
      name: "Schedule demo",
      description: "Book a demo call from the assistant.",
      method: "POST",
      url: "https://example.com/demo",
      authMode: "bearer",
      headers: [{ name: "authorization", value: "secret", secret: true }],
      parameters: [{ name: "email", type: "string", required: true }],
      timeoutMs: 8000,
      retryCount: 1,
      responseSchema: "{\"ok\": true}",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    };

    const saved = await request(app).post("/api/tools").send(validTool).expect(200);
    const invalid = await request(app)
      .post("/api/tools")
      .send({ ...validTool, id: "", url: "not-a-url" })
      .expect(400);
    const tools = await request(app).get("/api/tools").expect(200);

    expect(saved.body).toMatchObject({ id: "tool_schedule_demo", name: "Schedule demo" });
    expect(invalid.body).toEqual({ code: "invalid_tool" });
    expect(tools.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tool_schedule_demo" })]));
  });

  it("executes a tool and stores a redacted execution log", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "shipped" }, { status: 200 }));
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      toolFetch: fetchImpl,
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    const tool = {
      id: "tool_secure_lookup",
      name: "Secure lookup",
      description: "Look up secure order state.",
      method: "GET",
      url: "https://example.com/orders/{orderId}",
      authMode: "header",
      headers: [{ name: "authorization", value: "Bearer secret", secret: true }],
      parameters: [{ name: "orderId", type: "string", required: true }],
      timeoutMs: 5000,
      retryCount: 0,
      responseSchema: "{}",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };
    await request(context.app).post("/api/tools").send(tool).expect(200);

    const executed = await request(context.app)
      .post("/api/tools/execute")
      .send({ toolId: "tool_secure_lookup", arguments: { orderId: "A123" } })
      .expect(200);
    const logs = await request(context.app).get("/api/tools/executions").expect(200);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/orders/A123",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer secret" },
      }),
    );
    expect(executed.body).toMatchObject({
      toolId: "tool_secure_lookup",
      ok: true,
      status: 200,
      request: {
        headers: [{ name: "authorization", value: "[redacted]" }],
      },
      response: { body: "{\"status\":\"shipped\"}" },
    });
    expect(logs.body[0]).toMatchObject({
      id: expect.any(String),
      toolId: "tool_secure_lookup",
      timestamp: "2026-05-31T00:00:00.000Z",
      request: {
        headers: [{ name: "authorization", value: "[redacted]" }],
      },
    });
  });

  it("returns tool_not_found for missing tool execution requests", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const response = await request(app)
      .post("/api/tools/execute")
      .send({ toolId: "missing_tool", arguments: {} })
      .expect(404);

    expect(response.body).toEqual({ code: "tool_not_found" });
  });

  it("exposes a context close hook", () => {
    const context = createAppContextForTest(
      createDefaultWorkspace("2026-05-29T00:00:00.000Z"),
    );

    expect(() => context.close()).not.toThrow();
  });

  it("returns invalid_json for malformed JSON", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const response = await request(app)
      .post("/api/agents")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);

    expect(response.body).toEqual({ code: "invalid_json" });
  });

  it("returns internal_error for unexpected errors", async () => {
    const context = createAppContextForTest(
      createDefaultWorkspace("2026-05-29T00:00:00.000Z"),
    );
    context.close();

    const response = await request(context.app).get("/api/agents").expect(500);

    expect(response.body).toEqual({ code: "internal_error" });
  });

  it("returns invalid_agent for invalid agent payloads", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const response = await request(app).post("/api/agents").send({ id: "" }).expect(400);

    expect(response.body).toEqual({ code: "invalid_agent" });
  });

  it("lists model assets for runtime selection", async () => {
    const app = createAppForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }));

    const response = await request(app).get("/api/model-assets").expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "model_vllm_remote", kind: "llm", name: "LipiCore Realtime" }),
        expect.objectContaining({ id: "model_lipi_ml_whisper_large_v3", kind: "stt" }),
        expect.objectContaining({ id: "model_coqui_xtts_ne", kind: "tts" }),
      ]),
    );
  });

  it("returns agent_not_found for missing or unknown simulated call agents", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    await expectAgentNotFound(request(app).post("/api/calls/simulate").send({}));
    await expectAgentNotFound(
      request(app).post("/api/calls/simulate").send({ agentId: "missing_agent" }),
    );
  });

  it("returns the initial event after simulating a call", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));
    const agentId = (await request(app).get("/api/agents")).body[0].id;
    const simulation = await request(app)
      .post("/api/calls/simulate")
      .send({ agentId })
      .expect(201);

    const events = await request(app).get(`/api/calls/${simulation.body.call.id}/events`).expect(200);

    expect(events.body).toHaveLength(1);
    expect(events.body[0].payload).toEqual({ status: "connected" });
  });

  it("creates and ends a phone call from a routed number", async () => {
    const timestamps = [
      new Date("2026-05-31T00:00:00.000Z"),
      new Date("2026-05-31T00:00:45.000Z"),
    ];
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      now: () => timestamps.shift() ?? new Date("2026-05-31T00:00:45.000Z"),
    });

    const started = await request(context.app)
      .post("/api/calls/phone/start")
      .send({ phoneNumberId: "phone_demo_main", direction: "inbound" })
      .expect(201);
    const ended = await request(context.app).post(`/api/calls/${started.body.call.id}/end`).send({}).expect(200);
    const events = await request(context.app).get(`/api/calls/${started.body.call.id}/events`).expect(200);

    expect(started.body.call).toMatchObject({
      channel: "phone",
      direction: "inbound",
      agentId: "agent_reception",
      phoneNumberId: "phone_demo_main",
      status: "connected",
    });
    expect(started.body.events[0].payload).toMatchObject({
      status: "connected",
      phoneNumber: "+15551201001",
    });
    expect(ended.body.call).toMatchObject({
      status: "disconnected",
      endedAt: "2026-05-31T00:00:45.000Z",
      durationSeconds: 45,
    });
    expect(events.body.map((event: { payload: { status?: string } }) => event.payload.status)).toEqual([
      "connected",
      "disconnected",
    ]);
  });

  it("imports renewal customer data and launches outbound renewal calls with policy context", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-06-24T00:00:00.000Z"), {
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });
    const agentId = context.repositories.agents.list()[0].id;

    const imported = await request(context.app)
      .post("/api/renewals/import")
      .send({
        records: [
          {
            customerName: "Ram Shrestha",
            phoneNumber: "+977 9841234567",
            preferredLanguage: "ne-NP",
            policyNumber: "SALICO-MOTOR-12345",
            policyType: "motor",
            premium: 18000,
            sumInsured: 1200000,
            startDate: "2025-07-15",
            endDate: "2026-07-15",
            renewalDueDate: "2026-07-15",
            cmsId: "cms-pol-12345",
          },
        ],
      })
      .expect(201);

    expect(imported.body).toMatchObject({ imported: 1, customers: 1, policies: 1 });
    expect(imported.body.records[0].customer).toMatchObject({
      name: "Ram Shrestha",
      phoneNumber: "9779841234567",
      source: "import",
    });
    expect(imported.body.records[0].policy).toMatchObject({
      policyNumber: "SALICO-MOTOR-12345",
      type: "motor",
      premium: 18000,
      renewalDueDate: "2026-07-15",
      cmsId: "cms-pol-12345",
    });

    const campaign = await request(context.app)
      .post("/api/campaigns/build-renewal")
      .send({ agentId, withinDays: 45 })
      .expect(201);
    expect(campaign.body).toMatchObject({
      type: "renewal_reminder",
      totalContacts: 1,
    });
    expect(campaign.body.contacts[0]).toMatchObject({
      name: "Ram Shrestha",
      phoneNumber: "9779841234567",
      contextData: expect.objectContaining({
        policyNumber: "SALICO-MOTOR-12345",
        renewalDate: "2026-07-15",
        premium: "NPR 18,000",
      }),
    });

    await request(context.app).post(`/api/campaigns/${campaign.body.id}/launch`).send({}).expect(200);
    const runs = await request(context.app).get(`/api/campaigns/${campaign.body.id}/runs`).expect(200);
    expect(runs.body[0]).toMatchObject({ status: "connected", callId: expect.any(String) });

    const callId = runs.body[0].callId;
    const call = context.repositories.calls.get(callId);
    expect(call).toMatchObject({
      channel: "phone",
      direction: "outbound",
      agentId,
      status: "connected",
    });
    const events = await request(context.app).get(`/api/calls/${callId}/events`).expect(200);
    expect(events.body[0]).toMatchObject({
      type: "status",
      actor: "system",
      payload: expect.objectContaining({
        status: "outbound_context_ready",
        to: "9779841234567",
        customerName: "Ram Shrestha",
        policyNumber: "SALICO-MOTOR-12345",
        suggestedOpening: expect.stringContaining("renewal"),
        contextPromptSuffix: expect.stringContaining("Policy number: SALICO-MOTOR-12345"),
      }),
    });
  });

  it("dials renewal campaign contacts through LiveKit SIP when SIP settings are enabled", async () => {
    const startOutboundSipCall = vi.fn(async () => ({
      roomName: "lipivoice-call-call_1",
      dispatchId: "dispatch_1",
      trunkId: "trunk_1",
      participantId: "sip_participant_1",
      participantIdentity: "sip_call_1",
    }));
    const context = createAppContextForTest(createDefaultWorkspace("2026-06-24T00:00:00.000Z"), {
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      liveKit: {
        startWebCall: vi.fn(),
        startOutboundSipCall,
      },
    });
    const settings = context.repositories.settings.get();
    context.repositories.settings.save({
      ...settings,
      sipTrunk: {
        enabled: true,
        provider: "ntc_easy_phone",
        mode: "asterisk",
        sipServer: "ims.ntc.net.np",
        outboundProxy: "202.70.74.178:5060",
        domain: "ims.ntc.net.np",
        username: "+97760400011",
        authUsername: "+97760400011@ims.ntc.net.np",
        fromNumber: "+97760400011",
        transport: "udp",
      },
    });
    context.repositories.secrets.save({
      id: "sip_trunk_password",
      value: "236790_Ntc1",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    const agentId = context.repositories.agents.list()[0].id;

    await request(context.app)
      .post("/api/renewals/import")
      .send({
        records: [
          {
            customerName: "Ram Shrestha",
            phoneNumber: "+977 9841234567",
            policyNumber: "SALICO-MOTOR-12345",
            policyType: "motor",
            premium: 18000,
            endDate: "2026-07-15",
            renewalDueDate: "2026-07-15",
          },
        ],
      })
      .expect(201);

    const campaign = await request(context.app)
      .post("/api/campaigns/build-renewal")
      .send({ agentId, withinDays: 45 })
      .expect(201);
    await request(context.app).post(`/api/campaigns/${campaign.body.id}/launch`).send({}).expect(200);
    const runs = await request(context.app).get(`/api/campaigns/${campaign.body.id}/runs`).expect(200);
    const events = await request(context.app).get(`/api/calls/${runs.body[0].callId}/events`).expect(200);

    expect(startOutboundSipCall).toHaveBeenCalledWith(expect.objectContaining({
      agentId,
      toNumber: "9779841234567",
      fromNumber: "+97760400011",
      contactName: "Ram Shrestha",
      campaignId: campaign.body.id,
      contextPromptSuffix: expect.stringContaining("Policy number: SALICO-MOTOR-12345"),
    }));
    expect(events.body[0].payload).toMatchObject({
      status: "outbound_sip_dialing",
      dialer: "livekit_sip",
      sip: {
        roomName: "lipivoice-call-call_1",
        trunkId: "trunk_1",
        participantId: "sip_participant_1",
      },
    });
  });

  it("automatically launches scheduled renewal campaigns when they become due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T00:00:00.000Z"));
    const initiateOutboundCall = vi.fn(async () => ({ callId: "call_auto_1" }));
    const context = createAppContextForTest(createDefaultWorkspace("2026-06-24T00:00:00.000Z"), {
      now: () => new Date("2026-06-24T00:00:00.000Z"),
      initiateOutboundCall,
      campaignSchedulerIntervalMs: 10,
    });
    const agentId = context.repositories.agents.list()[0].id;

    try {
      await request(context.app)
        .post("/api/renewals/import")
        .send({
          records: [
            {
              customerName: "Ram Shrestha",
              phoneNumber: "+977 9841234567",
              policyNumber: "SALICO-MOTOR-12345",
              policyType: "motor",
              premium: 18000,
              endDate: "2026-07-15",
              renewalDueDate: "2026-07-15",
            },
          ],
        })
        .expect(201);

      const campaign = await request(context.app)
        .post("/api/campaigns/build-renewal")
        .send({ agentId, withinDays: 45, scheduledAt: "2026-06-24T00:00:00.000Z" })
        .expect(201);
      expect(campaign.body).toMatchObject({ status: "scheduled", totalContacts: 1 });

      await vi.advanceTimersByTimeAsync(10);

      expect(initiateOutboundCall).toHaveBeenCalledWith(expect.objectContaining({
        agentId,
        campaignId: campaign.body.id,
        campaignRunId: expect.any(String),
        contextPromptSuffix: expect.stringContaining("Policy number: SALICO-MOTOR-12345"),
      }));
      const runs = await request(context.app).get(`/api/campaigns/${campaign.body.id}/runs`).expect(200);
      expect(runs.body[0]).toMatchObject({ status: "connected", callId: "call_auto_1" });
    } finally {
      context.close();
      vi.useRealTimers();
    }
  });

  it("returns phone_number_unassigned when a number has no routed agent", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"));

    await request(app)
      .post("/api/phone-numbers")
      .send({
        id: "phone_unassigned",
        label: "Unassigned",
        number: "+15551201003",
        provider: "simulation",
        status: "active",
        agentId: null,
        inboundEnabled: true,
        outboundEnabled: false,
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
      })
      .expect(200);

    const response = await request(app)
      .post("/api/calls/phone/start")
      .send({ phoneNumberId: "phone_unassigned" })
      .expect(409);

    expect(response.body).toEqual({ code: "phone_number_unassigned" });
  });

  it("includes realtime and managed voice runtime diagnostics", async () => {
    const { app } = createAppContextForTest(createRemoteWorkspace({
      now: "2026-06-02T00:00:00.000Z",
      vllmEndpoint: "http://vllm.test/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://lipi.test",
    }), {
      runtimeHealth: {
        vllm: async () => ({ status: "healthy", reason: null, latencyMs: 44 }),
        faster_whisper: async () => ({ status: "healthy", reason: null, latencyMs: 91 }),
        piper_http: async () => ({ status: "healthy", reason: null, latencyMs: 80 }),
        coqui_http: async () => ({ status: "healthy", reason: null, latencyMs: 210 }),
      },
      liveKitConfigured: true,
    });

    const response = await request(app).get("/api/runtime-diagnostics").expect(200);

    expect(response.body).toMatchObject({
      liveKit: { status: "healthy" },
      runtimes: expect.arrayContaining([
        expect.objectContaining({ adapter: "vllm", healthStatus: "healthy" }),
        expect.objectContaining({ adapter: "piper_http", healthStatus: "healthy" }),
      ]),
    });
  });

  it("returns call_not_found for missing call events", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const response = await request(app).get("/api/calls/missing_call/events").expect(404);

    expect(response.body).toEqual({ code: "call_not_found" });
  });

  it("returns runtime_not_configured when local TTS is not configured", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const response = await request(app)
      .post("/api/tts/generate")
      .send({ text: "Hello", voiceId: "voice_piper_amy" })
      .expect(409);

    expect(response.body).toEqual({ code: "runtime_not_configured" });
  });

  it("generates speech with an injected TTS adapter", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      tts: {
        health: async () => ({ status: "healthy", reason: null }),
        synthesize: async (input) => ({
          audioBase64: Buffer.from(input.text).toString("base64"),
          mimeType: "audio/wav",
        }),
      },
    });

    const response = await request(context.app)
      .post("/api/tts/generate")
      .send({ text: "Hello", voiceId: "voice_piper_amy" })
      .expect(200);

    expect(response.body).toMatchObject({
      voiceId: "voice_piper_amy",
      voiceName: "Asha",
      text: "Hello",
      audioBase64: "SGVsbG8=",
      mimeType: "audio/wav",
      createdAt: expect.any(String),
    });
  });

  it("generates speech with an injected managed TTS adapter", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      ttsAdapters: {
        piper_http: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async (input) => ({
            audioBase64: Buffer.from(input.text).toString("base64"),
            mimeType: "audio/wav" as const,
            providerId: "piper_http",
            voiceId: "voice_piper_ne",
          }),
        },
      },
    });

    const response = await request(context.app)
      .post("/api/tts/generate")
      .send({ text: "नमस्ते", voiceId: "voice_piper_ne" })
      .expect(200);

    expect(response.body).toMatchObject({
      voiceId: "voice_piper_ne",
      text: "नमस्ते",
      audioBase64: Buffer.from("नमस्ते").toString("base64"),
      mimeType: "audio/wav",
      createdAt: expect.any(String),
    });
  });

  it("returns a structured TTS generation error when synthesis fails", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      ttsAdapters: {
        piper_http: {
          health: async () => ({ status: "healthy", reason: null }),
          synthesize: async () => {
            throw new Error("connection refused");
          },
        },
      },
    });

    const response = await request(context.app)
      .post("/api/tts/generate")
      .send({ text: "नमस्ते", voiceId: "voice_piper_ne" })
      .expect(502);

    expect(response.body).toEqual({ code: "tts_synthesis_failed" });
  });

  it("stores generated voice samples", async () => {
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      now: () => new Date("2026-05-31T00:00:00.000Z"),
      tts: {
        health: async () => ({ status: "healthy", reason: null }),
        synthesize: async () => ({
          audioBase64: "UklGRg==",
          mimeType: "audio/wav",
        }),
      },
    });

    const generated = await request(context.app)
      .post("/api/tts/generate")
      .send({ text: "Hello history", voiceId: "voice_piper_amy" })
      .expect(200);
    const samples = await request(context.app).get("/api/voice-samples").expect(200);

    expect(generated.body).toMatchObject({
      id: expect.any(String),
      voiceId: "voice_piper_amy",
      voiceName: "Asha",
      text: "Hello history",
      audioBase64: "UklGRg==",
      mimeType: "audio/wav",
      createdAt: "2026-05-31T00:00:00.000Z",
    });
    expect(samples.body[0]).toMatchObject({ id: generated.body.id, text: "Hello history" });
  });

  it("creates consent-gated private voice clone requests", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-31T00:00:00.000Z"), {
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });

    const missingConsent = await request(app)
      .post("/api/voice-clones")
      .send({ voiceName: "Private Voice", language: "en-US" })
      .expect(400);
    const created = await request(app)
      .post("/api/voice-clones")
      .send({
        voiceName: "Private Voice",
        language: "en-US",
        speakerName: "Asha",
        consentSource: "Recorded written approval on file.",
        auditNotes: "Demo clone request.",
      })
      .expect(201);
    const voices = await request(app).get("/api/voices").expect(200);

    expect(missingConsent.body).toEqual({ code: "voice_consent_missing" });
    expect(created.body).toMatchObject({
      voice: {
        id: expect.stringMatching(/^voice_clone_/),
        name: "Private Voice",
        type: "cloned",
        privacy: "private",
        cloneStatus: "pending",
        consentId: expect.stringMatching(/^consent_/),
      },
      consent: {
        speakerName: "Asha",
        consentSource: "Recorded written approval on file.",
        auditNotes: "Demo clone request.",
        capturedAt: "2026-05-31T00:00:00.000Z",
      },
    });
    expect(voices.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.voice.id })]));
  });

  it("rejects unknown TTS voices before synthesizing", async () => {
    const synthesize = vi.fn(async () => ({ audioBase64: "UklGRg==", mimeType: "audio/wav" as const }));
    const context = createAppContextForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      tts: {
        health: async () => ({ status: "healthy", reason: null }),
        synthesize,
      },
    });

    const response = await request(context.app)
      .post("/api/tts/generate")
      .send({ text: "Hello", voiceId: "missing_voice" })
      .expect(404);

    expect(response.body).toEqual({ code: "voice_not_found" });
    expect(synthesize).not.toHaveBeenCalled();
  });
});

describe("server config", () => {
  it("falls back to the default port for invalid port values", () => {
    expect(loadServerConfig({ PORT: "nope" }).port).toBe(8787);
    expect(loadServerConfig({ PORT: "0" }).port).toBe(8787);
    expect(loadServerConfig({ PORT: "-1" }).port).toBe(8787);
  });
});

async function expectAgentNotFound(requestPromise: request.Test) {
  const response = await requestPromise.expect(404);

  expect(response.body).toEqual({ code: "agent_not_found" });
}
