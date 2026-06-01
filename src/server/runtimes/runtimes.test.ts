import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSpeechTurn } from "./energyVad";
import { GoogleCloudTtsAdapter } from "./googleCloudTts";
import { mapRuntimeHealth } from "./health";
import { LipiMlSttAdapter, LipiMlTtsAdapter } from "./lipiMl";
import { OllamaAdapter } from "./ollama";
import { OpenAICompatibleAdapter } from "./openAiCompatible";
import { PiperAdapter } from "./piper";
import { TtsModelCatalog } from "./ttsModelCatalog";
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

  it("reports healthy OpenAI-compatible health when models include configured vLLM model", async () => {
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "http://vllm.test/v1",
      model: "gemma-4",
      fetchImpl: async () => Response.json({ data: [{ id: "gemma-4" }] }),
    });

    await expect(adapter.health()).resolves.toMatchObject({
      status: "healthy",
      reason: null,
    });
  });

  it("sends OpenAI-compatible chat completions and returns assistant content", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "http://vllm.test/v1",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ choices: [{ message: { content: "remote reply" } }] });
      },
    });

    await expect(
      adapter.chat({
        model: "gemma-4",
        system: "Be concise.",
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).resolves.toBe("remote reply");

    expect(requests[0]?.url).toBe("http://vllm.test/v1/chat/completions");
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      model: "gemma-4",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      stream: false,
    });
  });

  it("reports healthy lipi-ml STT health when faster-whisper is loaded", async () => {
    const adapter = new LipiMlSttAdapter({
      baseUrl: "http://lipi-ml.test",
      fetchImpl: async () => Response.json({ status: "ok", stt_loaded: true }),
    });

    await expect(adapter.health()).resolves.toMatchObject({ status: "healthy", reason: null });
  });

  it("posts WAV audio to lipi-ml STT and normalizes the transcript response", async () => {
    const audioFile = await createTempAudioFile();
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const adapter = new LipiMlSttAdapter({
      baseUrl: "http://lipi-ml.test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ text: "Hello from remote STT", confidence: 0.77 });
      },
    });

    await expect(adapter.transcribe({ wavPath: audioFile.path, language: "en" })).resolves.toEqual({
      text: "Hello from remote STT",
      confidence: 0.77,
    });

    expect(requests[0]?.url).toBe("http://lipi-ml.test/stt");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.body).toBeInstanceOf(FormData);

    await audioFile.cleanup();
  });

  it("posts text to lipi-ml TTS and returns base64 WAV audio", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const adapter = new LipiMlTtsAdapter({
      baseUrl: "http://lipi-ml.test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(Buffer.from("wav-data"), {
          headers: { "content-type": "audio/wav" },
        });
      },
    });

    await expect(adapter.synthesize({ text: "Namaste", voicePath: "voice_lipi_ml_ne" })).resolves.toEqual({
      audioBase64: Buffer.from("wav-data").toString("base64"),
      mimeType: "audio/wav",
    });

    expect(requests[0]?.url).toBe("http://lipi-ml.test/tts");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ text: "Namaste", language: "ne" });
  });

  it("authenticates Google Cloud TTS service accounts and returns MP3 audio", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-google-tts-test-"));
    const credentialsPath = join(tempDir, "service-account.json");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await writeFile(
      credentialsPath,
      JSON.stringify({
        type: "service_account",
        client_email: "lipivoice@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    );
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const adapter = new GoogleCloudTtsAdapter({
      credentialsPath,
      languageCode: "ne-NP",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "access-token", expires_in: 3600 });
        }
        if (String(url).startsWith("https://texttospeech.googleapis.com/v1/voices")) {
          return Response.json({ voices: [{ name: "ne-NP-Standard-A", languageCodes: ["ne-NP"] }] });
        }
        if (String(url) === "https://texttospeech.googleapis.com/v1/text:synthesize") {
          return Response.json({ audioContent: Buffer.from("mp3-data").toString("base64") });
        }
        return Response.json({ error: "unexpected" }, { status: 404 });
      },
      now: () => new Date("2026-06-01T00:00:00.000Z").getTime(),
    });

    await expect(adapter.health()).resolves.toEqual({ status: "healthy", reason: null });
    await expect(adapter.synthesize({ text: "नमस्ते", voicePath: "voice_google_tts_ne" })).resolves.toEqual({
      audioBase64: Buffer.from("mp3-data").toString("base64"),
      mimeType: "audio/mpeg",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://texttospeech.googleapis.com/v1/voices?languageCode=ne-NP",
      "https://texttospeech.googleapis.com/v1/text:synthesize",
    ]);
    expect(JSON.parse(String(requests[2]?.init?.body))).toMatchObject({
      input: { text: "नमस्ते" },
      voice: { languageCode: "ne-NP" },
      audioConfig: { audioEncoding: "MP3" },
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("maps downloaded TTS model manifest entries to provider health", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-model-catalog-test-"));
    const manifestPath = join(tempDir, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        models: {
          indic_parler_tts: { status: "gated_missing_hf_token", file_count: 1, bytes: 100 },
          omnivoice_gguf: { status: "downloaded", file_count: 4, bytes: 1_600_000_000 },
          chatterbox_base: { status: "downloaded", file_count: 9, bytes: 3_000_000_000 },
          chatterbox_nepali: { status: "gated_missing_hf_token", file_count: 1, bytes: 100 },
          coqui_piper_vits: { status: "linked_existing", file_count: 2, bytes: 75_000_000 },
        },
      }),
    );
    const catalog = new TtsModelCatalog({ manifestPath });

    await expect(catalog.health("omnivoice")).resolves.toEqual({ status: "healthy", reason: null });
    await expect(catalog.health("indic_parler")).resolves.toEqual({
      status: "license_required",
      reason: "hf_token_required",
    });
    await expect(catalog.health("chatterbox_nepali")).resolves.toEqual({
      status: "license_required",
      reason: "hf_token_required",
    });
    await expect(catalog.health("coqui_vits")).resolves.toEqual({ status: "healthy", reason: null });

    await rm(tempDir, { recursive: true, force: true });
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

async function createTempAudioFile() {
  const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-runtime-test-"));
  const path = join(tempDir, "speech.wav");
  await writeFile(path, Buffer.from("wav-data"));

  return {
    path,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}
