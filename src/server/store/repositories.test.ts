import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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
    const fileRepos = createRepositories(db);

    try {
      fileRepos.seedWorkspace(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

      expect(fileRepos.agents.list()).toHaveLength(1);
    } finally {
      fileRepos.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("migrates old call event tables to include a call foreign key", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lipivoice-store-"));
    const filename = path.join(tempDir, "lipivoice.sqlite");
    const oldDb = new Database(filename);

    oldDb.exec(`
      CREATE TABLE calls (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE call_events (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );

      INSERT INTO calls (id, data)
      VALUES ('call_existing', '{"id":"call_existing"}');

      INSERT INTO call_events (id, call_id, timestamp, data)
      VALUES
        ('event_existing', 'call_existing', '2026-05-29T00:00:02.000Z', '{"id":"event_existing"}'),
        ('event_orphan', 'missing_call', '2026-05-29T00:00:03.000Z', '{"id":"event_orphan"}');
    `);
    oldDb.close();

    const migratedDb = createDatabase(filename);

    try {
      const foreignKeys = migratedDb
        .prepare("PRAGMA foreign_key_list(call_events)")
        .all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
      const eventCount = migratedDb
        .prepare("SELECT COUNT(*) AS count FROM call_events")
        .get() as { count: number };

      expect(foreignKeys).toContainEqual(expect.objectContaining({
        from: "call_id",
        on_delete: "CASCADE",
        table: "calls",
        to: "id",
      }));
      expect(eventCount.count).toBe(1);
    } finally {
      migratedDb.close();
    }

    const reopenedDb = createDatabase(filename);

    try {
      const foreignKeys = reopenedDb
        .prepare("PRAGMA foreign_key_list(call_events)")
        .all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
      const eventCount = reopenedDb
        .prepare("SELECT COUNT(*) AS count FROM call_events")
        .get() as { count: number };

      expect(foreignKeys).toContainEqual(expect.objectContaining({
        from: "call_id",
        on_delete: "CASCADE",
        table: "calls",
        to: "id",
      }));
      expect(eventCount.count).toBe(1);
    } finally {
      reopenedDb.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rebuilds call event tables with non-cascade call foreign keys", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lipivoice-store-"));
    const filename = path.join(tempDir, "lipivoice.sqlite");
    const oldDb = new Database(filename);

    oldDb.exec(`
      CREATE TABLE calls (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE call_events (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (call_id) REFERENCES calls(id)
      );

      INSERT INTO calls (id, data)
      VALUES ('call_existing', '{"id":"call_existing"}');

      INSERT INTO call_events (id, call_id, timestamp, data)
      VALUES ('event_existing', 'call_existing', '2026-05-29T00:00:02.000Z', '{"id":"event_existing"}');
    `);
    oldDb.close();

    const migratedDb = createDatabase(filename);

    try {
      const foreignKeys = migratedDb
        .prepare("PRAGMA foreign_key_list(call_events)")
        .all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
      const eventCount = migratedDb
        .prepare("SELECT COUNT(*) AS count FROM call_events")
        .get() as { count: number };

      expect(foreignKeys).toContainEqual(expect.objectContaining({
        from: "call_id",
        on_delete: "CASCADE",
        table: "calls",
        to: "id",
      }));
      expect(eventCount.count).toBe(1);
    } finally {
      migratedDb.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists and updates an agent", () => {
    const agent = repos.agents.list()[0];
    repos.agents.save({ ...agent, name: "Updated Agent" });

    expect(repos.agents.get(agent.id)?.name).toBe("Updated Agent");
  });

  it("persists phone number routing", () => {
    const seededNumber = repos.phoneNumbers.list()[0];

    repos.phoneNumbers.save({
      ...seededNumber,
      label: "Support line",
      agentId: null,
      outboundEnabled: true,
    });

    expect(repos.phoneNumbers.get(seededNumber.id)).toMatchObject({
      label: "Support line",
      agentId: null,
      outboundEnabled: true,
    });
  });

  it("persists knowledge documents and searches snippets", () => {
    const knowledgeBase = repos.knowledgeBases.list()[0];

    repos.knowledgeDocuments.save({
      id: "doc_shipping",
      knowledgeBaseId: knowledgeBase.id,
      title: "Shipping policy",
      sourceType: "text",
      content: "Orders ship within two business days after payment clears.",
      tokenCount: 9,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    });

    const results = repos.knowledgeDocuments.search(knowledgeBase.id, "when do orders ship");

    expect(repos.knowledgeDocuments.listForKnowledgeBase(knowledgeBase.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "doc_shipping" })]),
    );
    expect(results[0]).toMatchObject({
      documentId: "doc_shipping",
      title: "Shipping policy",
    });
    expect(results[0]?.snippet).toContain("Orders ship");
  });

  it("persists eval definitions and run history newest-first", () => {
    const agent = repos.agents.list()[0];
    const definition = repos.evals.save({
      id: "eval_greeting",
      name: "Greeting check",
      description: "Validates greeting content.",
      agentId: agent.id,
      cases: [
        {
          id: "case_hello",
          input: "Say hello.",
          checks: [{ type: "includes", value: "LipiVoice" }],
        },
      ],
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    });

    repos.evalRuns.append({
      evalId: definition.id,
      agentId: agent.id,
      status: "failed",
      score: 0,
      startedAt: "2026-05-31T00:00:01.000Z",
      completedAt: "2026-05-31T00:00:01.000Z",
      caseResults: [],
    });
    repos.evalRuns.append({
      evalId: definition.id,
      agentId: agent.id,
      status: "passed",
      score: 100,
      startedAt: "2026-05-31T00:00:03.000Z",
      completedAt: "2026-05-31T00:00:03.000Z",
      caseResults: [],
    });

    expect(repos.evals.get("eval_greeting")?.name).toBe("Greeting check");
    expect(repos.evalRuns.list().map((run) => run.status)).toEqual(["passed", "failed"]);
    expect(repos.evalRuns.listForEval(definition.id)).toHaveLength(2);
  });

  it("persists workspace settings", () => {
    const settings = repos.settings.get();

    repos.settings.save({
      ...settings,
      workspaceName: "Production",
      allowPrivateToolUrls: true,
      recordingRetentionDays: 14,
      updatedAt: "2026-05-31T00:00:00.000Z",
    });

    expect(repos.settings.get()).toMatchObject({
      workspaceName: "Production",
      allowPrivateToolUrls: true,
      recordingRetentionDays: 14,
    });
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

  it("persists phone call number references", () => {
    const agent = repos.agents.list()[0];
    const phoneNumber = repos.phoneNumbers.list()[0];

    const call = repos.calls.create({
      channel: "phone",
      direction: "inbound",
      agentId: agent.id,
      phoneNumberId: phoneNumber.id,
      status: "connected",
      startedAt: "2026-05-31T00:00:00.000Z",
    });

    expect(repos.calls.get(call.id)).toMatchObject({
      channel: "phone",
      phoneNumberId: phoneNumber.id,
    });
  });

  it("keeps call events when updating a call", () => {
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
      timestamp: "2026-05-29T00:00:02.000Z",
      type: "status",
      actor: "system",
      payload: { status: "connecting" },
      severity: "info",
    });
    repos.calls.update({ ...call, status: "connected" });

    expect(repos.callEvents.listForCall(call.id)).toHaveLength(1);
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

  it("persists tool execution logs in newest-first order", () => {
    repos.toolExecutions.append({
      toolId: "tool_order_lookup",
      toolName: "Order lookup",
      timestamp: "2026-05-31T00:00:01.000Z",
      ok: true,
      status: 200,
      attempts: 1,
      durationMs: 12,
      error: null,
      request: {
        method: "GET",
        url: "https://example.com/orders/A123",
        headers: [],
      },
      response: { body: "{\"ok\":true}" },
    });
    repos.toolExecutions.append({
      toolId: "tool_order_lookup",
      toolName: "Order lookup",
      timestamp: "2026-05-31T00:00:03.000Z",
      ok: false,
      status: 0,
      attempts: 1,
      durationMs: 50,
      error: "tool_timeout",
      request: {
        method: "GET",
        url: "https://example.com/orders/A124",
        headers: [],
      },
      response: { body: "tool_timeout" },
    });

    expect(repos.toolExecutions.list().map((log) => log.error)).toEqual(["tool_timeout", null]);
    expect(repos.toolExecutions.listForTool("tool_order_lookup")).toHaveLength(2);
  });

  it("rolls back transaction writes when an operation fails", () => {
    const agent = repos.agents.list()[0];

    expect(() =>
      repos.transaction(() => {
        repos.calls.create({
          channel: "simulation",
          direction: "inbound",
          agentId: agent.id,
          status: "connected",
          startedAt: "2026-05-29T00:00:01.000Z",
        });

        throw new Error("fail after call");
      }),
    ).toThrow("fail after call");

    expect(repos.calls.list()).toHaveLength(0);
  });
});
