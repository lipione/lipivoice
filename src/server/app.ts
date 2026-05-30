import { existsSync } from "node:fs";
import { join } from "node:path";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createDefaultWorkspace, createRemoteWorkspace } from "@/domain/defaults";
import {
  agentSchema,
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  phoneNumberSchema,
  toolSchema,
} from "@/domain/schemas";
import type { ConfiguredState, RuntimeAdapter, UsageSummary } from "@/domain/types";
import { createDatabase } from "./store/database";
import { createRepositories, type Repositories } from "./store/repositories";
import type { ServerConfig } from "./config";
import { LipiMlSttAdapter, LipiMlTtsAdapter } from "./runtimes/lipiMl";
import { OllamaAdapter } from "./runtimes/ollama";
import { OpenAICompatibleAdapter } from "./runtimes/openAiCompatible";
import { PiperAdapter } from "./runtimes/piper";
import { WhisperCppAdapter } from "./runtimes/whisperCpp";
import type { RuntimeHealthResult, TtsAdapter } from "./runtimes/types";
import { createRealtimeSessionStore, type RealtimeSessionStore } from "./realtime/sessionTokens";
import { executeTool } from "./tools/executor";

type WorkspaceSeed = ReturnType<typeof createDefaultWorkspace>;
type RuntimeHealthChecks = Partial<Record<RuntimeAdapter, () => Promise<RuntimeHealthResult>>>;

interface AppDeps {
  tts?: TtsAdapter | null;
  runtimeHealth?: RuntimeHealthChecks;
  realtimeSessions?: RealtimeSessionStore;
  toolFetch?: typeof fetch;
  allowPrivateToolUrls?: boolean;
  now?: () => Date;
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

    return createAppContextWithRepositories(repositories, {
      tts,
      runtimeHealth: {
        vllm: () => vllm.health(),
        faster_whisper: () => stt.health(),
        piper: () => tts.health(),
      },
    });
  }

  const ollama = new OllamaAdapter({ baseUrl: config.ollamaBaseUrl, model: config.ollamaModel });
  const whisper = new WhisperCppAdapter({ binPath: config.whisperCppBin, modelPath: config.whisperModelPath });
  const piper = new PiperAdapter({ binPath: config.piperBin, voicePath: config.piperVoicePath });

  return createAppContextWithRepositories(repositories, {
    tts: piper,
    runtimeHealth: {
      ollama: () => ollama.health(),
      whisper_cpp: () => whisper.health(),
      piper: () => piper.health(),
    },
  });
}

function createWorkspaceFromConfig(config: ServerConfig): WorkspaceSeed {
  if (config.runtimePreset === "remote") {
    return createRemoteWorkspace({
      vllmEndpoint: config.vllmBaseUrl,
      vllmModel: config.vllmModel,
      lipiMlEndpoint: config.lipiMlBaseUrl,
    });
  }

  return createDefaultWorkspace();
}

function createAppContextWithRepositories(repositories: Repositories, deps: AppDeps = {}): AppContext {
  const app = express();
  let closed = false;
  const realtimeSessions = deps.realtimeSessions ?? createRealtimeSessionStore({ now: deps.now });

  app.use(cors());
  app.use(express.json());

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
        allowPrivateUrls: deps.allowPrivateToolUrls,
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

  app.get("/api/model-runtimes", async (_request, response, next) => {
    try {
      const runtimes = await Promise.all(
        repositories.runtimes.list().map(async (runtime) => {
          const checkHealth = deps.runtimeHealth?.[runtime.adapter];
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

      response.json(runtimes);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/realtime/session", (_request, response) => {
    response.status(201).json(realtimeSessions.createSession());
  });

  app.get("/api/usage", (_request, response) => {
    response.json(createUsageSummary(repositories));
  });

  app.get("/api/calls", (_request, response) => {
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

    const result = repositories.transaction(() => {
      const now = currentTimestamp(deps.now);
      const updatedCall = repositories.calls.update({
        ...call,
        status: "disconnected",
        endedAt: now,
        durationSeconds: durationSecondsBetween(call.startedAt, now),
      });
      const event = repositories.callEvents.append({
        callId: call.id,
        timestamp: now,
        type: "status",
        actor: "system",
        payload: { status: "disconnected" },
        severity: "info",
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
      if (!voice || voiceRuntime?.adapter !== "piper") {
        response.status(404).json({ code: "voice_not_found" });
        return;
      }

      if (!deps.tts) {
        response.status(409).json({ code: "runtime_not_configured" });
        return;
      }

      const health = await deps.tts.health();
      if (health.status !== "healthy") {
        response.status(409).json({ code: "runtime_not_configured" });
        return;
      }

      response.json(await deps.tts.synthesize({ text, voicePath: voiceId }));
    } catch (error) {
      next(error);
    }
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

function currentTimestamp(now: (() => Date) | undefined) {
  return (now ? now() : new Date()).toISOString();
}

function durationSecondsBetween(startedAt: string, endedAt: string) {
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();

  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0;
  }

  return Math.max(0, Math.round((ended - started) / 1000));
}

function isKnowledgeSourceType(value: unknown): value is "text" | "url" | "file" {
  return value === "text" || value === "url" || value === "file";
}

function countTokens(content: string) {
  return content.split(/\s+/).filter(Boolean).length;
}

function createKnowledgeDocumentId(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `doc_${slug || Date.now()}`;
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
