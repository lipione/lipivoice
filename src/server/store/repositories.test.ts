import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultWorkspace } from "@/domain/defaults";
import { createDatabase } from "./database";
import { createRepositories, type Repositories } from "./repositories";

let repos: Repositories;

beforeEach(() => {
  const db = createDatabase(":memory:");
  repos = createRepositories(db);
  repos.seedWorkspace(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));
});

afterEach(() => {
  repos.close();
});

describe("repositories", () => {
  it("creates parent directories for file databases", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lipivoice-store-"));
    const filename = path.join(tempDir, "nested", "data", "lipivoice.sqlite");
    const db = createDatabase(filename);

    try {
      const fileRepos = createRepositories(db);
      fileRepos.seedWorkspace(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

      expect(fileRepos.agents.list()).toHaveLength(1);
      fileRepos.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists and updates an agent", () => {
    const agent = repos.agents.list()[0];
    repos.agents.save({ ...agent, name: "Updated Agent" });

    expect(repos.agents.get(agent.id)?.name).toBe("Updated Agent");
  });

  it("preserves existing records when seeding defaults again", () => {
    const agent = repos.agents.list()[0];
    repos.agents.save({ ...agent, name: "Locally Edited Agent" });

    repos.seedWorkspace(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    expect(repos.agents.get(agent.id)?.name).toBe("Locally Edited Agent");
  });

  it("persists call events in timestamp order", () => {
    const agent = repos.agents.list()[0];
    const call = repos.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: agent.id,
      status: "connecting",
      startedAt: "2026-05-29T00:00:01.000Z",
    });

    repos.callEvents.append({
      callId: call.id,
      timestamp: "2026-05-29T00:00:03.000Z",
      type: "status",
      actor: "system",
      payload: { status: "speaking" },
      severity: "info",
    });
    repos.callEvents.append({
      callId: call.id,
      timestamp: "2026-05-29T00:00:02.000Z",
      type: "transcript",
      actor: "user",
      payload: { text: "hello" },
      severity: "info",
    });

    expect(repos.callEvents.listForCall(call.id).map((event) => event.timestamp)).toEqual([
      "2026-05-29T00:00:02.000Z",
      "2026-05-29T00:00:03.000Z",
    ]);
  });

  it("rejects call events for missing calls", () => {
    expect(() =>
      repos.callEvents.append({
        callId: "missing_call",
        timestamp: "2026-05-29T00:00:02.000Z",
        type: "status",
        actor: "system",
        payload: { status: "failed" },
        severity: "error",
      }),
    ).toThrow();
  });
});
