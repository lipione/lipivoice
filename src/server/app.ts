import { existsSync } from "node:fs";
import { join } from "node:path";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { nanoid } from "nanoid";
import { createDefaultWorkspace, createRemoteWorkspace } from "@/domain/defaults";
import {
  agentSchema,
  evalDefinitionSchema,
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  phoneNumberSchema,
  toolSchema,
  workspaceSettingsSchema,
} from "@/domain/schemas";
import type {
  Agent,
  Appointment,
  CallEvent,
  Campaign,
  CampaignContact,
  ConsentRecord,
  ConfiguredState,
  Customer,
  EvalCase,
  EvalCheck,
  EvalDefinition,
  EvalRun,
  Policy,
  RuntimeAdapter,
  TtsBenchmarkResult,
  TtsProvider,
  UsageSummary,
  WorkspaceSettings,
  CallStatus,
  Call,
  Ticket,
} from "@/domain/types";
import { listTtsProviders } from "@/domain/ttsProviders";
import { createDatabase } from "./store/database";
import { createRepositories, type Repositories } from "./store/repositories";
import type { ServerConfig } from "./config";
import { LipiMlSttAdapter, LipiMlTtsAdapter } from "./runtimes/lipiMl";
import { OllamaAdapter } from "./runtimes/ollama";
import { OpenAICompatibleAdapter } from "./runtimes/openAiCompatible";
import { PiperAdapter } from "./runtimes/piper";
import { PiperHttpAdapter } from "./runtimes/piperHttp";
import { CoquiHttpAdapter } from "./runtimes/coquiHttp";
import { FastPitchHttpAdapter } from "./runtimes/fastPitchHttp";
import { FasterWhisperAdapter } from "./runtimes/fasterWhisper";
import { IndicParlerHttpAdapter } from "./runtimes/indicParlerHttp";
import { TtsModelCatalog } from "./runtimes/ttsModelCatalog";
import { WhisperCppAdapter } from "./runtimes/whisperCpp";
import type { LlmAdapter, RuntimeHealthResult, TtsAdapter } from "./runtimes/types";
import { createRealtimeSessionStore, type RealtimeSessionStore } from "./realtime/sessionTokens";
import { executeTool } from "./tools/executor";
import {
  createLiveKitService,
  isLiveKitConfigured,
  type LiveKitOutboundSipCall,
  type LiveKitWebCall,
} from "./livekit/service";
import { createCampaignService, type OutboundCallRequest } from "./campaigns/campaignService";
import { createCmsAdapter } from "./cms/cmsAdapter";
import {
  countUnsupportedUserTurns,
  unsupportedLanguageIntakeInstructionForTurn,
  unsupportedLanguageIntakeFallback,
  unsupportedLanguageResponse,
  repeatsUnsupportedLanguageClarification,
} from "./languageGuard";

type WorkspaceSeed = ReturnType<typeof createDefaultWorkspace>;
type RuntimeHealthChecks = Partial<Record<RuntimeAdapter, () => Promise<RuntimeHealthResult>>>;
type EvalResponder = (input: { agent: Agent; evalCase: EvalCase }) => Promise<string>;
const SIP_TRUNK_PASSWORD_SECRET_ID = "sip_trunk_password";

interface AppDeps {
  llm?: LlmAdapter | null;
  llmModel?: string;
  llmAdapters?: Partial<Record<RuntimeAdapter, LlmAdapter>>;
  tts?: TtsAdapter | null;
  ttsAdapters?: Partial<Record<RuntimeAdapter, TtsAdapter>>;
  runtimeHealth?: RuntimeHealthChecks;
  realtimeSessions?: RealtimeSessionStore;
  toolFetch?: typeof fetch;
  allowPrivateToolUrls?: boolean;
  evalResponder?: EvalResponder;
  now?: () => Date;
  liveKit?: {
    startWebCall(input: {
      callId: string;
      agentId: string;
      participantIdentity: string;
    }): Promise<LiveKitWebCall>;
    startOutboundSipCall?(input: {
      callId: string;
      agentId: string;
      toNumber: string;
      fromNumber: string;
      contactName: string;
      campaignId?: string;
      campaignRunId?: string;
      contextPromptSuffix?: string;
      asteriskAddress?: string;
    }): Promise<LiveKitOutboundSipCall>;
  } | null;
  workerApiKey?: string;
  liveKitConfigured?: boolean;
  adminToken?: string;
  adminUsername?: string;
  adminPassword?: string;
  initiateOutboundCall?: (input: OutboundCallRequest) => Promise<{ callId: string } | null>;
}

export interface AppContext {
  app: express.Express;
  repositories: Repositories;
  realtimeSessions: RealtimeSessionStore;
  close(): void;
}

export function createAppForTest(seed: WorkspaceSeed, deps?: AppDeps) {
  return createAppContextForTest(seed, deps).app;
}

export function createAppContextForTest(seed: WorkspaceSeed, deps?: AppDeps): AppContext {
  const repositories = createRepositories(createDatabase(":memory:"));
  repositories.seedWorkspace(seed);

  return createAppContextWithRepositories(repositories, deps);
}

export function createApp(config: ServerConfig): AppContext {
  const repositories = createRepositories(createDatabase(config.databasePath));
  repositories.seedWorkspace(createWorkspaceFromConfig(config));

  if (config.runtimePreset === "remote") {
    const vllm = new OpenAICompatibleAdapter({ baseUrl: config.vllmBaseUrl, model: config.vllmModel });
    const stt = new LipiMlSttAdapter({ baseUrl: config.lipiMlBaseUrl });
    const tts = new LipiMlTtsAdapter({ baseUrl: config.lipiMlBaseUrl });
    const piperHttp = new PiperHttpAdapter({ endpoint: config.piperHttpEndpoint });
    const coquiHttp = new CoquiHttpAdapter({ endpoint: config.coquiHttpEndpoint });
    const fastPitchHttp = new FastPitchHttpAdapter({ endpoint: config.fastPitchHttpEndpoint });
    const indicParler = new IndicParlerHttpAdapter({ endpoint: config.indicParlerEndpoint });
    const ttsModelCatalog = new TtsModelCatalog({ manifestPath: config.ttsModelManifestPath });
    const liveKitConfigured = isLiveKitConfigured(config);

    return createAppContextWithRepositories(repositories, {
      llm: vllm,
      llmModel: config.vllmModel,
      llmAdapters: {
        vllm,
      },
      tts,
      ttsAdapters: {
        piper: tts,
        piper_http: piperHttp,
        coqui_http: coquiHttp,
        fastpitch_http: fastPitchHttp,
        indic_parler: indicParler,
      },
      runtimeHealth: {
        vllm: () => vllm.health(),
        faster_whisper: () => stt.health(),
        piper: () => tts.health(),
        piper_http: () => piperHttp.health(),
        coqui_http: () => coquiHttp.health(),
        fastpitch_http: () => fastPitchHttp.health(),
        indic_parler: () => indicParler.health(),
        omnivoice: () => ttsModelCatalog.health("omnivoice"),
        chatterbox_nepali: () => ttsModelCatalog.health("chatterbox_nepali"),
      },
      liveKitConfigured,
      liveKit: createLiveKitService(config),
      workerApiKey: config.workerApiKey,
      adminToken: config.adminToken,
      adminUsername: config.adminUsername,
      adminPassword: config.adminPassword,
    });
  }

  const ollama = new OllamaAdapter({ baseUrl: config.ollamaBaseUrl, model: config.ollamaModel });
  const whisper = new WhisperCppAdapter({ binPath: config.whisperCppBin, modelPath: config.whisperModelPath });
  const piper = new PiperAdapter({ binPath: config.piperBin, voicePath: config.piperVoicePath });
  const piperHttp = new PiperHttpAdapter({ endpoint: config.piperHttpEndpoint ?? "http://localhost:5002" });
  const coquiHttp = new CoquiHttpAdapter({ endpoint: config.coquiHttpEndpoint ?? "http://localhost:5003" });
  const fastPitchHttp = new FastPitchHttpAdapter({ endpoint: config.fastPitchHttpEndpoint ?? "http://localhost:5004" });
  const indicParler = new IndicParlerHttpAdapter({ endpoint: config.indicParlerEndpoint ?? "http://localhost:5010" });
  const fasterWhisper = new FasterWhisperAdapter({ endpoint: config.fasterWhisperEndpoint ?? "http://localhost:9000" });
  const liveKitConfigured = isLiveKitConfigured(config);

  return createAppContextWithRepositories(repositories, {
    llm: ollama,
    llmModel: config.ollamaModel,
    tts: piper,
    ttsAdapters: {
      piper,
      piper_http: piperHttp,
      coqui_http: coquiHttp,
      fastpitch_http: fastPitchHttp,
      indic_parler: indicParler,
    },
    runtimeHealth: {
      ollama: () => ollama.health(),
      whisper_cpp: () => whisper.health(),
      piper: () => piper.health(),
      piper_http: () => piperHttp.health(),
      coqui_http: () => coquiHttp.health(),
      fastpitch_http: () => fastPitchHttp.health(),
      indic_parler: () => indicParler.health(),
      faster_whisper: () => fasterWhisper.health(),
    },
    liveKitConfigured,
    liveKit: createLiveKitService(config),
    workerApiKey: config.workerApiKey,
    adminToken: config.adminToken,
    adminUsername: config.adminUsername,
    adminPassword: config.adminPassword,
  });
}

function createWorkspaceFromConfig(config: ServerConfig): WorkspaceSeed {
  if (config.runtimePreset === "remote") {
    return createRemoteWorkspace({
      vllmEndpoint: config.vllmBaseUrl,
      vllmModel: config.vllmModel,
      lipiMlEndpoint: config.lipiMlBaseUrl,
      indicParlerEndpoint: config.indicParlerEndpoint,
      publicBaseUrl: config.publicBaseUrl,
    });
  }

  return createDefaultWorkspace();
}

function resolveAgentLlm(input: {
  agent: Agent;
  repositories: Repositories;
  llm?: LlmAdapter | null;
  llmModel?: string;
  llmAdapters?: Partial<Record<RuntimeAdapter, LlmAdapter>>;
}): { llm: LlmAdapter; model: string } | null {
  const runtime = input.repositories.runtimes.list().find((candidate) => candidate.id === input.agent.modelRuntimeId);
  const modelAsset = input.repositories.modelAssets.list().find((asset) => asset.id === input.agent.modelAssetId);
  const selectedModel = resolveVllmModelHint({
    runtimeAdapter: runtime?.adapter,
    modelAssetId: modelAsset?.id,
    modelAssetPath: modelAsset?.pathOrTag,
    runtimeModelHint: input.llmModel,
    modelFallback: input.agent.modelAssetId,
    defaultModelAssetId: "model_vllm_remote",
  });

  if (!runtime) {
    return null;
  }

  const adapter = input.llmAdapters?.[runtime.adapter] ?? null;
  if (!adapter) {
    const hasExplicitLlmMap = input.llmAdapters !== undefined;
    if ((!hasExplicitLlmMap || runtime.adapter === "ollama") && input.llm) {
      return {
        llm: input.llm,
        model: selectedModel,
      };
    }

    if (!input.llm) {
      return null;
    }
    return null;
  }

  return {
    llm: adapter,
    model: selectedModel,
  };
}

function resolveVllmModelHint(input: {
  runtimeAdapter?: string;
  modelAssetId?: string;
  modelAssetPath?: string;
  runtimeModelHint?: string;
  modelFallback: string;
  defaultModelAssetId: string;
}): string {
  if (
    input.runtimeAdapter === "vllm" &&
    input.modelAssetId === input.defaultModelAssetId &&
    input.runtimeModelHint &&
    input.runtimeModelHint.length > 0
  ) {
    return input.runtimeModelHint;
  }

  return input.modelAssetPath ?? input.runtimeModelHint ?? input.modelFallback;
}

function createAppContextWithRepositories(repositories: Repositories, deps: AppDeps = {}): AppContext {
  const app = express();
  let closed = false;
  const realtimeSessions = deps.realtimeSessions ?? createRealtimeSessionStore({ now: deps.now });

  app.set("trust proxy", true);
  app.use(cors());
  app.use(express.json());
  app.use(createRateLimitMiddleware(deps.now));
  app.use(createAdminAuthMiddleware(deps.adminToken));

  app.get("/api/auth/status", (request, response) => {
    const adminToken = deps.adminToken ?? "";

    response.json({
      required: Boolean(adminToken),
      authenticated: !adminToken || bearerToken(request) === adminToken,
    });
  });

  app.post("/api/auth/login", (request, response) => {
    const adminToken = deps.adminToken ?? "";
    const adminUsername = deps.adminUsername ?? "admin";
    const adminPassword = deps.adminPassword ?? "";
    const username = stringField(request.body?.username);
    const password = stringField(request.body?.password);

    if (!adminToken || !adminPassword) {
      response.status(409).json({ code: "password_login_not_configured" });
      return;
    }

    if (username !== adminUsername || password !== adminPassword) {
      response.status(401).json({ code: "invalid_credentials" });
      return;
    }

    response.json({ token: adminToken });
  });

  app.get("/api/agents", (_request, response) => {
    response.json(repositories.agents.list());
  });

  app.post("/api/agents", (request, response) => {
    const result = agentSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({ code: "invalid_agent" });
      return;
    }

    response.json(repositories.agents.save(result.data));
  });

  app.get("/api/voices", (_request, response) => {
    response.json(repositories.voices.list());
  });

  app.get("/api/voice-samples", (_request, response) => {
    response.json(repositories.voiceSamples.list());
  });

  app.get("/api/tools", (_request, response) => {
    response.json(repositories.tools.list());
  });

  app.post("/api/tools", (request, response) => {
    const result = toolSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({ code: "invalid_tool" });
      return;
    }

    response.json(repositories.tools.save(result.data));
  });

  app.get("/api/phone-numbers", (_request, response) => {
    response.json(repositories.phoneNumbers.list());
  });

  app.post("/api/phone-numbers", (request, response) => {
    const result = phoneNumberSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({ code: "invalid_phone_number" });
      return;
    }

    if (result.data.agentId && !repositories.agents.get(result.data.agentId)) {
      response.status(404).json({ code: "agent_not_found" });
      return;
    }

    response.json(repositories.phoneNumbers.save(result.data));
  });

  app.get("/api/knowledge-bases", (_request, response) => {
    response.json(repositories.knowledgeBases.list());
  });

  app.post("/api/knowledge-bases", (request, response) => {
    const result = knowledgeBaseSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({ code: "invalid_knowledge_base" });
      return;
    }

    response.json(repositories.knowledgeBases.save(result.data));
  });

  app.get("/api/knowledge-bases/:id/documents", (request, response) => {
    const knowledgeBase = repositories.knowledgeBases.get(request.params.id);

    if (!knowledgeBase) {
      response.status(404).json({ code: "knowledge_base_not_found" });
      return;
    }

    response.json(repositories.knowledgeDocuments.listForKnowledgeBase(knowledgeBase.id));
  });

  app.post("/api/knowledge-bases/:id/documents", (request, response) => {
    const knowledgeBase = repositories.knowledgeBases.get(request.params.id);

    if (!knowledgeBase) {
      response.status(404).json({ code: "knowledge_base_not_found" });
      return;
    }

    const now = currentTimestamp(deps.now);
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
    const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
    const sourceType = isKnowledgeSourceType(request.body?.sourceType) ? request.body.sourceType : "text";
    const document = knowledgeDocumentSchema.safeParse({
      id: typeof request.body?.id === "string" && request.body.id.trim()
        ? request.body.id.trim()
        : createKnowledgeDocumentId(title || "document"),
      knowledgeBaseId: knowledgeBase.id,
      title,
      sourceType,
      content,
      tokenCount: countTokens(content),
      createdAt: typeof request.body?.createdAt === "string" ? request.body.createdAt : now,
      updatedAt: now,
    });

    if (!document.success) {
      response.status(400).json({ code: "invalid_knowledge_document" });
      return;
    }

    const savedDocument = repositories.transaction(() => {
      const saved = repositories.knowledgeDocuments.save(document.data);
      const documentCount = repositories.knowledgeDocuments.listForKnowledgeBase(knowledgeBase.id).length;
      repositories.knowledgeBases.save({
        ...knowledgeBase,
        documentCount,
        status: "ready",
        updatedAt: now,
      });
      return saved;
    });

    response.json(savedDocument);
  });

  app.post("/api/knowledge-bases/:id/search", (request, response) => {
    const knowledgeBase = repositories.knowledgeBases.get(request.params.id);

    if (!knowledgeBase) {
      response.status(404).json({ code: "knowledge_base_not_found" });
      return;
    }

    const query = typeof request.body?.query === "string" ? request.body.query : "";
    response.json(repositories.knowledgeDocuments.search(knowledgeBase.id, query));
  });

  app.get("/api/evals", (_request, response) => {
    response.json(repositories.evals.list());
  });

  app.post("/api/evals", (request, response) => {
    const result = evalDefinitionSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({ code: "invalid_eval" });
      return;
    }

    if (!repositories.agents.get(result.data.agentId)) {
      response.status(404).json({ code: "agent_not_found" });
      return;
    }

    response.json(repositories.evals.save(result.data));
  });

  app.get("/api/evals/runs", (_request, response) => {
    response.json(repositories.evalRuns.list());
  });

  app.post("/api/evals/:id/run", async (request, response, next) => {
    try {
      const evalDefinition = repositories.evals.get(request.params.id);

      if (!evalDefinition) {
        response.status(404).json({ code: "eval_not_found" });
        return;
      }

      const agent = repositories.agents.get(evalDefinition.agentId);
      if (!agent) {
        response.status(404).json({ code: "agent_not_found" });
        return;
      }

      const run = await runEval(evalDefinition, agent, deps);
      response.status(201).json(repositories.evalRuns.append(run));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tools/executions", (_request, response) => {
    response.json(repositories.toolExecutions.list());
  });

  app.post("/api/tools/execute", async (request, response, next) => {
    try {
      const toolId = typeof request.body?.toolId === "string" ? request.body.toolId : "";
      const args = isRecord(request.body?.arguments) ? request.body.arguments : {};
      const tool = repositories.tools.get(toolId);

      if (!tool) {
        response.status(404).json({ code: "tool_not_found" });
        return;
      }

      const result = await executeTool(tool, args, {
        fetchImpl: deps.toolFetch,
        allowPrivateUrls: deps.allowPrivateToolUrls ?? repositories.settings.get().allowPrivateToolUrls,
      });
      const log = repositories.toolExecutions.append({
        ...result,
        timestamp: currentTimestamp(deps.now),
        error: result.error ?? null,
      });

      response.json(log);
    } catch (error) {
      next(error);
    }
  });

  async function sendModelRuntimes(response: express.Response, next: express.NextFunction) {
    try {
      response.json(await listModelRuntimes(repositories, deps.runtimeHealth));
    } catch (error) {
      next(error);
    }
  }

  app.get("/api/model-runtimes", async (_request, response, next) => {
    await sendModelRuntimes(response, next);
  });

  app.get("/api/model-assets", (_request, response) => {
    response.json(repositories.modelAssets.list());
  });

  app.post("/api/model-runtimes/health", async (_request, response, next) => {
    await sendModelRuntimes(response, next);
  });

  app.post("/api/realtime/session", (request, response) => {
    const requestedAgentId = typeof request.body?.agentId === "string" && request.body.agentId.trim()
      ? request.body.agentId.trim()
      : repositories.agents.list()[0]?.id;
    const agent = requestedAgentId ? repositories.agents.get(requestedAgentId) : null;

    if (!agent) {
      response.status(404).json({ code: "agent_not_found" });
      return;
    }

    response.status(201).json(
      realtimeSessions.createSession({
        agentId: agent.id,
        ttlMs: repositories.settings.get().realtimeSessionTtlSeconds * 1000,
      }),
    );
  });

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      timestamp: currentTimestamp(deps.now),
      storage: "ok",
      settingsLoaded: Boolean(repositories.settings.get()),
    });
  });

  app.get("/api/runtime-diagnostics", async (_request, response, next) => {
    const liveKitReady = Boolean(deps.liveKitConfigured);
    try {
      response.json({
        liveKit: {
          status: liveKitReady ? "healthy" : "missing_model",
          reason: liveKitReady ? null : "livekit_not_configured",
        },
        runtimes: await listModelRuntimes(repositories, deps.runtimeHealth),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", (_request, response) => {
    response.json(repositories.settings.get());
  });

  app.post("/api/settings", (request, response) => {
    const result = workspaceSettingsSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({ code: "invalid_settings" });
      return;
    }

    response.json(repositories.settings.save(normalizeSettings(result.data)));
  });

  app.get("/api/settings/sip-secret", (_request, response) => {
    response.json(sipSecretStatus(repositories));
  });

  app.post("/api/settings/sip-secret", (request, response) => {
    const password = typeof request.body?.password === "string" ? request.body.password.trim() : "";

    if (!password) {
      response.status(400).json({ code: "invalid_sip_secret" });
      return;
    }

    const saved = repositories.secrets.save({
      id: SIP_TRUNK_PASSWORD_SECRET_ID,
      value: password,
      updatedAt: currentTimestamp(deps.now),
    });

    response.json({
      configured: true,
      updatedAt: saved.updatedAt,
    });
  });

  app.delete("/api/settings/sip-secret", (_request, response) => {
    repositories.secrets.delete(SIP_TRUNK_PASSWORD_SECRET_ID);
    response.json({
      configured: false,
      updatedAt: null,
    });
  });

  app.get("/api/usage", (_request, response) => {
    expireStaleActiveCalls(repositories, deps.now);
    response.json(createUsageSummary(repositories));
  });

  app.get("/api/calls", (_request, response) => {
    expireStaleActiveCalls(repositories, deps.now);
    response.json(repositories.calls.list());
  });

  app.post("/api/calls/phone/start", (request, response) => {
    const phoneNumberId = typeof request.body?.phoneNumberId === "string" ? request.body.phoneNumberId : "";
    const direction = request.body?.direction === "outbound" ? "outbound" : "inbound";
    const phoneNumber = repositories.phoneNumbers.get(phoneNumberId);

    if (!phoneNumber) {
      response.status(404).json({ code: "phone_number_not_found" });
      return;
    }

    const directionEnabled = direction === "outbound" ? phoneNumber.outboundEnabled : phoneNumber.inboundEnabled;
    if (phoneNumber.status !== "active" || !directionEnabled) {
      response.status(409).json({ code: "phone_number_not_available" });
      return;
    }

    const agent = phoneNumber.agentId ? repositories.agents.get(phoneNumber.agentId) : null;
    if (!agent) {
      response.status(409).json({ code: "phone_number_unassigned" });
      return;
    }

    const result = repositories.transaction(() => {
      const now = currentTimestamp(deps.now);
      const call = repositories.calls.create({
        channel: "phone",
        direction,
        agentId: agent.id,
        phoneNumberId: phoneNumber.id,
        status: "connected",
        startedAt: now,
      });
      const event = repositories.callEvents.append({
        callId: call.id,
        timestamp: now,
        type: "status",
        actor: "system",
        payload: {
          status: "connected",
          phoneNumber: phoneNumber.number,
          phoneNumberId: phoneNumber.id,
          agentId: agent.id,
        },
        severity: "info",
      });

      return { call, events: [event] };
    });

    response.status(201).json(result);
  });

  app.post("/api/livekit/web-call/start", async (request, response, next) => {
    try {
      const agentId = typeof request.body?.agentId === "string" ? request.body.agentId : "";
      const agent = repositories.agents.get(agentId);

      if (!agent) {
        response.status(404).json({ code: "agent_not_found" });
        return;
      }

      if (!deps.liveKit) {
        response.status(409).json({ code: "livekit_not_configured" });
        return;
      }

      const now = currentTimestamp(deps.now);
      const call = repositories.calls.create({
        channel: "web",
        direction: "inbound",
        agentId: agent.id,
        status: "connected",
        startedAt: now,
      });
      const participantIdentity = `caller_${call.id}`;
      const livekit = await deps.liveKit.startWebCall({
        callId: call.id,
        agentId: agent.id,
        participantIdentity,
      });
      const event = repositories.callEvents.append({
        callId: call.id,
        timestamp: now,
        type: "status",
        actor: "system",
        payload: {
          status: "connected",
          transport: "livekit",
          roomName: livekit.roomName,
          participantIdentity,
          dispatchId: livekit.dispatchId,
        },
        severity: "info",
      });

      response.status(201).json({ call, events: [event], livekit });
    } catch (error) {
      if ((error as Error).message === "livekit_not_configured") {
        response.status(409).json({ code: "livekit_not_configured" });
        return;
      }

      next(error);
    }
  });

  app.post("/api/calls/:id/end", (request, response) => {
    const call = repositories.calls.get(request.params.id);

    if (!call) {
      response.status(404).json({ code: "call_not_found" });
      return;
    }

    if (call.endedAt) {
      response.json({ call, events: repositories.callEvents.listForCall(call.id) });
      return;
    }

    const requestedStatus = request.body?.status;
    const status: CallStatus = requestedStatus === "failed" ? "failed" : "disconnected";
    const failureReason =
      status === "failed" && typeof request.body?.failureReason === "string"
        ? request.body.failureReason
        : call.failureReason;

    const result = repositories.transaction(() => {
      const now = currentTimestamp(deps.now);
      const updatedCall = repositories.calls.update({
        ...call,
        status,
        endedAt: now,
        durationSeconds: durationSecondsBetween(call.startedAt, now),
        failureReason,
      });
      const event = repositories.callEvents.append({
        callId: call.id,
        timestamp: now,
        type: "status",
        actor: "system",
        payload: status === "failed" ? { status, reason: failureReason } : { status },
        severity: status === "failed" ? "error" : "info",
      });

      return { call: updatedCall, events: [event] };
    });

    response.json(result);
  });

  app.get("/api/calls/:id/events", (request, response) => {
    const call = repositories.calls.get(request.params.id);

    if (!call) {
      response.status(404).json({ code: "call_not_found" });
      return;
    }

    response.json(repositories.callEvents.listForCall(call.id));
  });

  app.get("/api/customers", (_request, response) => {
    response.json(repositories.customers.list());
  });

  app.post("/api/customers", (request, response) => {
    const now = currentTimestamp(deps.now);
    const name = stringField(request.body?.name) || "Caller";
    const phoneNumber = stringField(request.body?.phoneNumber) || stringField(request.body?.phone_number);

    if (!phoneNumber) {
      response.status(400).json({ code: "customer_phone_required" });
      return;
    }

    const existing = repositories.customers.findByPhone(normalizePhoneDigits(phoneNumber));
    const customer = repositories.customers.save({
      id: existing?.id ?? `cust_${nanoid(8)}`,
      name,
      phoneNumber: normalizePhoneDigits(phoneNumber),
      email: stringField(request.body?.email) || existing?.email || null,
      address: stringField(request.body?.address) || existing?.address || "",
      preferredLanguage: stringField(request.body?.preferredLanguage) || existing?.preferredLanguage || "ne-NP",
      notes: stringField(request.body?.notes) || existing?.notes || "",
      source: existing?.source ?? "manual",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastCallId: existing?.lastCallId ?? null,
    });

    response.status(existing ? 200 : 201).json(customer);
  });

  app.post("/api/renewals/import", (request, response) => {
    const records = Array.isArray(request.body?.records) ? request.body.records : [];
    if (records.length === 0) {
      response.status(400).json({ code: "renewal_records_required" });
      return;
    }

    const result = repositories.transaction(() => {
      const now = currentTimestamp(deps.now);
      const importedRecords = records.map((record: unknown) => importRenewalRecord({
        record: record as Record<string, unknown>,
        repositories,
        now,
      }));

      return {
        imported: importedRecords.length,
        customers: new Set(importedRecords.map((entry: { customer: Customer }) => entry.customer.id)).size,
        policies: importedRecords.length,
        records: importedRecords,
      };
    });

    response.status(201).json(result);
  });

  app.get("/api/tickets", (_request, response) => {
    response.json(repositories.tickets.list());
  });

  app.post("/api/tickets", (request, response) => {
    const now = currentTimestamp(deps.now);
    const subject = stringField(request.body?.subject);
    if (!subject) {
      response.status(400).json({ code: "ticket_subject_required" });
      return;
    }

    const ticket = repositories.tickets.save({
      id: `tkt_${nanoid(8)}`,
      customerId: stringField(request.body?.customerId) || null,
      callId: stringField(request.body?.callId) || null,
      type: ticketTypeFromInput(stringField(request.body?.type)),
      status: "open",
      priority: ticketPriorityFromInput(stringField(request.body?.priority)),
      subject,
      description: stringField(request.body?.description) || "",
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    response.status(201).json(ticket);
  });

  app.patch("/api/tickets/:id", (request, response) => {
    const ticket = repositories.tickets.get(request.params.id);
    if (!ticket) {
      response.status(404).json({ code: "ticket_not_found" });
      return;
    }

    const updated = repositories.tickets.save({
      ...ticket,
      status: ticketStatusFromInput(stringField(request.body?.status)) ?? ticket.status,
      priority: ticketPriorityFromInput(stringField(request.body?.priority)) ?? ticket.priority,
      subject: stringField(request.body?.subject) || ticket.subject,
      description: stringField(request.body?.description) || ticket.description,
      updatedAt: currentTimestamp(deps.now),
    });

    response.json(updated);
  });

  app.get("/api/appointments", (_request, response) => {
    response.json(repositories.appointments.list());
  });

  app.post("/api/appointments", (request, response) => {
    const now = currentTimestamp(deps.now);
    const phoneNumber = stringField(request.body?.phoneNumber) || stringField(request.body?.phone_number);
    if (!phoneNumber) {
      response.status(400).json({ code: "appointment_phone_required" });
      return;
    }

    const appointment = repositories.appointments.save({
      id: `apt_${nanoid(8)}`,
      customerId: stringField(request.body?.customerId) || null,
      callId: stringField(request.body?.callId) || null,
      callerName: stringField(request.body?.callerName) || stringField(request.body?.name) || "Caller",
      phoneNumber: normalizePhoneDigits(phoneNumber),
      scheduledAt: isoDateOrNull(stringField(request.body?.scheduledAt)),
      preferredTime: stringField(request.body?.preferredTime) || stringField(request.body?.preferred_time),
      reason: stringField(request.body?.reason) || "Insurance follow-up",
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    });

    response.status(201).json(appointment);
  });

  app.patch("/api/appointments/:id", (request, response) => {
    const appointment = repositories.appointments.get(request.params.id);
    if (!appointment) {
      response.status(404).json({ code: "appointment_not_found" });
      return;
    }

    const updated = repositories.appointments.save({
      ...appointment,
      status: appointmentStatusFromInput(stringField(request.body?.status)) ?? appointment.status,
      scheduledAt: isoDateOrNull(stringField(request.body?.scheduledAt)) ?? appointment.scheduledAt,
      preferredTime: stringField(request.body?.preferredTime) || appointment.preferredTime,
      reason: stringField(request.body?.reason) || appointment.reason,
      updatedAt: currentTimestamp(deps.now),
    });

    response.json(updated);
  });

  app.get("/api/transfers", (_request, response) => {
    response.json(repositories.transfers.list());
  });

  app.get("/api/worker/session-config", (request, response) => {
    if (!verifyWorkerRequest(request, deps.workerApiKey)) {
      response.status(401).json({ code: "worker_unauthorized" });
      return;
    }

    const callId = typeof request.query.callId === "string" ? request.query.callId : "";
    const call = repositories.calls.get(callId);
    if (!call) {
      response.status(404).json({ code: "call_not_found" });
      return;
    }

    const agent = repositories.agents.get(call.agentId);
    if (!agent) {
      response.status(404).json({ code: "agent_not_found" });
      return;
    }

    const voice = repositories.voices.get(agent.voiceId);
    const runtimes = repositories.runtimes.list();
    const tools = repositories.tools.list().filter((tool) => agent.toolIds.includes(tool.id));

    response.json({
      call,
      agent,
      voice,
      runtimes,
      tools,
      settings: repositories.settings.get(),
    });
  });

  app.post("/api/worker/calls/:id/events", (request, response) => {
    if (!verifyWorkerRequest(request, deps.workerApiKey)) {
      response.status(401).json({ code: "worker_unauthorized" });
      return;
    }

    const call = repositories.calls.get(request.params.id);
    if (!call) {
      response.status(404).json({ code: "call_not_found" });
      return;
    }

    const rawEvents = Array.isArray(request.body?.events)
      ? (request.body.events as unknown[])
      : [] as unknown[];
    const now = currentTimestamp(deps.now);
    const events = repositories.transaction(() =>
      rawEvents
        .filter((event): event is Record<string, unknown> => isRecord(event))
        .map((event: Record<string, unknown>) => repositories.callEvents.append({
          callId: call.id,
          timestamp: stringField(event.timestamp) || now,
          type: callEventType(event.type) ?? "runtime",
          actor: callEventActor(event.actor) ?? "system",
          payload: isRecord(event.payload) ? event.payload : {},
          severity: callEventSeverity(event.severity) ?? "info",
        })),
    );
    materializeWorkerTranscriptOperations({
      call,
      events,
      repositories,
      now,
    });

    response.status(201).json({ events });
  });

  app.post("/api/worker/calls/:id/tools/:toolName", (request, response) => {
    if (!verifyWorkerRequest(request, deps.workerApiKey)) {
      response.status(401).json({ code: "worker_unauthorized" });
      return;
    }

    const call = repositories.calls.get(request.params.id);
    if (!call) {
      response.status(404).json({ code: "call_not_found" });
      return;
    }

    const toolName = request.params.toolName;
    const input = isRecord(request.body) ? request.body : {};
    const now = currentTimestamp(deps.now);
    const result = executeWorkerBusinessTool({
      toolName,
      input,
      call,
      repositories,
      now,
    });
    if (!result) {
      response.status(404).json({ code: "worker_tool_not_found" });
      return;
    }

    const event = repositories.callEvents.append({
      callId: call.id,
      timestamp: now,
      type: "tool_call",
      actor: "tool",
      payload: {
        toolName,
        input: sanitizeToolInput(input),
        result,
      },
      severity: result.ok ? "info" : "warning",
    });

    response.status(200).json({ result, event });
  });

  app.get("/api/tts/providers", async (_request, response, next) => {
    try {
      response.json(await listTtsProviderStatus(repositories, deps.runtimeHealth));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tts/benchmark", async (request, response, next) => {
    try {
      const providerId = stringField(request.body?.providerId);
      const text = stringField(request.body?.text);

      if (!providerId || !text) {
        response.status(400).json({ code: "invalid_tts_benchmark_request" });
        return;
      }

      const providers = await listTtsProviderStatus(repositories, deps.runtimeHealth);
      const provider = providers.find((candidate) => candidate.id === providerId);

      if (!provider) {
        response.status(404).json({ code: "tts_provider_not_found" });
        return;
      }

      if (provider.healthStatus !== "healthy") {
        response
          .status(409)
          .json(createBenchmarkResult(provider, text, {
            status: "unavailable",
            code: codeForUnavailableProvider(provider.healthStatus),
            now: deps.now,
          }));
        return;
      }

      const ttsAdapter = deps.ttsAdapters?.[provider.adapter] ?? (provider.adapter === "piper" ? deps.tts : null);

      if (!ttsAdapter) {
        response
          .status(409)
          .json(createBenchmarkResult(provider, text, {
            status: "unavailable",
            code: "provider_adapter_not_connected",
            now: deps.now,
          }));
        return;
      }

      if (!provider.voiceId) {
        response
          .status(409)
          .json(createBenchmarkResult(provider, text, {
            status: "unavailable",
            code: "provider_voice_missing",
            now: deps.now,
          }));
        return;
      }

      const startedAt = Date.now();
      const synthesized = await ttsAdapter.synthesize({ text, voicePath: provider.voiceId }).catch(() => null);

      if (!synthesized) {
        response
          .status(502)
          .json(createBenchmarkResult(provider, text, {
            status: "unavailable",
            code: "provider_synthesis_failed",
            now: deps.now,
            latencyMs: Date.now() - startedAt,
          }));
        return;
      }

      response.json(
        createBenchmarkResult(provider, text, {
          status: "generated",
          code: null,
          now: deps.now,
          audioBase64: synthesized.audioBase64,
          mimeType: synthesized.mimeType,
          latencyMs: Date.now() - startedAt,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tts/generate", async (request, response, next) => {
    try {
      const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
      const voiceId = typeof request.body?.voiceId === "string" ? request.body.voiceId : "";

      if (!text || !voiceId) {
        response.status(400).json({ code: "invalid_tts_request" });
        return;
      }

      const voice = repositories.voices.get(voiceId);
      const voiceRuntime = voice
        ? repositories.runtimes.list().find((runtime) => runtime.id === voice.runtimeId)
        : null;
      if (!voice || !voiceRuntime) {
        response.status(404).json({ code: "voice_not_found" });
        return;
      }

      const ttsAdapter = deps.ttsAdapters?.[voiceRuntime.adapter] ?? (voiceRuntime.adapter === "piper" ? deps.tts : null);

      if (!ttsAdapter) {
        response.status(409).json({ code: "runtime_not_configured" });
        return;
      }

      const health = await ttsAdapter.health();
      if (health.status !== "healthy") {
        response.status(409).json({ code: "runtime_not_configured" });
        return;
      }

      const synthesized = await ttsAdapter.synthesize({ text, voicePath: voiceId }).catch(() => null);
      if (!synthesized) {
        response.status(502).json({ code: "tts_synthesis_failed" });
        return;
      }

      const sample = repositories.voiceSamples.append({
        voiceId: voice.id,
        voiceName: voice.name,
        text,
        audioBase64: synthesized.audioBase64,
        mimeType: synthesized.mimeType,
        createdAt: currentTimestamp(deps.now),
      });

      response.json(sample);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/voice-clones", (request, response) => {
    const now = currentTimestamp(deps.now);
    const voiceName = stringField(request.body?.voiceName);
    const language = stringField(request.body?.language) || "en-US";
    const speakerName = stringField(request.body?.speakerName);
    const consentSource = stringField(request.body?.consentSource);
    const auditNotes = stringField(request.body?.auditNotes);

    if (!voiceName || !speakerName || !consentSource) {
      response.status(400).json({ code: "voice_consent_missing" });
      return;
    }

    const runtimeId = repositories.runtimes.list().find((runtime) => runtime.kind === "tts")?.id;
    if (!runtimeId) {
      response.status(409).json({ code: "runtime_not_configured" });
      return;
    }

    const result = repositories.transaction(() => {
      const slug = createSlug(voiceName);
      const voiceId = `voice_clone_${slug || Date.now()}`;
      const consentId = `consent_${slug || Date.now()}`;
      const consent: ConsentRecord = {
        id: consentId,
        voiceId,
        speakerName,
        consentSource,
        capturedAt: now,
        termsVersion: "lipivoice-consent-v1",
        auditNotes,
      };
      const voice = repositories.voices.save({
        id: voiceId,
        name: voiceName,
        runtimeId,
        type: "cloned",
        language,
        tags: ["cloned", "consent-recorded"],
        previewUrl: "",
        privacy: "private",
        cloneStatus: "pending",
        consentId,
      });

      return {
        voice,
        consent: repositories.consentRecords.save(consent),
      };
    });

    response.status(201).json(result);
  });

  app.post("/api/calls/simulate", (request, response) => {
    const agentId = typeof request.body?.agentId === "string" ? request.body.agentId : "";
    const agent = repositories.agents.get(agentId);

    if (!agent) {
      response.status(404).json({ code: "agent_not_found" });
      return;
    }

    const result = repositories.transaction(() => {
      const now = currentTimestamp(deps.now);
      const call = repositories.calls.create({
        channel: "simulation",
        direction: "inbound",
        agentId: agent.id,
        status: "connected",
        startedAt: now,
      });
      const event = repositories.callEvents.append({
        callId: call.id,
        timestamp: now,
        type: "status",
        actor: "system",
        payload: { status: "connected" },
        severity: "info",
      });

      return { call, events: [event] };
    });

    response.status(201).json(result);
  });

  app.post("/api/calls/:id/simulate-turn", async (request, response, next) => {
    try {
      const call = repositories.calls.get(request.params.id);

      if (!call || call.channel !== "simulation") {
        response.status(404).json({ code: "call_not_found" });
        return;
      }

      if (call.endedAt || call.status === "disconnected" || call.status === "failed") {
        response.status(409).json({ code: "call_not_active" });
        return;
      }

      const agent = repositories.agents.get(call.agentId);
      if (!agent) {
        response.status(404).json({ code: "agent_not_found" });
        return;
      }

      const text = stringField(request.body?.text);
      if (!text) {
        response.status(400).json({ code: "invalid_simulated_turn" });
        return;
      }

      const language = stringField(request.body?.language) || "ne";
      const preferredVoiceId = stringField(request.body?.voiceId) || defaultSimulatedVoiceId(language, agent.voiceId);
      const startedAt = Date.now();
      const previousEvents = repositories.callEvents.listForCall(call.id);
      const previousUnsupportedTurns = countUnsupportedUserTurns(
        previousEvents
          .filter((event) => event.type === "transcript" && event.actor === "user")
          .map((event) => (typeof event.payload.text === "string" ? event.payload.text : "")),
      );
      const guardedAssistantText = unsupportedLanguageResponse(text, language, previousUnsupportedTurns);
      const intakeInstruction = unsupportedLanguageIntakeInstructionForTurn(text, language, previousUnsupportedTurns);
      let assistantText = guardedAssistantText;

      if (!assistantText) {
        const selectedLlm = resolveAgentLlm({
          agent,
          repositories,
          llm: deps.llm,
          llmModel: deps.llmModel,
          llmAdapters: deps.llmAdapters,
        });

        if (!selectedLlm) {
          response.status(409).json({ code: "runtime_not_configured" });
          return;
        }

        const messages = transcriptMessages(previousEvents, text);
        assistantText = await selectedLlm.llm.chat({
          model: selectedLlm.model,
          system: [simulatedCallSystemPrompt(agent, language, { repeatedUnsupported: Boolean(intakeInstruction) }), intakeInstruction]
            .filter(Boolean)
            .join("\n\n"),
          messages,
        });

        if (intakeInstruction && repeatsUnsupportedLanguageClarification(assistantText)) {
          assistantText = unsupportedLanguageIntakeFallback;
        }
      }
      const synthesized = await synthesizeSimulatedTurn({
        repositories,
        ttsAdapters: deps.ttsAdapters,
        fallbackTts: deps.tts,
        preferredVoiceId,
        text: assistantText,
        allowFallback: true,
      });
      const latencyMs = Date.now() - startedAt;

      const result = repositories.transaction(() => {
        const now = currentTimestamp(deps.now);
        const events: CallEvent[] = [];

        events.push(
          repositories.callEvents.append({
            callId: call.id,
            timestamp: now,
            type: "status",
            actor: "system",
            payload: { status: "thinking", language, ttsProvider: synthesized.providerId, latencyMs },
            severity: "info",
          }),
        );
        events.push(
          repositories.callEvents.append({
            callId: call.id,
            timestamp: now,
            type: "transcript",
            actor: "user",
            payload: { text },
            severity: "info",
          }),
        );
        events.push(
          repositories.callEvents.append({
            callId: call.id,
            timestamp: now,
            type: "transcript",
            actor: "assistant",
            payload: { text: assistantText },
            severity: "info",
          }),
        );

        if (synthesized.fallbackReason) {
          events.push(
            repositories.callEvents.append({
              callId: call.id,
              timestamp: now,
              type: "runtime",
              actor: "system",
              payload: {
                code: "tts_fallback",
                preferredVoiceId,
                actualVoiceId: synthesized.voiceId,
                reason: synthesized.fallbackReason,
              },
              severity: "warning",
            }),
          );
        }

        if (synthesized.audio) {
          events.push(
            repositories.callEvents.append({
              callId: call.id,
              timestamp: now,
              type: "audio",
              actor: "assistant",
              payload: {
                audioBase64: synthesized.audio.audioBase64,
                mimeType: synthesized.audio.mimeType,
                voiceId: synthesized.voiceId,
                providerId: synthesized.providerId,
              },
              severity: "info",
            }),
          );
        } else {
          events.push(
            repositories.callEvents.append({
              callId: call.id,
              timestamp: now,
              type: "error",
              actor: "system",
              payload: { code: "tts_synthesis_failed", preferredVoiceId },
              severity: "warning",
            }),
          );
        }

        events.push(
          repositories.callEvents.append({
            callId: call.id,
            timestamp: now,
            type: "status",
            actor: "system",
            payload: { status: "connected", latencyMs },
            severity: "info",
          }),
        );

        const updatedCall = repositories.calls.update({
          ...call,
          status: "connected",
          durationSeconds: durationSecondsBetween(call.startedAt, now),
        });

        return { call: updatedCall, events };
      });

      response.json({
        ...result,
        assistantText,
        audio: synthesized.audio,
        voiceId: synthesized.voiceId,
        providerId: synthesized.providerId,
        fallbackReason: synthesized.fallbackReason,
        latencyMs,
      });
    } catch (error) {
      next(error);
    }
  });

  // ─── Policies ──────────────────────────────────────────────────────────────

  app.get("/api/policies", (_request, response) => {
    response.json(repositories.policies.list());
  });

  app.get("/api/policies/:id", (request, response) => {
    const policy = repositories.policies.get(request.params.id);
    if (!policy) { response.status(404).json({ code: "policy_not_found" }); return; }
    response.json(policy);
  });

  app.get("/api/customers/:id/policies", (request, response) => {
    response.json(repositories.policies.listForCustomer(request.params.id));
  });

  app.post("/api/policies", (request, response) => {
    const now = currentTimestamp(deps.now);
    const policy: Policy = {
      id: `pol_${nanoid(10)}`,
      customerId: String(request.body?.customerId ?? ""),
      policyNumber: String(request.body?.policyNumber ?? ""),
      type: request.body?.type ?? "miscellaneous",
      status: request.body?.status ?? "active",
      insuredName: String(request.body?.insuredName ?? ""),
      premium: Number(request.body?.premium ?? 0),
      sumInsured: Number(request.body?.sumInsured ?? 0),
      startDate: String(request.body?.startDate ?? ""),
      endDate: String(request.body?.endDate ?? ""),
      renewalDueDate: request.body?.renewalDueDate ?? null,
      claimCount: Number(request.body?.claimCount ?? 0),
      notes: String(request.body?.notes ?? ""),
      cmsId: null,
      cmsSource: null,
      syncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    response.status(201).json(repositories.policies.save(policy));
  });

  app.patch("/api/policies/:id", (request, response) => {
    const existing = repositories.policies.get(request.params.id);
    if (!existing) { response.status(404).json({ code: "policy_not_found" }); return; }
    const updated = repositories.policies.save({
      ...existing,
      ...request.body,
      id: existing.id,
      updatedAt: currentTimestamp(deps.now),
    });
    response.json(updated);
  });

  // ─── Campaigns ─────────────────────────────────────────────────────────────

  app.get("/api/campaigns", (_request, response) => {
    response.json(repositories.campaigns.list());
  });

  app.get("/api/campaigns/:id", (request, response) => {
    const campaign = repositories.campaigns.get(request.params.id);
    if (!campaign) { response.status(404).json({ code: "campaign_not_found" }); return; }
    response.json(campaign);
  });

  app.get("/api/campaigns/:id/runs", (request, response) => {
    response.json(repositories.campaignRuns.listForCampaign(request.params.id));
  });

  app.post("/api/campaigns", (request, response) => {
    const now = currentTimestamp(deps.now);
    const contacts: CampaignContact[] = Array.isArray(request.body?.contacts) ? request.body.contacts : [];
    const campaign: Campaign = {
      id: `campaign_${nanoid(10)}`,
      name: String(request.body?.name ?? "New Campaign"),
      type: request.body?.type ?? "custom",
      status: "draft",
      agentId: String(request.body?.agentId ?? ""),
      contacts,
      scheduledAt: request.body?.scheduledAt ?? null,
      completedAt: null,
      totalContacts: contacts.length,
      dialedCount: 0,
      answeredCount: 0,
      failedCount: 0,
      notes: String(request.body?.notes ?? ""),
      createdAt: now,
      updatedAt: now,
    };
    response.status(201).json(repositories.campaigns.save(campaign));
  });

  app.patch("/api/campaigns/:id", (request, response) => {
    const existing = repositories.campaigns.get(request.params.id);
    if (!existing) { response.status(404).json({ code: "campaign_not_found" }); return; }
    const updated = repositories.campaigns.save({
      ...existing,
      ...request.body,
      id: existing.id,
      updatedAt: currentTimestamp(deps.now),
    });
    response.json(updated);
  });

  app.post("/api/campaigns/:id/launch", async (request, response, next) => {
    try {
      const campaign = repositories.campaigns.get(request.params.id);
      if (!campaign) { response.status(404).json({ code: "campaign_not_found" }); return; }
      const campaignService = createCampaignService({
        repositories,
        now: deps.now,
        initiateOutboundCall: deps.initiateOutboundCall ?? createDefaultOutboundCallInitiator({
          repositories,
          now: deps.now,
          liveKit: deps.liveKit,
        }),
      });
      const result = await campaignService.launchCampaign(campaign.id);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/campaigns/build-renewal", (request, response) => {
    const agentId = String(request.body?.agentId ?? "");
    const withinDays = Number(request.body?.withinDays ?? 30);
    const agent = repositories.agents.get(agentId);
    if (!agent) { response.status(404).json({ code: "agent_not_found" }); return; }
    const campaignService = createCampaignService({ repositories });
    const campaign = campaignService.buildRenewalCampaign({ agentId, withinDays });
    response.status(201).json(campaign);
  });

  // ─── CMS Sync ──────────────────────────────────────────────────────────────

  app.post("/api/cms/sync", async (request, response, next) => {
    try {
      const body = request.body ?? {};
      const baseUrl = String(body.baseUrl ?? "");
      if (!baseUrl) { response.status(400).json({ code: "base_url_required" }); return; }

      const adapter = createCmsAdapter({
        baseUrl,
        authMode: body.authMode ?? "none",
        authValue: String(body.authValue ?? ""),
        customerEndpoint: String(body.customerEndpoint ?? "/customers"),
        policyEndpoint: String(body.policyEndpoint ?? "/policies"),
      });

      const result = await adapter.syncToRepositories(repositories);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  serveStaticFrontend(app);

  app.use(createErrorMiddleware());

  return {
    app,
    repositories,
    realtimeSessions,
    close() {
      if (closed) {
        return;
      }

      repositories.close();
      closed = true;
    },
  };
}

function serveStaticFrontend(app: express.Express) {
  const staticDir = join(process.cwd(), "dist");
  const indexPath = join(staticDir, "index.html");

  if (!existsSync(indexPath)) {
    return;
  }

  app.use(express.static(staticDir));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(indexPath);
  });
}

function createErrorMiddleware(): ErrorRequestHandler {
  return (error, _request, response, _next) => {
    if (isMalformedJsonError(error)) {
      response.status(400).json({ code: "invalid_json" });
      return;
    }

    response.status(500).json({ code: "internal_error" });
  };
}

function configuredStateFromHealth(health: RuntimeHealthResult): ConfiguredState {
  return health.status === "missing_model" && health.reason === "runtime_not_configured"
    ? "not_configured"
    : "configured";
}

async function listModelRuntimes(repositories: Repositories, runtimeHealth: RuntimeHealthChecks | undefined) {
  return Promise.all(
    repositories.runtimes.list().map(async (runtime) => {
      const checkHealth = runtimeHealth?.[runtime.adapter];
      if (!checkHealth) {
        return runtime;
      }

      const health = await checkHealth();

      return {
        ...runtime,
        configuredState: configuredStateFromHealth(health),
        healthStatus: health.status,
      };
    }),
  );
}

async function listTtsProviderStatus(
  repositories: Repositories,
  runtimeHealth: RuntimeHealthChecks | undefined,
): Promise<TtsProvider[]> {
  const runtimes = repositories.runtimes.list();
  const overlayEntries = await Promise.all(
    Object.entries(runtimeHealth ?? {})
      .map(async ([adapter, checkHealth]) => {
        const health = await checkHealth();
        return [
          adapter,
          {
            configuredState: configuredStateFromHealth(health),
            healthStatus: health.status,
          },
        ] as const;
      }),
  );

  return listTtsProviders({
    runtimes,
    voices: repositories.voices.list(),
    runtimeOverlays: Object.fromEntries(overlayEntries),
  });
}

function createBenchmarkResult(
  provider: TtsProvider,
  text: string,
  options: {
    status: TtsBenchmarkResult["status"];
    code: string | null;
    now?: () => Date;
    audioBase64?: string;
    mimeType?: string;
    latencyMs?: number;
  },
): TtsBenchmarkResult {
  return {
    id: nanoid(),
    providerId: provider.id,
    providerName: provider.name,
    text,
    status: options.status,
    healthStatus: provider.healthStatus,
    code: options.code,
    audioBase64: options.audioBase64 ?? null,
    mimeType: options.mimeType ?? null,
    latencyMs: Math.max(0, options.latencyMs ?? 0),
    createdAt: currentTimestamp(options.now),
  };
}

function codeForUnavailableProvider(status: TtsBenchmarkResult["healthStatus"]) {
  if (status === "license_required") return "license_required";
  if (status === "unavailable") return "provider_unavailable";
  if (status === "failed") return "provider_failed";
  if (status === "unknown") return "provider_not_checked";
  return "provider_not_installed";
}

function transcriptMessages(events: CallEvent[], nextUserText: string) {
  return [
    ...events
      .filter((event) => event.type === "transcript" && (event.actor === "user" || event.actor === "assistant"))
      .map((event) => ({
        role: event.actor as "user" | "assistant",
        content: typeof event.payload.text === "string" ? event.payload.text : "",
      }))
      .filter((message) => message.content.trim().length > 0),
    { role: "user" as const, content: nextUserText },
  ];
}

function simulatedCallSystemPrompt(agent: Agent, language: string, options: { repeatedUnsupported?: boolean } = {}) {
  const wantsNepali = isNepaliLanguage(language);

  if (options.repeatedUnsupported) {
    return [
      "You are Sarita, a warm Nepali front-desk receptionist for Sagarmatha Lumbini Insurance Company Limited.",
      "The caller has already been asked once to use Nepali or English, but the next caller message is still unclear.",
      "Do not repeat the Nepali-or-English clarification.",
      "Do not infer an insurance product from unclear speech or speech recognition noise.",
      "Naturally move to callback or policy intake.",
      "Ask for the caller's name, phone number, and policy number or claim number.",
      wantsNepali
        ? "नेपाली वा natural Nepali-English मा एक वा दुई छोटा वाक्यमा जवाफ देऊ।"
        : "Reply in one or two short natural phone-friendly sentences.",
      "Do not mention that this is a simulation unless the caller asks.",
    ].join("\n");
  }

  return [
    agent.systemPrompt,
    wantsNepali
      ? "यो परीक्षण फोन संवाद हो। नेपालीमा मात्र, देवनागरी लिपिमा, छोटो र प्राकृतिक रूपमा जवाफ देऊ। एक पटकमा एउटा मात्र प्रश्न सोध।"
      : "This is a simulated phone conversation. Reply naturally and concisely. Ask one question at a time.",
    "Do not mention that this is a simulation unless the caller asks.",
  ].join("\n");
}

function defaultSimulatedVoiceId(_language: string, agentVoiceId: string) {
  return agentVoiceId;
}

function isNepaliLanguage(language: string) {
  const normalized = language.trim().toLowerCase();

  return (
    normalized === "ne" ||
    normalized.startsWith("ne-") ||
    normalized === "newari" ||
    normalized === "newar" ||
    normalized === "nepali" ||
    normalized.includes("newari")
  );
}

function createAdminAuthMiddleware(adminToken: string | undefined): express.RequestHandler {
  return (request, response, next) => {
    if (!adminToken || !request.path.startsWith("/api/") || isPublicApiRequest(request)) {
      next();
      return;
    }

    if (bearerToken(request) === adminToken) {
      next();
      return;
    }

    response.status(401).json({ code: "admin_unauthorized" });
  };
}

function isPublicApiRequest(request: express.Request) {
  if (request.method === "OPTIONS") {
    return true;
  }

  return request.path === "/api/health" ||
    request.path === "/api/auth/status" ||
    request.path === "/api/auth/login" ||
    request.path.startsWith("/api/worker/");
}

function bearerToken(request: express.Request) {
  const authorization = request.header("authorization") ?? "";
  const [scheme, token] = authorization.split(/\s+/, 2);

  return scheme?.toLowerCase() === "bearer" ? token ?? "" : "";
}

function createRateLimitMiddleware(now: (() => Date) | undefined): express.RequestHandler {
  const buckets = new Map<string, { count: number; resetAtMs: number }>();
  const currentTime = () => (now?.() ?? new Date()).getTime();

  return (request, response, next) => {
    const policy = rateLimitPolicy(request);
    if (!policy) {
      next();
      return;
    }

    const nowMs = currentTime();
    const key = `${request.ip}:${policy.name}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAtMs <= nowMs) {
      buckets.set(key, { count: 1, resetAtMs: nowMs + policy.windowMs });
      next();
      return;
    }

    if (bucket.count >= policy.max) {
      response.setHeader("Retry-After", String(Math.ceil((bucket.resetAtMs - nowMs) / 1000)));
      response.status(429).json({ code: "rate_limited" });
      return;
    }

    bucket.count += 1;
    next();
  };
}

function rateLimitPolicy(request: express.Request): { name: string; windowMs: number; max: number } | null {
  if (request.method !== "POST") {
    return null;
  }

  if (
    request.path === "/api/livekit/web-call/start" ||
    request.path === "/api/calls/simulate" ||
    request.path === "/api/realtime/session"
  ) {
    return { name: "session-start", windowMs: 60_000, max: 20 };
  }

  if (request.path.endsWith("/simulate-turn") || request.path === "/api/tts/generate") {
    return { name: "speech-generate", windowMs: 60_000, max: 30 };
  }

  if (request.path === "/api/tts/benchmark" || request.path === "/api/model-runtimes/health") {
    return { name: "diagnostics", windowMs: 60_000, max: 20 };
  }

  return null;
}

async function synthesizeSimulatedTurn(input: {
  repositories: Repositories;
  ttsAdapters: Partial<Record<RuntimeAdapter, TtsAdapter>> | undefined;
  fallbackTts?: TtsAdapter | null;
  preferredVoiceId: string;
  text: string;
  allowFallback: boolean;
}) {
  const preferredVoice = input.repositories.voices.get(input.preferredVoiceId);
  const preferred = preferredVoice
    ? await trySynthesizeVoice({
        repositories: input.repositories,
        ttsAdapters: input.ttsAdapters,
        fallbackTts: input.fallbackTts,
        voiceId: preferredVoice.id,
        text: input.text,
      })
    : { audio: null, voiceId: input.preferredVoiceId, providerId: "missing_voice", reason: "voice_not_found" };

  if (preferred.audio || !input.allowFallback) {
    return {
      audio: preferred.audio,
      voiceId: preferred.voiceId,
      providerId: preferred.providerId,
      fallbackReason: preferred.reason,
    };
  }

  const fallbackVoice = input.repositories.voices.get("voice_lipi_ml_ne") ??
    input.repositories.voices.list().find((voice) => voice.language.startsWith("ne") && voice.id !== input.preferredVoiceId);
  if (!fallbackVoice) {
    return {
      audio: null,
      voiceId: preferred.voiceId,
      providerId: preferred.providerId,
      fallbackReason: preferred.reason ?? "tts_synthesis_failed",
    };
  }

  const fallback = await trySynthesizeVoice({
    repositories: input.repositories,
    ttsAdapters: input.ttsAdapters,
    fallbackTts: input.fallbackTts,
    voiceId: fallbackVoice.id,
    text: input.text,
  });

  return {
    audio: fallback.audio,
    voiceId: fallback.audio ? fallback.voiceId : preferred.voiceId,
    providerId: fallback.audio ? fallback.providerId : preferred.providerId,
    fallbackReason: fallback.audio ? preferred.reason ?? "preferred_tts_failed" : fallback.reason ?? preferred.reason,
  };
}

async function trySynthesizeVoice(input: {
  repositories: Repositories;
  ttsAdapters: Partial<Record<RuntimeAdapter, TtsAdapter>> | undefined;
  fallbackTts?: TtsAdapter | null;
  voiceId: string;
  text: string;
}) {
  const voice = input.repositories.voices.get(input.voiceId);
  const runtime = voice ? input.repositories.runtimes.list().find((candidate) => candidate.id === voice.runtimeId) : null;
  const adapter = runtime
    ? input.ttsAdapters?.[runtime.adapter] ?? (runtime.adapter === "piper" ? input.fallbackTts : null)
    : null;

  if (!voice || !runtime || !adapter) {
    return {
      audio: null,
      voiceId: input.voiceId,
      providerId: runtime?.adapter ?? "missing_runtime",
      reason: !voice ? "voice_not_found" : "tts_adapter_not_configured",
    };
  }

  try {
    return {
      audio: await adapter.synthesize({ text: input.text, voicePath: voice.id }),
      voiceId: voice.id,
      providerId: runtime.adapter,
      reason: null,
    };
  } catch (error) {
    console.warn("Simulated call TTS failed", {
      voiceId: voice.id,
      adapter: runtime.adapter,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      audio: null,
      voiceId: voice.id,
      providerId: runtime.adapter,
      reason: "tts_synthesis_failed",
    };
  }
}

function isMalformedJsonError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 400 &&
    "body" in error
  );
}

function verifyWorkerRequest(request: express.Request, workerApiKey: string | undefined): boolean {
  if (!workerApiKey) {
    return false;
  }

  return request.header("x-lipivoice-worker-key") === workerApiKey;
}

function executeWorkerBusinessTool(input: {
  toolName: string;
  input: Record<string, unknown>;
  call: Call;
  repositories: Repositories;
  now: string;
}) {
  const { toolName, repositories, call, now } = input;
  const toolInput = input.input;

  if (toolName === "customer-lookup") {
    const phoneNumber = normalizePhoneDigits(stringField(toolInput.phoneNumber) || stringField(toolInput.phone_number));
    const callerName = stringField(toolInput.name) || stringField(toolInput.callerName) || "Caller";

    if (!phoneNumber) {
      return {
        ok: true,
        found: false,
        message: "Phone number is required before customer lookup.",
      };
    }

    const customer = findOrCreateVoiceCustomer({
      repositories,
      now,
      callId: call.id,
      callerName,
      phoneNumber,
      notes: stringField(toolInput.reason),
    });

    return {
      ok: true,
      found: customer.existed,
      customer: {
        customerId: customer.record.id,
        name: customer.record.name,
        phoneNumber: customer.record.phoneNumber,
        preferredLanguage: customer.record.preferredLanguage,
      },
      message: customer.existed ? "Customer found in LipiVoice records." : "New caller profile created.",
    };
  }

  if (toolName === "schedule-callback" || toolName === "calendar") {
    const callerName = stringField(toolInput.callerName) || stringField(toolInput.name) || "Caller";
    const phoneNumber = normalizePhoneDigits(stringField(toolInput.phoneNumber) || stringField(toolInput.phone_number));
    const preferredTime = stringField(toolInput.preferredTime) || stringField(toolInput.preferred_time) || "next available slot";
    const reason = stringField(toolInput.reason) || "Insurance follow-up";
    const customer = phoneNumber
      ? findOrCreateVoiceCustomer({ repositories, now, callId: call.id, callerName, phoneNumber, notes: reason }).record
      : null;
    const appointment = repositories.appointments.save({
      id: `apt_${nanoid(8)}`,
      customerId: customer?.id ?? null,
      callId: call.id,
      callerName,
      phoneNumber,
      scheduledAt: isoDateOrNull(stringField(toolInput.scheduledAt) || stringField(toolInput.scheduled_at)),
      preferredTime,
      reason,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      status: appointment.status,
      callerName: appointment.callerName,
      phoneNumber: appointment.phoneNumber,
      preferredTime: appointment.preferredTime,
      reason: appointment.reason,
      message: "Callback appointment saved.",
    };
  }

  if (toolName === "transfer-call" || toolName === "transfer") {
    const department = stringField(toolInput.department) || "licensed insurance team";
    const reason = stringField(toolInput.reason) || "Caller requested specialist help";
    const callerName = stringField(toolInput.callerName) || stringField(toolInput.name) || "Caller";
    const phoneNumber = normalizePhoneDigits(stringField(toolInput.phoneNumber) || stringField(toolInput.phone_number));
    const customer = phoneNumber
      ? findOrCreateVoiceCustomer({ repositories, now, callId: call.id, callerName, phoneNumber, notes: reason }).record
      : null;
    const transfer = repositories.transfers.save({
      id: `trn_${nanoid(8)}`,
      customerId: customer?.id ?? null,
      callId: call.id,
      department,
      reason,
      status: "queued",
      warmTransferAvailable: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      transferId: transfer.id,
      customerId: transfer.customerId,
      status: transfer.status,
      department: transfer.department,
      reason: transfer.reason,
      warmTransferAvailable: transfer.warmTransferAvailable,
      message: "Transfer request queued.",
    };
  }

  if (toolName === "create-escalation" || toolName === "escalation") {
    const reason = stringField(toolInput.reason) || "Caller needs supervisor follow-up";
    const urgency = stringField(toolInput.urgency) || "normal";
    const callerName = stringField(toolInput.callerName) || stringField(toolInput.name) || "Caller";
    const phoneNumber = normalizePhoneDigits(stringField(toolInput.phoneNumber) || stringField(toolInput.phone_number));
    const customer = phoneNumber
      ? findOrCreateVoiceCustomer({ repositories, now, callId: call.id, callerName, phoneNumber, notes: reason }).record
      : null;
    const ticket = repositories.tickets.save({
      id: `tkt_${nanoid(8)}`,
      customerId: customer?.id ?? null,
      callId: call.id,
      type: ticketTypeFromInput(stringField(toolInput.type)),
      status: "open",
      priority: ticketPriorityFromInput(urgency),
      subject: stringField(toolInput.subject) || reason.slice(0, 80),
      description: reason,
      source: "voice_call",
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      escalationId: ticket.id,
      ticketId: ticket.id,
      customerId: ticket.customerId,
      status: ticket.status,
      priority: ticket.priority,
      callerName,
      phoneNumber,
      reason,
      message: "Escalation ticket opened for supervisor review.",
    };
  }

  return null;
}

function materializeWorkerTranscriptOperations(input: {
  call: Call;
  events: CallEvent[];
  repositories: Repositories;
  now: string;
}) {
  if (!input.events.some((event) => event.type === "transcript" && event.actor === "user")) {
    return;
  }

  const transcriptText = input.repositories.callEvents
    .listForCall(input.call.id)
    .filter((event) => event.type === "transcript" && event.actor === "user")
    .map((event) => stringField(event.payload.text))
    .filter(Boolean)
    .join("\n");
  const phoneNumber = extractPhoneNumber(transcriptText);
  if (!phoneNumber) {
    return;
  }

  const callerName = extractCallerName(transcriptText);
  const customer = findOrCreateVoiceCustomer({
    repositories: input.repositories,
    now: input.now,
    callId: input.call.id,
    callerName,
    phoneNumber,
    notes: transcriptText,
  }).record;

  if (shouldCreateCallback(transcriptText)) {
    createTranscriptCallback({
      repositories: input.repositories,
      now: input.now,
      call: input.call,
      customer,
      callerName,
      phoneNumber,
      reason: transcriptText,
    });
  }

  if (shouldQueueTransfer(transcriptText)) {
    createTranscriptTransfer({
      repositories: input.repositories,
      now: input.now,
      call: input.call,
      customer,
      reason: transcriptText,
    });
  }

  if (shouldCreateTicket(transcriptText)) {
    createTranscriptTicket({
      repositories: input.repositories,
      now: input.now,
      call: input.call,
      customer,
      reason: transcriptText,
    });
  }
}

function createTranscriptCallback(input: {
  repositories: Repositories;
  now: string;
  call: Call;
  customer: Customer;
  callerName: string;
  phoneNumber: string;
  reason: string;
}) {
  const existing = input.repositories.appointments
    .list()
    .some((appointment) => appointment.callId === input.call.id && appointment.status === "scheduled");
  if (existing) {
    return;
  }

  input.repositories.appointments.save({
    id: `apt_${nanoid(8)}`,
    customerId: input.customer.id,
    callId: input.call.id,
    callerName: input.callerName,
    phoneNumber: input.phoneNumber,
    scheduledAt: null,
    preferredTime: extractPreferredTime(input.reason),
    reason: input.reason,
    status: "scheduled",
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function createTranscriptTransfer(input: {
  repositories: Repositories;
  now: string;
  call: Call;
  customer: Customer;
  reason: string;
}) {
  const existing = input.repositories.transfers
    .list()
    .some((transfer) => transfer.callId === input.call.id && transfer.status === "queued");
  if (existing) {
    return;
  }

  input.repositories.transfers.save({
    id: `trn_${nanoid(8)}`,
    customerId: input.customer.id,
    callId: input.call.id,
    department: inferTransferDepartment(input.reason),
    reason: input.reason,
    status: "queued",
    warmTransferAvailable: false,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function createTranscriptTicket(input: {
  repositories: Repositories;
  now: string;
  call: Call;
  customer: Customer;
  reason: string;
}) {
  const type = inferTicketType(input.reason);
  const existing = input.repositories.tickets
    .list()
    .some((ticket) => ticket.callId === input.call.id && ticket.type === type && ticket.status !== "closed");
  if (existing) {
    return;
  }

  input.repositories.tickets.save({
    id: `tkt_${nanoid(8)}`,
    customerId: input.customer.id,
    callId: input.call.id,
    type,
    status: "open",
    priority: inferTicketPriority(input.reason),
    subject: summarizeTranscriptSubject(input.reason),
    description: input.reason,
    source: "voice_call",
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function extractPhoneNumber(text: string) {
  const normalized = normalizeNepaliDigits(text);
  const match = normalized.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  return match ? normalizePhoneDigits(match[0]) : "";
}

function extractCallerName(text: string) {
  const englishName = text.match(/(?:name|नाम)\s*(?:is|हो|:)?\s*([A-Za-z][A-Za-z .'-]{1,40})/i);
  if (englishName?.[1]) {
    return englishName[1].trim().replace(/[.,।]+$/u, "");
  }

  const nepaliName = text.match(/(?:नाम)\s*([\p{Script=Devanagari} ]{2,50}?)(?:\s+हो|।|$)/u);
  if (nepaliName?.[1]) {
    return nepaliName[1].trim().replace(/[.,।]+$/u, "");
  }

  return "Caller";
}

function shouldCreateCallback(text: string) {
  return hasAny(text, ["callback", "call back", "follow-up", "follow up", "calendar", "appointment", "booking", "सम्पर्क", "कलब्याक"]);
}

function shouldQueueTransfer(text: string) {
  return hasAny(text, ["transfer", "specialist", "department", "agent", "claims team", "underwriter", "handoff", "ट्रान्सफर"]);
}

function shouldCreateTicket(text: string) {
  return hasAny(text, [
    "insurance",
    "insure",
    "quote",
    "new policy",
    "claim",
    "complaint",
    "supervisor",
    "urgent",
    "escalation",
    "escalate",
    "accident",
    "injury",
    "damage",
    "renewal problem",
    "क्लेम",
    "दाबी",
    "गुनासो",
    "सुपरभाइजर",
    "दुर्घटना",
    "क्षति",
    "इन्सुरेन्स",
    "इन्स्योरेन्स",
    "बीमा",
  ]);
}

function inferTicketType(text: string): Ticket["type"] {
  if (hasAny(text, ["claim", "accident", "injury", "damage", "क्लेम", "दाबी", "दुर्घटना", "क्षति"])) {
    return "claim";
  }
  if (hasAny(text, ["complaint", "supervisor", "escalation", "escalate", "गुनासो", "सुपरभाइजर"])) {
    return "complaint";
  }
  if (hasAny(text, ["payment", "billing", "premium", "भुक्तानी"])) {
    return "billing";
  }
  if (hasAny(text, ["callback", "call back", "follow-up", "appointment", "कलब्याक"])) {
    return "callback";
  }
  if (hasAny(text, ["policy", "renewal", "पोलिसी", "नवीकरण"])) {
    return "policy_question";
  }
  if (hasAny(text, ["insurance", "insure", "quote", "new policy", "इन्सुरेन्स", "इन्स्योरेन्स", "बीमा"])) {
    return "policy_question";
  }

  return "other";
}

function inferTicketPriority(text: string): Ticket["priority"] {
  if (hasAny(text, ["urgent", "emergency", "immediately", "right now", "अत्यावश्यक", "तुरुन्त"])) {
    return "urgent";
  }
  if (hasAny(text, ["supervisor", "complaint", "escalation", "escalate", "सुपरभाइजर", "गुनासो"])) {
    return "high";
  }
  return "normal";
}

function inferTransferDepartment(text: string) {
  if (hasAny(text, ["claim", "claims", "क्लेम", "दाबी"])) {
    return "claims";
  }
  if (hasAny(text, ["billing", "payment", "premium", "भुक्तानी"])) {
    return "billing";
  }
  if (hasAny(text, ["policy", "renewal", "पोलिसी", "नवीकरण"])) {
    return "policy servicing";
  }
  return "licensed insurance team";
}

function extractPreferredTime(text: string) {
  if (hasAny(text, ["tomorrow", "भोलि"])) {
    return "tomorrow";
  }
  if (hasAny(text, ["morning", "बिहान"])) {
    return "morning";
  }
  if (hasAny(text, ["afternoon", "दिउँसो"])) {
    return "afternoon";
  }
  return "next available slot";
}

function summarizeTranscriptSubject(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? normalized.slice(0, 77).trimEnd() + "..." : normalized;
}

function hasAny(text: string, needles: string[]) {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function normalizeNepaliDigits(value: string) {
  const digitMap: Record<string, string> = {
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9",
  };

  return value.replace(/[०-९]/g, (digit) => digitMap[digit] ?? digit);
}

function normalizePhoneDigits(value: string) {
  return normalizeNepaliDigits(value).replace(/\D/g, "");
}

function importRenewalRecord(input: {
  record: Record<string, unknown>;
  repositories: Repositories;
  now: string;
}) {
  const phoneNumber = normalizePhoneDigits(stringField(input.record.phoneNumber) || stringField(input.record.phone_number));
  const customerName = stringField(input.record.customerName) || stringField(input.record.name) || "Customer";
  const policyNumber = stringField(input.record.policyNumber) || stringField(input.record.policy_number);

  if (!phoneNumber || !policyNumber) {
    throw new Error("renewal_record_missing_phone_or_policy");
  }

  const existingCustomer = input.repositories.customers.findByPhone(phoneNumber);
  const customer = input.repositories.customers.save({
    id: existingCustomer?.id ?? `cust_${nanoid(8)}`,
    name: customerName,
    phoneNumber,
    email: stringField(input.record.email) || existingCustomer?.email || null,
    address: stringField(input.record.address) || existingCustomer?.address || "",
    preferredLanguage: stringField(input.record.preferredLanguage) || existingCustomer?.preferredLanguage || "ne-NP",
    notes: stringField(input.record.notes) || existingCustomer?.notes || "",
    source: "import",
    createdAt: existingCustomer?.createdAt ?? input.now,
    updatedAt: input.now,
    lastCallId: existingCustomer?.lastCallId ?? null,
  });

  const cmsId = stringField(input.record.cmsId) || stringField(input.record.cms_id) || null;
  const existingPolicy = cmsId
    ? input.repositories.policies.findByCmsId(cmsId)
    : input.repositories.policies.list().find((policy) => policy.policyNumber === policyNumber && policy.customerId === customer.id) ?? null;
  const policy = input.repositories.policies.save({
    id: existingPolicy?.id ?? `pol_${nanoid(10)}`,
    customerId: customer.id,
    policyNumber,
    type: policyTypeFromInput(stringField(input.record.policyType) || stringField(input.record.type)),
    status: policyStatusFromInput(stringField(input.record.status)) ?? "active",
    insuredName: stringField(input.record.insuredName) || customer.name,
    premium: numberField(input.record.premium),
    sumInsured: numberField(input.record.sumInsured),
    startDate: stringField(input.record.startDate),
    endDate: stringField(input.record.endDate) || stringField(input.record.renewalDueDate),
    renewalDueDate: stringField(input.record.renewalDueDate) || stringField(input.record.endDate) || null,
    claimCount: Math.max(0, Math.trunc(numberField(input.record.claimCount))),
    notes: stringField(input.record.policyNotes) || stringField(input.record.notes) || existingPolicy?.notes || "",
    cmsId,
    cmsSource: stringField(input.record.cmsSource) || stringField(input.record.cms_source) || existingPolicy?.cmsSource || "renewal_import",
    syncedAt: input.now,
    createdAt: existingPolicy?.createdAt ?? input.now,
    updatedAt: input.now,
  });

  return { customer, policy };
}

function createDefaultOutboundCallInitiator(input: {
  repositories: Repositories;
  now?: () => Date;
  liveKit?: AppDeps["liveKit"];
}) {
  return async (request: OutboundCallRequest) => {
    const agent = input.repositories.agents.get(request.agentId);
    const to = normalizePhoneDigits(request.contact.phoneNumber);
    if (!agent || !to) {
      return null;
    }

    const now = currentTimestamp(input.now);
    const call = input.repositories.calls.create({
      channel: "phone",
      direction: "outbound",
      agentId: agent.id,
      status: "connected",
      startedAt: now,
    });
    const policy = request.contact.policyId ? input.repositories.policies.get(request.contact.policyId) : null;
    const settings = input.repositories.settings.get();
    const sipSecret = input.repositories.secrets.get(SIP_TRUNK_PASSWORD_SECRET_ID);
    const shouldDialSip = settings.sipTrunk.enabled && Boolean(sipSecret) && Boolean(input.liveKit?.startOutboundSipCall);
    let sipCall: LiveKitOutboundSipCall | null = null;

    if (shouldDialSip) {
      sipCall = await input.liveKit!.startOutboundSipCall!({
        callId: call.id,
        agentId: agent.id,
        toNumber: to,
        fromNumber: settings.sipTrunk.fromNumber,
        contactName: request.contact.name,
        campaignId: request.campaignId,
        campaignRunId: request.campaignRunId,
        contextPromptSuffix: request.contextPromptSuffix,
      });
    }

    input.repositories.callEvents.append({
      callId: call.id,
      timestamp: now,
      type: "status",
      actor: "system",
      payload: {
        status: sipCall ? "outbound_sip_dialing" : "outbound_context_ready",
        to,
        customerId: request.contact.customerId,
        customerName: request.contact.name,
        policyId: request.contact.policyId ?? null,
        policyNumber: policy?.policyNumber ?? request.contact.contextData?.policyNumber ?? null,
        campaignId: request.campaignId,
        campaignRunId: request.campaignRunId,
        contextPromptSuffix: request.contextPromptSuffix,
        suggestedOpening: buildSuggestedRenewalOpening(request.contact, policy),
        dialer: sipCall ? "livekit_sip" : "internal_context_only",
        sip: sipCall,
      },
      severity: "info",
    });

    return { callId: call.id };
  };
}

function buildSuggestedRenewalOpening(contact: CampaignContact, policy: Policy | null) {
  const policyType = policy?.type ?? contact.contextData?.policyType ?? "insurance";
  const policyNumber = policy?.policyNumber ?? contact.contextData?.policyNumber ?? "the policy";
  const renewalDate = policy?.renewalDueDate ?? policy?.endDate ?? contact.contextData?.renewalDate ?? "soon";

  return `Renewal call for ${contact.name}: remind them their ${policyType} policy ${policyNumber} is due for renewal on ${renewalDate}, then ask if they want help renewing.`;
}

function findOrCreateVoiceCustomer(input: {
  repositories: Repositories;
  now: string;
  callId: string;
  callerName: string;
  phoneNumber: string;
  notes?: string;
}): { record: Customer; existed: boolean } {
  const existing = input.repositories.customers.findByPhone(input.phoneNumber);
  if (existing) {
    return {
      existed: true,
      record: input.repositories.customers.save({
        ...existing,
        name: existing.name === "Caller" && input.callerName !== "Caller" ? input.callerName : existing.name,
        notes: mergeNotes(existing.notes, input.notes),
        updatedAt: input.now,
        lastCallId: input.callId,
      }),
    };
  }

  return {
    existed: false,
    record: input.repositories.customers.save({
      id: `cust_${nanoid(8)}`,
      name: input.callerName || "Caller",
      phoneNumber: input.phoneNumber,
      email: null,
      address: "",
      preferredLanguage: "ne-NP",
      notes: input.notes || "",
      source: "voice_call",
      createdAt: input.now,
      updatedAt: input.now,
      lastCallId: input.callId,
    }),
  };
}

function mergeNotes(existingNotes: string, nextNotes: string | undefined) {
  if (!nextNotes) {
    return existingNotes;
  }
  if (!existingNotes) {
    return nextNotes;
  }
  return existingNotes.includes(nextNotes) ? existingNotes : `${existingNotes}\n${nextNotes}`;
}

function isoDateOrNull(value: string) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ticketTypeFromInput(value: string): Ticket["type"] {
  return value === "claim" ||
    value === "policy_question" ||
    value === "billing" ||
    value === "complaint" ||
    value === "callback"
    ? value
    : "other";
}

function policyTypeFromInput(value: string): Policy["type"] {
  return value === "motor" ||
    value === "property" ||
    value === "health" ||
    value === "life" ||
    value === "marine" ||
    value === "engineering" ||
    value === "agriculture" ||
    value === "micro" ||
    value === "miscellaneous"
    ? value
    : "miscellaneous";
}

function policyStatusFromInput(value: string): Policy["status"] | null {
  return value === "active" ||
    value === "expired" ||
    value === "pending" ||
    value === "cancelled" ||
    value === "lapsed"
    ? value
    : null;
}

function ticketStatusFromInput(value: string): Ticket["status"] | null {
  return value === "open" ||
    value === "in_progress" ||
    value === "waiting_customer" ||
    value === "resolved" ||
    value === "closed"
    ? value
    : null;
}

function ticketPriorityFromInput(value: string): Ticket["priority"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("urgent")) {
    return "urgent";
  }
  if (normalized.includes("high")) {
    return "high";
  }
  return "normal";
}

function appointmentStatusFromInput(value: string): Appointment["status"] | null {
  return value === "scheduled" || value === "completed" || value === "cancelled" || value === "missed"
    ? value
    : null;
}

function sanitizeToolInput(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ),
  );
}

function numberField(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function callEventType(value: unknown): CallEvent["type"] | null {
  return value === "status" ||
    value === "transcript" ||
    value === "tool_call" ||
    value === "audio" ||
    value === "runtime" ||
    value === "error"
    ? value
    : null;
}

function callEventActor(value: unknown): CallEvent["actor"] | null {
  return value === "system" || value === "user" || value === "assistant" || value === "tool" ? value : null;
}

function callEventSeverity(value: unknown): CallEvent["severity"] | null {
  return value === "info" || value === "warning" || value === "error" ? value : null;
}

function currentTimestamp(now: (() => Date) | undefined) {
  return (now ? now() : new Date()).toISOString();
}

function sipSecretStatus(repositories: Repositories) {
  const secret = repositories.secrets.get(SIP_TRUNK_PASSWORD_SECRET_ID);
  return {
    configured: Boolean(secret),
    updatedAt: secret?.updatedAt ?? null,
  };
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function durationSecondsBetween(startedAt: string, endedAt: string) {
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();

  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0;
  }

  return Math.max(0, Math.round((ended - started) / 1000));
}

function expireStaleActiveCalls(repositories: Repositories, now: (() => Date) | undefined) {
  const endedAt = currentTimestamp(now);
  const staleThresholdMs = 10 * 60 * 1000;
  const staleDurationSeconds = staleThresholdMs / 1000;

  repositories.calls.list()
    .forEach((call) => {
      if (isStaleActiveCall(call, endedAt, staleThresholdMs)) {
        repositories.calls.update({
          ...call,
          status: "disconnected",
          endedAt,
          durationSeconds: staleDurationSeconds,
          failureReason: call.failureReason ?? "stale_session_expired",
        });
        return;
      }

      if (call.failureReason === "stale_session_expired" && call.durationSeconds > staleDurationSeconds) {
        repositories.calls.update({
          ...call,
          durationSeconds: staleDurationSeconds,
        });
        return;
      }

      if (isAbandonedSimulationCall(call, staleDurationSeconds)) {
        repositories.calls.update({
          ...call,
          durationSeconds: staleDurationSeconds,
          failureReason: call.failureReason ?? "stale_session_expired",
        });
      }
    });
}

function isStaleActiveCall(call: Call, nowIso: string, staleThresholdMs: number) {
  if (call.endedAt || call.status === "disconnected" || call.status === "failed") {
    return false;
  }

  const startedAtMs = new Date(call.startedAt).getTime();
  const nowMs = new Date(nowIso).getTime();

  return Number.isFinite(startedAtMs) && Number.isFinite(nowMs) && nowMs - startedAtMs > staleThresholdMs;
}

function isAbandonedSimulationCall(call: Call, staleDurationSeconds: number) {
  return call.channel === "simulation" &&
    call.status === "disconnected" &&
    call.durationSeconds > staleDurationSeconds &&
    call.costEstimateUsd === 0 &&
    !call.recordingUrl;
}

function isKnowledgeSourceType(value: unknown): value is "text" | "url" | "file" {
  return value === "text" || value === "url" || value === "file";
}

function countTokens(content: string) {
  return content.split(/\s+/).filter(Boolean).length;
}

function createKnowledgeDocumentId(title: string) {
  const slug = createSlug(title);

  return `doc_${slug || Date.now()}`;
}

function createSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function runEval(
  evalDefinition: EvalDefinition,
  agent: Agent,
  deps: AppDeps,
): Promise<Omit<EvalRun, "id">> {
  const startedAt = currentTimestamp(deps.now);
  const responder = deps.evalResponder ?? defaultEvalResponder;
  const caseResults = await Promise.all(
    evalDefinition.cases.map(async (evalCase) => {
      const response = await responder({ agent, evalCase });
      const checkResults = evalCase.checks.map((check) => evaluateCheck(check, response));
      const passed = checkResults.every((checkResult) => checkResult.passed);

      return {
        caseId: evalCase.id,
        input: evalCase.input,
        response,
        passed,
        checkResults,
        recommendation: passed ? null : createEvalRecommendation(checkResults),
      };
    }),
  );
  const totalChecks = caseResults.reduce((count, result) => count + result.checkResults.length, 0);
  const passedChecks = caseResults.reduce(
    (count, result) => count + result.checkResults.filter((checkResult) => checkResult.passed).length,
    0,
  );
  const score = totalChecks === 0 ? 0 : Math.round((passedChecks / totalChecks) * 100);

  return {
    evalId: evalDefinition.id,
    agentId: agent.id,
    status: caseResults.every((result) => result.passed) ? "passed" : "failed",
    score,
    startedAt,
    completedAt: currentTimestamp(deps.now),
    caseResults,
  };
}

async function defaultEvalResponder({ agent, evalCase }: { agent: Agent; evalCase: EvalCase }) {
  return `${agent.greeting}\n${evalCase.input}`;
}

function evaluateCheck(check: EvalCheck, response: string) {
  const normalizedResponse = response.toLowerCase();
  const normalizedValue = check.value.toLowerCase();
  const includesValue = normalizedResponse.includes(normalizedValue);

  return {
    ...check,
    passed: check.type === "includes" ? includesValue : !includesValue,
  };
}

function createEvalRecommendation(checkResults: Array<EvalCheck & { passed: boolean }>) {
  const failed = checkResults.filter((checkResult) => !checkResult.passed);
  const missingIncludes = failed
    .filter((checkResult) => checkResult.type === "includes")
    .map((checkResult) => `"${checkResult.value}"`);
  const forbiddenMatches = failed
    .filter((checkResult) => checkResult.type === "excludes")
    .map((checkResult) => `"${checkResult.value}"`);

  if (missingIncludes.length > 0) {
    return `Add coverage for ${missingIncludes.join(", ")} to the agent prompt or knowledge base.`;
  }

  if (forbiddenMatches.length > 0) {
    return `Avoid responses containing ${forbiddenMatches.join(", ")}.`;
  }

  return "Review the agent prompt and expected checks.";
}

function normalizeSettings(settings: WorkspaceSettings): WorkspaceSettings {
  return {
    ...settings,
    workspaceName: settings.workspaceName.trim(),
    publicBaseUrl: settings.publicBaseUrl.trim(),
    allowedOrigins: Array.from(
      new Set(settings.allowedOrigins.map((origin) => origin.trim()).filter(Boolean)),
    ),
  };
}

function createUsageSummary(repositories: Repositories): UsageSummary {
  const calls = repositories.calls.list();
  const knowledgeBases = repositories.knowledgeBases.list();
  const knowledgeDocuments = knowledgeBases.reduce(
    (count, knowledgeBase) =>
      count + repositories.knowledgeDocuments.listForKnowledgeBase(knowledgeBase.id).length,
    0,
  );
  const activeCalls = calls.filter(
    (call) => !call.endedAt && call.status !== "disconnected" && call.status !== "failed",
  ).length;
  const callMinutes = roundUsageNumber(
    calls.reduce((totalSeconds, call) => totalSeconds + call.durationSeconds, 0) / 60,
  );
  const estimatedCostUsd = roundUsageNumber(
    calls.reduce((totalCost, call) => totalCost + call.costEstimateUsd, 0),
  );

  return {
    agents: repositories.agents.list().length,
    phoneNumbers: repositories.phoneNumbers.list().length,
    callsTotal: calls.length,
    activeCalls,
    callMinutes,
    estimatedCostUsd,
    toolExecutions: repositories.toolExecutions.list().length,
    knowledgeBases: knowledgeBases.length,
    knowledgeDocuments,
  };
}

function roundUsageNumber(value: number) {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
