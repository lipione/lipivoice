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

    CREATE TABLE IF NOT EXISTS voice_samples (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      voice_id TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS phone_numbers (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      call_id TEXT,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      call_id TEXT,
      scheduled_at TEXT,
      status TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      call_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      knowledge_base_id TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evals (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      eval_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS voice_samples_created_idx
      ON voice_samples (created_at);

    CREATE INDEX IF NOT EXISTS consent_records_voice_idx
      ON consent_records (voice_id);

    CREATE INDEX IF NOT EXISTS customers_phone_idx
      ON customers (phone);

    CREATE INDEX IF NOT EXISTS tickets_status_updated_idx
      ON tickets (status, updated_at);

    CREATE INDEX IF NOT EXISTS tickets_call_idx
      ON tickets (call_id);

    CREATE INDEX IF NOT EXISTS appointments_status_scheduled_idx
      ON appointments (status, scheduled_at);

    CREATE INDEX IF NOT EXISTS appointments_call_idx
      ON appointments (call_id);

    CREATE INDEX IF NOT EXISTS transfers_status_created_idx
      ON transfers (status, created_at);

    CREATE INDEX IF NOT EXISTS transfers_call_idx
      ON transfers (call_id);

    CREATE INDEX IF NOT EXISTS knowledge_documents_base_idx
      ON knowledge_documents (knowledge_base_id);

    CREATE INDEX IF NOT EXISTS eval_runs_eval_started_idx
      ON eval_runs (eval_id, started_at);

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      status TEXT NOT NULL,
      end_date TEXT NOT NULL,
      cms_id TEXT,
      data TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS policies_customer_idx
      ON policies (customer_id);

    CREATE INDEX IF NOT EXISTS policies_status_end_idx
      ON policies (status, end_date);

    CREATE INDEX IF NOT EXISTS policies_cms_idx
      ON policies (cms_id);

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      type TEXT NOT NULL,
      scheduled_at TEXT,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS campaigns_status_scheduled_idx
      ON campaigns (status, scheduled_at);

    CREATE TABLE IF NOT EXISTS campaign_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS campaign_runs_campaign_status_idx
      ON campaign_runs (campaign_id, status);

    CREATE INDEX IF NOT EXISTS campaign_runs_customer_idx
      ON campaign_runs (customer_id);
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
