import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type DatabaseConnection = Database.Database;

export function createDatabase(filename: string): DatabaseConnection {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  ensureCallEventsForeignKey(db);
  return db;
}

function runMigrations(db: DatabaseConnection): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_runtimes (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_assets (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voices (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_execution_logs (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_events (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS call_events_call_id_timestamp_idx
      ON call_events (call_id, timestamp);

    CREATE INDEX IF NOT EXISTS tool_execution_logs_tool_id_timestamp_idx
      ON tool_execution_logs (tool_id, timestamp);
  `);
}

function ensureCallEventsForeignKey(db: DatabaseConnection): void {
  const foreignKeys = db.prepare("PRAGMA foreign_key_list(call_events)").all() as Array<{
    from: string;
    on_delete: string;
    table: string;
    to: string;
  }>;

  const hasCallForeignKey = foreignKeys.some(
    (foreignKey) =>
      foreignKey.from === "call_id" &&
      foreignKey.on_delete === "CASCADE" &&
      foreignKey.table === "calls" &&
      foreignKey.to === "id",
  );

  if (hasCallForeignKey) {
    return;
  }

  const rebuildCallEvents = db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS call_events_new;

      CREATE TABLE call_events_new (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
      );

      INSERT INTO call_events_new (id, call_id, timestamp, data)
      SELECT call_events.id, call_events.call_id, call_events.timestamp, call_events.data
      FROM call_events
      WHERE EXISTS (
        SELECT 1
        FROM calls
        WHERE calls.id = call_events.call_id
      );

      DROP TABLE call_events;
      ALTER TABLE call_events_new RENAME TO call_events;

      CREATE INDEX IF NOT EXISTS call_events_call_id_timestamp_idx
        ON call_events (call_id, timestamp);
    `);
  });

  rebuildCallEvents();
}
