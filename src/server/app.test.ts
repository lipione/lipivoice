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
