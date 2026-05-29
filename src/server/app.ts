import cors from "cors";
import express from "express";
import { createDefaultWorkspace } from "@/domain/defaults";
import { agentSchema } from "@/domain/schemas";
import { createDatabase } from "./store/database";
import { createRepositories, type Repositories } from "./store/repositories";
import type { ServerConfig } from "./config";

type WorkspaceSeed = ReturnType<typeof createDefaultWorkspace>;

export function createAppForTest(seed: WorkspaceSeed) {
  const repositories = createRepositories(createDatabase(":memory:"));
  repositories.seedWorkspace(seed);

  return createAppWithRepositories(repositories);
}

export function createApp(config: ServerConfig) {
  const repositories = createRepositories(createDatabase(config.databasePath));
  repositories.seedWorkspace(createDefaultWorkspace());

  return createAppWithRepositories(repositories);
}

function createAppWithRepositories(repositories: Repositories) {
  const app = express();

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

  app.post("/api/calls/simulate", (request, response) => {
    const agentId = typeof request.body?.agentId === "string" ? request.body.agentId : "";
    const agent = repositories.agents.get(agentId);

    if (!agent) {
      response.status(404).json({ code: "agent_not_found" });
      return;
    }

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

    response.status(201).json({ call, events: [event] });
  });

  return app;
}
