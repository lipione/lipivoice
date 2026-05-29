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
import type {
  VoiceSocketCallSession,
  VoiceSocketDeps,
  VoiceSocketRecordedEvent,
} from "@/server/ws/voiceSocket";
import { writeWebmToWav } from "@/server/audio/wav";
import { executeTool } from "@/server/tools/executor";
import type { Agent, CallEvent, CallStatus } from "@/domain/types";
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
  toolFetch?: typeof fetch;
  now?: () => Date;
}

export function createVoiceSocketDeps(options: CreateVoiceSocketDepsOptions): VoiceSocketDeps {
  const runtimes = options.runtimes ?? createRuntimeAdapters(options.config);
  const writeAudioChunkToWav = options.writeAudioChunkToWav ?? writeAudioChunkToWavFile;
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const now = options.now ?? (() => new Date());

  return {
    async checkReady() {
      const health = await Promise.all([runtimes.llm.health(), runtimes.stt.health(), runtimes.tts.health()]);

      if (health.every((result) => result.status === "healthy")) {
        return { ready: true };
      }

      return { ready: false, reason: "runtime_not_configured" };
    },
    async createCallSession() {
      return createRepositoryCallSession(options.repositories, now);
    },
    async processAudio(input) {
      const agent = activeAgent(options.repositories);
      const tools = options.repositories.tools
        .list()
        .filter((tool) => agent.toolIds.includes(tool.id));

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
          tools,
          toolExecutor: (tool, args) => executeTool(tool, args, { fetchImpl: options.toolFetch }),
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

function createRepositoryCallSession(
  repositories: Repositories,
  now: () => Date,
): VoiceSocketCallSession {
  const agent = activeAgent(repositories);
  const startedAt = now();
  const call = repositories.transaction(() => {
    const createdCall = repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: agent.id,
      status: "connected",
      startedAt: startedAt.toISOString(),
    });

    repositories.callEvents.append({
      callId: createdCall.id,
      timestamp: startedAt.toISOString(),
      type: "status",
      actor: "system",
      payload: { status: "connected" },
      severity: "info",
    });

    return createdCall;
  });

  let finished = false;

  return {
    record(event) {
      const eventType = callEventType(event.type);
      if (!eventType) {
        return;
      }

      const timestamp = now().toISOString();
      const payload = sanitizeEventPayload(event);
      repositories.transaction(() => {
        repositories.callEvents.append({
          callId: call.id,
          timestamp,
          type: eventType,
          actor: event.actor,
          payload,
          severity: event.severity,
        });

        updateCallStatusFromEvent(repositories, call.id, eventType, payload);
      });
    },
    finish(input) {
      if (finished) {
        return;
      }

      finished = true;
      const existing = repositories.calls.get(call.id);
      if (!existing) {
        return;
      }

      const endedAt = now();
      repositories.calls.update({
        ...existing,
        status: callStatus(input.status) ?? "disconnected",
        endedAt: endedAt.toISOString(),
        durationSeconds: durationSeconds(existing.startedAt, endedAt.toISOString()),
        failureReason: input.failureReason,
      });
    },
  };
}

function activeAgent(repositories: Repositories): Agent {
  const agent = repositories.agents.list()[0];
  if (!agent) {
    throw new Error("No voice agent is configured");
  }

  return agent;
}

function sanitizeEventPayload(event: VoiceSocketRecordedEvent) {
  if (event.type !== "audio") {
    return event.payload;
  }

  const { audioBase64, ...payload } = event.payload;
  if (typeof audioBase64 === "string") {
    return {
      ...payload,
      audioBytes: Buffer.byteLength(audioBase64, "base64"),
    };
  }

  return payload;
}

function updateCallStatusFromEvent(
  repositories: Repositories,
  callId: string,
  eventType: CallEvent["type"],
  payload: Record<string, unknown>,
) {
  if (eventType !== "status" || typeof payload.status !== "string") {
    return;
  }

  const status = callStatus(payload.status);
  const call = repositories.calls.get(callId);
  if (!status || !call || call.endedAt) {
    return;
  }

  repositories.calls.update({
    ...call,
    status,
    failureReason: status === "failed" && typeof payload.reason === "string" ? payload.reason : call.failureReason,
  });
}

function durationSeconds(startedAt: string, endedAt: string) {
  return Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
}

function callEventType(type: string): CallEvent["type"] | null {
  if (
    type === "status" ||
    type === "transcript" ||
    type === "tool_call" ||
    type === "audio" ||
    type === "runtime" ||
    type === "error"
  ) {
    return type;
  }

  return null;
}

function callStatus(status: string): CallStatus | null {
  if (
    status === "idle" ||
    status === "requesting_mic" ||
    status === "connecting" ||
    status === "connected" ||
    status === "listening" ||
    status === "thinking" ||
    status === "speaking" ||
    status === "disconnected" ||
    status === "failed"
  ) {
    return status;
  }

  return null;
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
