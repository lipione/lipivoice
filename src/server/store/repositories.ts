import { nanoid } from "nanoid";
import type { createDefaultWorkspace } from "@/domain/defaults";
import {
  agentSchema,
  callEventSchema,
  callSchema,
  modelAssetSchema,
  modelRuntimeSchema,
  toolSchema,
  voiceSchema,
} from "@/domain/schemas";
import type {
  Agent,
  Call,
  CallEvent,
  ModelRuntime,
  Tool,
} from "@/domain/types";
import type { DatabaseConnection } from "./database";

type TableName =
  | "agents"
  | "model_runtimes"
  | "model_assets"
  | "voices"
  | "tools"
  | "calls";

type StoredRow = {
  data: string;
};

export interface Repositories {
  agents: {
    list(): Agent[];
    get(id: string): Agent | null;
    save(agent: Agent): Agent;
  };
  runtimes: {
    list(): ModelRuntime[];
    save(runtime: ModelRuntime): ModelRuntime;
  };
  calls: {
    list(): Call[];
    get(id: string): Call | null;
    create(input: Pick<Call, "channel" | "direction" | "agentId" | "status" | "startedAt">): Call;
    update(call: Call): Call;
  };
  callEvents: {
    append(input: Omit<CallEvent, "id">): CallEvent;
    listForCall(callId: string): CallEvent[];
  };
  seedWorkspace(seed: ReturnType<typeof createDefaultWorkspace>): void;
  close(): void;
}

export function createRepositories(db: DatabaseConnection): Repositories {
  const agents = createJsonRepository(db, "agents", agentSchema.parse);
  const runtimes = createJsonRepository(db, "model_runtimes", modelRuntimeSchema.parse);
  const modelAssets = createJsonRepository(db, "model_assets", modelAssetSchema.parse);
  const voices = createJsonRepository(db, "voices", voiceSchema.parse);
  const tools = createJsonRepository(db, "tools", toolSchema.parse);
  const calls = createJsonRepository(db, "calls", callSchema.parse);

  return {
    agents: {
      list: agents.list,
      get: agents.get,
      save: agents.save,
    },
    runtimes: {
      list: runtimes.list,
      save: runtimes.save,
    },
    calls: {
      list: calls.list,
      get: calls.get,
      create(input) {
        const call: Call = {
          id: nanoid(),
          ...input,
          endedAt: null,
          durationSeconds: 0,
          costEstimateUsd: 0,
          recordingUrl: null,
          failureReason: null,
        };

        return calls.save(call);
      },
      update: calls.save,
    },
    callEvents: {
      append(input) {
        const event = callEventSchema.parse({
          id: nanoid(),
          ...input,
        });

        db.prepare(
          "INSERT INTO call_events (id, call_id, timestamp, data) VALUES (?, ?, ?, ?)",
        ).run(event.id, event.callId, event.timestamp, JSON.stringify(event));

        return event;
      },
      listForCall(callId) {
        return db
          .prepare("SELECT data FROM call_events WHERE call_id = ? ORDER BY timestamp ASC, id ASC")
          .all(callId)
          .map((row) => callEventSchema.parse(JSON.parse((row as StoredRow).data)));
      },
    },
    seedWorkspace(seed) {
      const transaction = db.transaction(() => {
        seed.agents.forEach(agents.insertMissing);
        seed.modelRuntimes.forEach(runtimes.insertMissing);
        seed.modelAssets.forEach(modelAssets.insertMissing);
        seed.voices.forEach(voices.insertMissing);
        const seedWithTools = seed as ReturnType<typeof createDefaultWorkspace> & { tools?: Tool[] };
        seedWithTools.tools?.forEach(tools.insertMissing);
      });

      transaction();
    },
    close() {
      db.close();
    },
  };
}

function createJsonRepository<T extends { id: string }>(
  db: DatabaseConnection,
  tableName: TableName,
  parse: (input: unknown) => T,
) {
  return {
    list(): T[] {
      return db
        .prepare(`SELECT data FROM ${tableName} ORDER BY id ASC`)
        .all()
        .map((row) => parse(JSON.parse((row as StoredRow).data)));
    },
    get(id: string): T | null {
      const row = db.prepare(`SELECT data FROM ${tableName} WHERE id = ?`).get(id) as
        | StoredRow
        | undefined;

      return row ? parse(JSON.parse(row.data)) : null;
    },
    save(record: T): T {
      const parsed = parse(record);
      db.prepare(`
        INSERT INTO ${tableName} (id, data)
        VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data
      `).run(parsed.id, JSON.stringify(parsed));
      return parsed;
    },
    insertMissing(record: T): T {
      const parsed = parse(record);
      db.prepare(`INSERT OR IGNORE INTO ${tableName} (id, data) VALUES (?, ?)`).run(
        parsed.id,
        JSON.stringify(parsed),
      );
      return parsed;
    },
  };
}
