import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "@/server/config";
import type { RuntimeAdapter } from "@/domain/types";
import { LipiMlSttAdapter, LipiMlTtsAdapter } from "@/server/runtimes/lipiMl";
import { OllamaAdapter } from "@/server/runtimes/ollama";
import { OpenAICompatibleAdapter } from "@/server/runtimes/openAiCompatible";
import { PiperAdapter } from "@/server/runtimes/piper";
import { PiperHttpAdapter } from "@/server/runtimes/piperHttp";
import { CoquiHttpAdapter } from "@/server/runtimes/coquiHttp";
import { FastPitchHttpAdapter } from "@/server/runtimes/fastPitchHttp";
import { IndicParlerHttpAdapter } from "@/server/runtimes/indicParlerHttp";
import type { LlmAdapter, SttAdapter, TtsAdapter } from "@/server/runtimes/types";
import { WhisperCppAdapter } from "@/server/runtimes/whisperCpp";
import type { Repositories } from "@/server/store/repositories";
import type {
  VoiceSocketCallSession,
  VoiceSocketDeps,
  VoiceSocketRecordedEvent,
  VoiceSocketSessionContext,
} from "@/server/ws/voiceSocket";
import { writeWebmToWav } from "@/server/audio/wav";
import { executeTool } from "@/server/tools/executor";
import type { Agent, CallEvent, CallStatus } from "@/domain/types";
import { isNoSpeechDetectedError, runVoiceTurn } from "./pipeline";

interface RuntimeAdapters {
  llm: LlmAdapter;
  llmAdapters?: Partial<Record<RuntimeAdapter, LlmAdapter>>;
  stt: SttAdapter;
  tts: TtsAdapter;
  ttsAdapters?: Partial<Record<RuntimeAdapter, TtsAdapter>>;
}

interface WavFile {
  wavPath: string;
  cleanup(): Promise<void>;
}

interface CreateVoiceSocketDepsOptions {
  config: ServerConfig;
  repositories: Repositories;
  runtimes?: RuntimeAdapters;
  ttsAdapters?: Partial<Record<RuntimeAdapter, TtsAdapter>>;
  writeAudioChunkToWav?: (input: { mimeType: string; audioBase64: string }) => Promise<WavFile>;
  toolFetch?: typeof fetch;
  now?: () => Date;
}

export function createVoiceSocketDeps(options: CreateVoiceSocketDepsOptions): VoiceSocketDeps {
  const runtimes = options.runtimes ?? createRuntimeAdapters(options.config);
  const ttsAdapters = {
    piper: runtimes.tts,
    ...runtimes.ttsAdapters,
    ...options.ttsAdapters,
  };
  const writeAudioChunkToWav = options.writeAudioChunkToWav ?? writeAudioChunkToWavFile;
  const defaultSessionContext: VoiceSocketSessionContext = {};
  const histories = new WeakMap<VoiceSocketSessionContext, Array<{ role: "user" | "assistant"; content: string }>>();
  const now = options.now ?? (() => new Date());

  return {
    async checkReady(context) {
      const agent = activeAgent(options.repositories, context?.agentId);
      const selectedLlm = llmAdapterForAgent(
        options.repositories,
        agent,
        options.config.vllmModel,
        runtimes.llm,
        runtimes.llmAdapters,
      );
      if (!selectedLlm) {
        return { ready: false, reason: "runtime_not_configured" };
      }

      const selectedTts = ttsAdapterForAgent(options.repositories, agent, runtimes.tts, ttsAdapters);
      if (!selectedTts) {
        return { ready: false, reason: "runtime_not_configured" };
      }

      const health = await Promise.all([selectedLlm.adapter.health(), runtimes.stt.health(), selectedTts.adapter.health()]);

      if (health.every((result) => result.status === "healthy")) {
        return { ready: true };
      }

      return { ready: false, reason: "runtime_not_configured" };
    },
    async createCallSession(context) {
      return createRepositoryCallSession(options.repositories, now, context);
    },
    async processAudio(input, context) {
      const agent = activeAgent(options.repositories, context?.agentId);
      const selectedLlm = llmAdapterForAgent(
        options.repositories,
        agent,
        options.config.vllmModel,
        runtimes.llm,
        runtimes.llmAdapters,
      );
      if (!selectedLlm) {
        throw new Error("No LLM adapter is configured for the selected agent runtime");
      }

      const selectedTts = ttsAdapterForAgent(options.repositories, agent, runtimes.tts, ttsAdapters);
      if (!selectedTts) {
        throw new Error("No TTS adapter is configured for the selected agent voice");
      }
      const tools = options.repositories.tools
        .list()
        .filter((tool) => agent.toolIds.includes(tool.id));
      const history = historyForContext(histories, context ?? defaultSessionContext);

      const wav = await writeAudioChunkToWav(input).catch((error: unknown) => {
        console.warn("Skipping undecodable voice audio chunk", error);
        return null;
      });

      if (!wav) {
        return { events: [], skippedReason: "audio_decode_failed" };
      }

      try {
        const result = await runVoiceTurn({
          agent,
          model: selectedLlm.modelName,
          audioWavPath: wav.wavPath,
          stt: runtimes.stt,
          llm: selectedLlm.adapter,
          tts: ttsWithMetadata(selectedTts.adapter, {
            providerId: selectedTts.providerId,
            voiceId: agent.voiceId,
          }),
          history,
          tools,
          toolExecutor: (tool, args) =>
            executeTool(tool, args, {
              fetchImpl: options.toolFetch,
              allowPrivateUrls: options.repositories.settings.get().allowPrivateToolUrls,
            }),
        }).catch((error: unknown) => {
          if (isNoSpeechDetectedError(error)) {
            return null;
          }

          throw error;
        });

        if (!result) {
          return { events: [], skippedReason: "no_speech_detected" };
        }

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
  context: VoiceSocketSessionContext | undefined,
): VoiceSocketCallSession {
  const agent = activeAgent(repositories, context?.agentId);
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

function activeAgent(repositories: Repositories, agentId?: string | null): Agent {
  const agent = agentId ? repositories.agents.get(agentId) : repositories.agents.list()[0];
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
    const tts = new LipiMlTtsAdapter({ baseUrl: config.lipiMlBaseUrl });
    const vllm = new OpenAICompatibleAdapter({ baseUrl: config.vllmBaseUrl, model: config.vllmModel });

    return {
      llm: vllm,
      llmAdapters: {
        vllm,
      },
      stt: new LipiMlSttAdapter({ baseUrl: config.lipiMlBaseUrl }),
      tts,
      ttsAdapters: {
        piper: tts,
        piper_http: new PiperHttpAdapter({ endpoint: config.piperHttpEndpoint }),
        coqui_http: new CoquiHttpAdapter({ endpoint: config.coquiHttpEndpoint }),
        fastpitch_http: new FastPitchHttpAdapter({ endpoint: config.fastPitchHttpEndpoint }),
        indic_parler: new IndicParlerHttpAdapter({ endpoint: config.indicParlerEndpoint }),
      },
    };
  }

  const piper = new PiperAdapter({ binPath: config.piperBin, voicePath: config.piperVoicePath });

  return {
    llm: new OllamaAdapter({ baseUrl: config.ollamaBaseUrl, model: config.ollamaModel }),
    llmAdapters: {},
    stt: new WhisperCppAdapter({ binPath: config.whisperCppBin, modelPath: config.whisperModelPath }),
    tts: piper,
    ttsAdapters: {
      piper,
      piper_http: new PiperHttpAdapter({ endpoint: config.piperHttpEndpoint }),
      coqui_http: new CoquiHttpAdapter({ endpoint: config.coquiHttpEndpoint }),
      fastpitch_http: new FastPitchHttpAdapter({ endpoint: config.fastPitchHttpEndpoint }),
      indic_parler: new IndicParlerHttpAdapter({ endpoint: config.indicParlerEndpoint }),
    },
  };
}

function llmAdapterForAgent(
  repositories: Repositories,
  agent: Agent,
  llmModelHint: string | undefined,
  fallbackLlm: LlmAdapter,
  llmAdapters?: Partial<Record<RuntimeAdapter, LlmAdapter>>,
): { adapter: LlmAdapter; modelName: string } | null {
  const runtime = repositories.runtimes.list().find((candidate) => candidate.id === agent.modelRuntimeId);
  const modelAsset = repositories.modelAssets.list().find((asset) => asset.id === agent.modelAssetId);
  const selectedModel = resolveVllmModelForAgent({
    runtimeAdapter: runtime?.adapter,
    modelAssetId: modelAsset?.id,
    modelAssetPath: modelAsset?.pathOrTag,
    llmModelHint,
    modelFallback: agent.modelAssetId,
    defaultVllmModelAssetId: "model_vllm_remote",
  });
  const availableLlmAdapters = llmAdapters ?? {};
  if (!runtime) {
    return null;
  }
  const adapter = availableLlmAdapters[runtime.adapter];
  const hasExplicitLlmMap = llmAdapters !== undefined;
  if (!adapter) {
    if (!hasExplicitLlmMap || runtime.adapter === "ollama") {
      return {
        adapter: fallbackLlm,
        modelName: selectedModel,
      };
    }

    return null;
  }

  return {
    adapter,
    modelName: selectedModel,
  };
}

function resolveVllmModelForAgent(input: {
  runtimeAdapter?: string;
  modelAssetId?: string;
  modelAssetPath?: string;
  llmModelHint?: string;
  modelFallback: string;
  defaultVllmModelAssetId: string;
}): string {
  if (
    input.runtimeAdapter === "vllm" &&
    input.modelAssetId === input.defaultVllmModelAssetId &&
    input.llmModelHint &&
    input.llmModelHint.length > 0
  ) {
    return input.llmModelHint;
  }

  return input.modelAssetPath ?? input.llmModelHint ?? input.modelFallback;
}

function historyForContext(
  histories: WeakMap<VoiceSocketSessionContext, Array<{ role: "user" | "assistant"; content: string }>>,
  context: VoiceSocketSessionContext,
) {
  const existing = histories.get(context);
  if (existing) {
    return existing;
  }

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  histories.set(context, history);
  return history;
}

function ttsAdapterForAgent(
  repositories: Repositories,
  agent: Agent,
  fallbackTts: TtsAdapter,
  ttsAdapters: Partial<Record<RuntimeAdapter, TtsAdapter>>,
) {
  const voice = repositories.voices.get(agent.voiceId);
  const runtime = voice ? repositories.runtimes.list().find((candidate) => candidate.id === voice.runtimeId) : null;
  const providerId = runtime?.adapter ?? "piper";
  const adapter = runtime ? ttsAdapters[runtime.adapter] ?? fallbackTts : fallbackTts;

  return adapter ? { adapter, providerId } : null;
}

function ttsWithMetadata(
  adapter: TtsAdapter,
  metadata: { providerId: string; voiceId: string },
): TtsAdapter {
  return {
    health: () => adapter.health(),
    async synthesize(input) {
      const audio = await adapter.synthesize(input);
      return {
        ...audio,
        providerId: metadata.providerId,
        voiceId: metadata.voiceId,
      };
    },
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
