import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createDefaultWorkspace } from "@/domain/defaults";
import { agentSchema } from "@/domain/schemas";
import { createDatabase } from "./store/database";
import { createRepositories, type Repositories } from "./store/repositories";
import type { ServerConfig } from "./config";
import { PiperAdapter } from "./runtimes/piper";
import type { TtsAdapter } from "./runtimes/types";

type WorkspaceSeed = ReturnType<typeof createDefaultWorkspace>;

interface AppDeps {
  tts?: TtsAdapter | null;
}

export interface AppContext {
  app: express.Express;
  repositories: Repositories;
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
  repositories.seedWorkspace(createDefaultWorkspace());

  return createAppContextWithRepositories(repositories, {
    tts: new PiperAdapter({ binPath: config.piperBin, voicePath: config.piperVoicePath }),
  });
}

function createAppContextWithRepositories(repositories: Repositories, deps: AppDeps = {}): AppContext {
  const app = express();
  let closed = false;

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

  app.get("/api/model-runtimes", (_request, response) => {
    response.json(repositories.runtimes.list());
  });

  app.get("/api/calls", (_request, response) => {
    response.json(repositories.calls.list());
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
      const now = new Date().toISOString();
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

  app.use(createErrorMiddleware());

  return {
    app,
    repositories,
    close() {
      if (closed) {
        return;
      }

      repositories.close();
      closed = true;
    },
  };
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
