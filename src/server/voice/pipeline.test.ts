import { describe, expect, it } from "vitest";
import { runVoiceTurn } from "./pipeline";

describe("voice pipeline", () => {
  it("transcribes, asks the LLM, synthesizes, and returns normalized events", async () => {
    const result = await runVoiceTurn({
      agent: {
        greeting: "Hi",
        systemPrompt: "Be concise.",
        language: "en",
        modelAssetId: "llama3.2:3b",
        voiceId: "voice_piper_amy",
      },
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

  it("throws a clear error when transcription is blank", async () => {
    let llmCalls = 0;
    let ttsCalls = 0;

    await expect(
      runVoiceTurn({
        agent: {
          greeting: "Hi",
          systemPrompt: "Be concise.",
          language: "en",
          modelAssetId: "llama3.2:3b",
          voiceId: "voice_piper_amy",
        },
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
});
