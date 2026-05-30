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
