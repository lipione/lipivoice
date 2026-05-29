import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { detectSpeechTurn } from "./energyVad";
import { mapRuntimeHealth } from "./health";
import { OllamaAdapter } from "./ollama";
import { PiperAdapter } from "./piper";
import { WhisperCppAdapter } from "./whisperCpp";

describe("runtime adapters", () => {
  it("detects speech when frame energy crosses threshold", () => {
    const quiet = new Float32Array([0.001, -0.001, 0.002]);
    const speech = new Float32Array([0.2, -0.18, 0.16]);

    expect(detectSpeechTurn([quiet, speech], { threshold: 0.05 })).toEqual({
      hasSpeech: true,
      peak: 0.2,
    });
  });

  it("detects speech in large frames without spreading samples into Math.max", () => {
    const frame = new Float32Array(200_000);
    frame[199_999] = -0.7;

    expect(() => detectSpeechTurn([frame], { threshold: 0.5 })).not.toThrow();
    expect(detectSpeechTurn([frame], { threshold: 0.5 })).toEqual({
      hasSpeech: true,
      peak: 0.7,
    });
  });

  it("maps missing local binaries to runtime_not_configured", () => {
    expect(mapRuntimeHealth({ configured: false, reachable: false, modelPresent: false })).toEqual({
      status: "missing_model",
      reason: "runtime_not_configured",
    });
  });

  it("reports healthy Ollama health when tags include configured model", async () => {
    const adapter = new OllamaAdapter({
      baseUrl: "http://ollama.test",
      model: "llama3.2:3b",
      fetchImpl: async () => Response.json({ models: [{ name: "llama3.2:3b" }] }),
    });

    await expect(adapter.health()).resolves.toMatchObject({
      status: "healthy",
      reason: null,
    });
  });

  it("reports missing_model Ollama health when tags omit configured model", async () => {
    const adapter = new OllamaAdapter({
      baseUrl: "http://ollama.test",
      model: "llama3.2:3b",
      fetchImpl: async () => Response.json({ models: [{ name: "mistral:7b" }] }),
    });

    await expect(adapter.health()).resolves.toMatchObject({
      status: "missing_model",
      reason: "model_not_installed",
    });
  });

  it("reports structured Ollama health when tags request fails", async () => {
    const adapter = new OllamaAdapter({
      baseUrl: "http://ollama.test",
      model: "llama3.2:3b",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    await expect(adapter.health()).resolves.toEqual({
      status: "unavailable",
      reason: "runtime_unavailable",
    });
  });

  it("sends Ollama chat system message before user messages", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const adapter = new OllamaAdapter({
      baseUrl: "http://ollama.test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ message: { content: "hello" } });
      },
    });

    await expect(
      adapter.chat({
        model: "llama3.2:3b",
        system: "You are concise.",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).resolves.toBe("hello");

    expect(requests[0]?.url).toBe("http://ollama.test/api/chat");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      model: "llama3.2:3b",
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Hi" },
      ],
      stream: false,
    });
  });

  it("throws a clear error for malformed Ollama chat responses", async () => {
    const adapter = new OllamaAdapter({
      baseUrl: "http://ollama.test",
      fetchImpl: async () => Response.json({ done: true }),
    });

    await expect(
      adapter.chat({
        model: "llama3.2:3b",
        system: "You are concise.",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow("Ollama chat response did not include message content");
  });

  it("reports whisper runtime_not_configured when paths are missing", async () => {
    const adapter = new WhisperCppAdapter({ binPath: "", modelPath: "" });

    await expect(adapter.health()).resolves.toEqual({
      status: "missing_model",
      reason: "runtime_not_configured",
    });
  });

  it("runs whisper transcription with the planned runner arguments", async () => {
    const calls: Array<{ file: string; args: readonly string[]; argumentCount: number }> = [];
    const runner = (async function (file: string, args: readonly string[]) {
      calls.push({ file, args, argumentCount: arguments.length });
      const outputBase = args.at(-1);

      if (outputBase === undefined) {
        throw new Error("missing output path");
      }

      await writeFile(`${outputBase}.txt`, "hello world\n");
    }) as unknown as NonNullable<ConstructorParameters<typeof WhisperCppAdapter>[0]["runner"]>;
    const adapter = new WhisperCppAdapter({ binPath: "/bin/whisper", modelPath: "/models/ggml.bin", runner });

    await expect(adapter.transcribe({ wavPath: "/tmp/input.wav", language: "en" })).resolves.toEqual({
      text: "hello world",
      confidence: null,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("/bin/whisper");
    expect(calls[0]?.argumentCount).toBe(2);
    expect(calls[0]?.args.slice(0, 7)).toEqual(["-m", "/models/ggml.bin", "-f", "/tmp/input.wav", "-l", "en", "-otxt"]);
    expect(calls[0]?.args[7]).toBe("-of");
    expect(calls[0]?.args[8]).toContain("transcript");
  });

  it("reports piper runtime_not_configured when paths are missing", async () => {
    const adapter = new PiperAdapter({ binPath: "", voicePath: "" });

    await expect(adapter.health()).resolves.toEqual({
      status: "missing_model",
      reason: "runtime_not_configured",
    });
  });

  it("uses configured Piper voice path instead of per-call logical voice id", async () => {
    const calls: Array<{ file: string; args: readonly string[]; input: string | undefined }> = [];
    const runner = (async (file: string, args: readonly string[], options?: { input?: string }) => {
      calls.push({ file, args, input: options?.input });
      const outPath = args.at(-1);

      if (outPath === undefined) {
        throw new Error("missing output path");
      }

      await writeFile(outPath, Buffer.from("wav-data"));
    }) as unknown as NonNullable<ConstructorParameters<typeof PiperAdapter>[0]["runner"]>;
    const adapter = new PiperAdapter({ binPath: "/bin/piper", voicePath: "/voices/amy.onnx", runner });

    await expect(adapter.synthesize({ text: "Hello", voicePath: "voice_piper_amy" })).resolves.toEqual({
      audioBase64: Buffer.from("wav-data").toString("base64"),
      mimeType: "audio/wav",
    });

    expect(calls).toEqual([
      {
        file: "/bin/piper",
        args: ["--model", "/voices/amy.onnx", "--output_file", calls[0]?.args[3]],
        input: "Hello",
      },
    ]);
  });

  it("returns base64 audio from Piper generated WAV file", async () => {
    const runner = (async (_file: string, args: readonly string[]) => {
      const outPath = args.at(-1);

      if (outPath === undefined) {
        throw new Error("missing output path");
      }

      await writeFile(outPath, Buffer.from([1, 2, 3, 4]));
    }) as unknown as NonNullable<ConstructorParameters<typeof PiperAdapter>[0]["runner"]>;
    const adapter = new PiperAdapter({ binPath: "/bin/piper", voicePath: "/voices/amy.onnx", runner });

    await expect(adapter.synthesize({ text: "Hello", voicePath: "logical-id" })).resolves.toEqual({
      audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      mimeType: "audio/wav",
    });
  });
});
