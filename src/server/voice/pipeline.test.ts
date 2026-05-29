import { describe, expect, it } from "vitest";
import { runVoiceTurn } from "./pipeline";

describe("voice pipeline", () => {
  it("transcribes, asks the LLM, synthesizes, and returns normalized events", async () => {
    const result = await runVoiceTurn({
      agent: {
        greeting: "Hi",
        systemPrompt: "Be concise.",
        language: "en",
        modelAssetId: "model_llama32_3b",
        voiceId: "voice_piper_amy",
      },
      model: "llama3.2:3b",
      audioWavPath: "/tmp/input.wav",
      stt: {
        transcribe: async () => ({ text: "What are your hours?", confidence: 0.92 }),
      },
      llm: {
        chat: async () => "We are open from 9 AM to 5 PM.",
      },
      tts: {
        synthesize: async () => ({ audioBase64: "UklGRg==", mimeType: "audio/wav" }),
      },
      history: [],
    });

    expect(result.userText).toBe("What are your hours?");
    expect(result.assistantText).toContain("9 AM");
    expect(result.events.map((event) => event.type)).toEqual(["transcript", "transcript", "audio"]);
  });

  it("passes exact runtime arguments to each adapter", async () => {
    const sttCalls: Array<{ wavPath: string; language: string }> = [];
    const llmCalls: Array<{
      model: string;
      system: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }> = [];
    const ttsCalls: Array<{ text: string; voicePath: string }> = [];

    await runVoiceTurn({
      agent: {
        greeting: "Hi",
        systemPrompt: "Be concise.",
        language: "en",
        modelAssetId: "model_llama32_3b",
        voiceId: "voice_piper_amy",
      },
      model: "llama3.2:3b",
      audioWavPath: "/tmp/input.wav",
      stt: {
        transcribe: async (args) => {
          sttCalls.push(args);
          return { text: "What are your hours?", confidence: 0.92 };
        },
      },
      llm: {
        chat: async (args) => {
          llmCalls.push(args);
          return "We are open from 9 AM to 5 PM.";
        },
      },
      tts: {
        synthesize: async (args) => {
          ttsCalls.push(args);
          return { audioBase64: "UklGRg==", mimeType: "audio/wav" };
        },
      },
      history: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi. How can I help?" },
      ],
    });

    expect(sttCalls).toEqual([{ wavPath: "/tmp/input.wav", language: "en" }]);
    expect(llmCalls).toEqual([
      {
        model: "llama3.2:3b",
        system: "Be concise.",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi. How can I help?" },
          { role: "user", content: "What are your hours?" },
        ],
      },
    ]);
    expect(ttsCalls).toEqual([{ text: "We are open from 9 AM to 5 PM.", voicePath: "voice_piper_amy" }]);
  });

  it("throws a clear error when transcription is blank", async () => {
    let llmCalls = 0;
    let ttsCalls = 0;

    await expect(
      runVoiceTurn({
        agent: {
          greeting: "Hi",
          systemPrompt: "Be concise.",
          language: "en",
          modelAssetId: "model_llama32_3b",
          voiceId: "voice_piper_amy",
        },
        model: "llama3.2:3b",
        audioWavPath: "/tmp/input.wav",
        stt: {
          transcribe: async () => ({ text: " \n ", confidence: null }),
        },
        llm: {
          chat: async () => {
            llmCalls += 1;
            return "I should not be called.";
          },
        },
        tts: {
          synthesize: async () => {
            ttsCalls += 1;
            return { audioBase64: "UklGRg==", mimeType: "audio/wav" };
          },
        },
        history: [],
      }),
    ).rejects.toThrow("Transcription did not include any speech");

    expect(llmCalls).toBe(0);
    expect(ttsCalls).toBe(0);
  });

  it("executes an assigned tool request before asking for the final answer", async () => {
    const llmCalls: Array<{
      system: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }> = [];
    const toolCalls: Array<{ toolId: string; arguments: Record<string, unknown> }> = [];

    const result = await runVoiceTurn({
      agent: {
        greeting: "Hi",
        systemPrompt: "Be concise.",
        language: "en",
        modelAssetId: "model_llama32_3b",
        voiceId: "voice_piper_amy",
        toolIds: ["tool_order_lookup"],
      },
      model: "llama3.2:3b",
      audioWavPath: "/tmp/input.wav",
      stt: {
        transcribe: async () => ({ text: "Where is order A123?", confidence: 0.88 }),
      },
      llm: {
        chat: async (args) => {
          llmCalls.push({ system: args.system, messages: args.messages });
          return llmCalls.length === 1
            ? 'TOOL_CALL {"toolId":"tool_order_lookup","arguments":{"orderId":"A123"}}'
            : "Order A123 is in transit and arrives Friday.";
        },
      },
      tts: {
        synthesize: async (args) => ({ audioBase64: Buffer.from(args.text).toString("base64"), mimeType: "audio/wav" }),
      },
      history: [],
      tools: [
        {
          id: "tool_order_lookup",
          name: "Order lookup",
          description: "Find order status.",
          method: "GET",
          url: "https://example.com/orders/{orderId}",
          authMode: "none",
          headers: [],
          parameters: [{ name: "orderId", type: "string", required: true }],
          timeoutMs: 5000,
          retryCount: 0,
          responseSchema: "{}",
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z",
        },
      ],
      toolExecutor: async (tool, args) => {
        toolCalls.push({ toolId: tool.id, arguments: args });
        return {
          toolId: tool.id,
          toolName: tool.name,
          ok: true,
          status: 200,
          durationMs: 12,
          request: {
            method: "GET",
            url: "https://example.com/orders/A123",
            headers: [],
          },
          response: { body: "{\"status\":\"in_transit\",\"eta\":\"Friday\"}" },
        };
      },
    });

    expect(toolCalls).toEqual([{ toolId: "tool_order_lookup", arguments: { orderId: "A123" } }]);
    expect(llmCalls).toHaveLength(2);
    expect(llmCalls[0].system).toContain("Order lookup");
    expect(llmCalls[1].messages.at(-1)?.content).toContain("in_transit");
    expect(result.assistantText).toBe("Order A123 is in transit and arrives Friday.");
    expect(result.events.map((event) => event.type)).toEqual([
      "transcript",
      "tool_call",
      "transcript",
      "audio",
    ]);
    expect(result.events[1]).toEqual({
      type: "tool_call",
      actor: "tool",
      payload: expect.objectContaining({
        toolId: "tool_order_lookup",
        arguments: { orderId: "A123" },
        ok: true,
        status: 200,
      }),
    });
  });
});
