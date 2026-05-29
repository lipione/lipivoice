import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "@/server/config";
import { LipiMlSttAdapter, LipiMlTtsAdapter } from "@/server/runtimes/lipiMl";
import { OllamaAdapter } from "@/server/runtimes/ollama";
import { OpenAICompatibleAdapter } from "@/server/runtimes/openAiCompatible";
import { PiperAdapter } from "@/server/runtimes/piper";
import type { LlmAdapter, SttAdapter, TtsAdapter } from "@/server/runtimes/types";
import { WhisperCppAdapter } from "@/server/runtimes/whisperCpp";
import type { Repositories } from "@/server/store/repositories";
import type { VoiceSocketDeps } from "@/server/ws/voiceSocket";
import { writeWebmToWav } from "@/server/audio/wav";
import { runVoiceTurn } from "./pipeline";

interface RuntimeAdapters {
  llm: LlmAdapter;
  stt: SttAdapter;
  tts: TtsAdapter;
}

interface WavFile {
  wavPath: string;
  cleanup(): Promise<void>;
}

interface CreateVoiceSocketDepsOptions {
  config: ServerConfig;
  repositories: Repositories;
  runtimes?: RuntimeAdapters;
  writeAudioChunkToWav?: (input: { mimeType: string; audioBase64: string }) => Promise<WavFile>;
}

export function createVoiceSocketDeps(options: CreateVoiceSocketDepsOptions): VoiceSocketDeps {
  const runtimes = options.runtimes ?? createRuntimeAdapters(options.config);
  const writeAudioChunkToWav = options.writeAudioChunkToWav ?? writeAudioChunkToWavFile;
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  return {
    async checkReady() {
      const health = await Promise.all([runtimes.llm.health(), runtimes.stt.health(), runtimes.tts.health()]);

      if (health.every((result) => result.status === "healthy")) {
        return { ready: true };
      }

      return { ready: false, reason: "runtime_not_configured" };
    },
    async processAudio(input) {
      const agent = options.repositories.agents.list()[0];
      if (!agent) {
        throw new Error("No voice agent is configured");
      }

      const wav = await writeAudioChunkToWav(input);
      try {
        const result = await runVoiceTurn({
          agent,
          model: modelNameForConfig(options.config),
          audioWavPath: wav.wavPath,
          stt: runtimes.stt,
          llm: runtimes.llm,
          tts: runtimes.tts,
          history,
        });

        history.push(
          { role: "user", content: result.userText },
          { role: "assistant", content: result.assistantText },
        );

        return { events: result.events };
      } finally {
        await wav.cleanup();
      }
    },
  };
}

function createRuntimeAdapters(config: ServerConfig): RuntimeAdapters {
  if (config.runtimePreset === "remote") {
    return {
      llm: new OpenAICompatibleAdapter({ baseUrl: config.vllmBaseUrl, model: config.vllmModel }),
      stt: new LipiMlSttAdapter({ baseUrl: config.lipiMlBaseUrl }),
      tts: new LipiMlTtsAdapter({ baseUrl: config.lipiMlBaseUrl }),
    };
  }

  return {
    llm: new OllamaAdapter({ baseUrl: config.ollamaBaseUrl, model: config.ollamaModel }),
    stt: new WhisperCppAdapter({ binPath: config.whisperCppBin, modelPath: config.whisperModelPath }),
    tts: new PiperAdapter({ binPath: config.piperBin, voicePath: config.piperVoicePath }),
  };
}

async function writeAudioChunkToWavFile(input: { mimeType: string; audioBase64: string }): Promise<WavFile> {
  const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-turn-"));
  const inputPath = join(tempDir, input.mimeType.includes("wav") ? "input.wav" : "input.webm");
  const wavPath = join(tempDir, "turn.wav");

  await writeFile(inputPath, Buffer.from(input.audioBase64, "base64"));

  if (input.mimeType.includes("wav")) {
    return { wavPath: inputPath, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  }

  await writeWebmToWav(inputPath, wavPath);

  return { wavPath, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

function modelNameForConfig(config: ServerConfig): string {
  return config.runtimePreset === "remote" ? config.vllmModel : config.ollamaModel;
}
