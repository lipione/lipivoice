import { describe, expect, it } from "vitest";
import { agentSchema, modelRuntimeSchema, toolExecutionLogSchema, toolSchema } from "./schemas";

describe("domain schemas", () => {
  it("accepts a complete local-model agent", () => {
    const parsed = agentSchema.parse({
      id: "agent_reception",
      name: "Reception Agent",
      greeting: "Hi, this is LipiVoice. How can I help?",
      systemPrompt: "Answer concisely and collect the caller's name.",
      language: "en",
      modelRuntimeId: "runtime_ollama",
      modelAssetId: "model_llama32_3b",
      voiceId: "voice_piper_amy",
      transcriberRuntimeId: "runtime_whisper",
      recordingEnabled: true,
      interruptionSensitivity: "medium",
      toolIds: ["tool_lookup_customer"],
      knowledgeBaseIds: [],
      deploymentState: "draft",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(parsed.modelRuntimeId).toBe("runtime_ollama");
  });

  it("rejects a tool without a valid URL", () => {
    expect(() =>
      toolSchema.parse({
        id: "tool_bad",
        name: "Bad Tool",
        description: "Invalid URL example",
        method: "POST",
        url: "localhost/customers",
        authMode: "none",
        headers: [],
        parameters: [],
        timeoutMs: 8000,
        retryCount: 0,
        responseSchema: "{}",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z",
      }),
    ).toThrow(/Invalid URL/);
  });

  it("accepts an Ollama model runtime", () => {
    const runtime = modelRuntimeSchema.parse({
      id: "runtime_ollama",
      kind: "llm",
      adapter: "ollama",
      endpoint: "http://127.0.0.1:11434",
      configuredState: "configured",
      healthStatus: "unknown",
      defaultModelId: "model_llama32_3b",
      concurrencyLimit: 1,
      hardwareHints: ["metal"],
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(runtime.adapter).toBe("ollama");
  });

  it("accepts a redacted tool execution log", () => {
    const log = toolExecutionLogSchema.parse({
      id: "tool_exec_123",
      toolId: "tool_order_lookup",
      toolName: "Order lookup",
      timestamp: "2026-05-31T00:00:00.000Z",
      ok: true,
      status: 200,
      attempts: 1,
      durationMs: 42,
      error: null,
      request: {
        method: "GET",
        url: "https://example.com/orders/A123",
        headers: [{ name: "authorization", value: "[redacted]" }],
      },
      response: {
        body: "{\"status\":\"shipped\"}",
      },
    });

    expect(log.toolId).toBe("tool_order_lookup");
  });
});
