import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace } from "@/domain/defaults";
import { createAppContextForTest, createAppForTest } from "./app";
import { loadServerConfig } from "./config";

describe("server app", () => {
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

  it("creates short-lived realtime session tokens", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"), {
      now: () => new Date("2026-05-30T00:00:00.000Z"),
    });

    const response = await request(app).post("/api/realtime/session").send({}).expect(201);

    expect(response.body).toEqual({
      token: expect.any(String),
      expiresAt: "2026-05-30T00:01:00.000Z",
    });
    expect(response.body.token.length).toBeGreaterThan(20);
  });

  it("returns seeded tool definitions", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const response = await request(app).get("/api/tools").expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: "tool_order_lookup",
        method: "GET",
        name: "Order lookup",
      }),
    ]);
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

    expect(response.body).toEqual({ audioBase64: "SGVsbG8=", mimeType: "audio/wav" });
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
