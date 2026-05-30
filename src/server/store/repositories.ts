import { nanoid } from "nanoid";
import type { createDefaultWorkspace } from "@/domain/defaults";
import {
  agentSchema,
  callEventSchema,
  callSchema,
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  knowledgeSearchResultSchema,
  modelAssetSchema,
  modelRuntimeSchema,
  phoneNumberSchema,
  toolExecutionLogSchema,
  toolSchema,
  voiceSchema,
} from "@/domain/schemas";
import type {
  Agent,
  Call,
  CallEvent,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeSearchResult,
  ModelRuntime,
  PhoneNumber,
  Tool,
  ToolExecutionLog,
  Voice,
} from "@/domain/types";
import type { DatabaseConnection } from "./database";

type TableName =
  | "agents"
  | "model_runtimes"
  | "model_assets"
  | "voices"
  | "tools"
  | "phone_numbers"
  | "knowledge_bases"
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
  voices: {
    list(): Voice[];
    get(id: string): Voice | null;
  };
  tools: {
    list(): Tool[];
    get(id: string): Tool | null;
    save(tool: Tool): Tool;
  };
  phoneNumbers: {
    list(): PhoneNumber[];
    get(id: string): PhoneNumber | null;
    save(phoneNumber: PhoneNumber): PhoneNumber;
  };
  knowledgeBases: {
    list(): KnowledgeBase[];
    get(id: string): KnowledgeBase | null;
    save(knowledgeBase: KnowledgeBase): KnowledgeBase;
  };
  knowledgeDocuments: {
    save(document: KnowledgeDocument): KnowledgeDocument;
    listForKnowledgeBase(knowledgeBaseId: string): KnowledgeDocument[];
    search(knowledgeBaseId: string, query: string): KnowledgeSearchResult[];
  };
  toolExecutions: {
    append(input: Omit<ToolExecutionLog, "id">): ToolExecutionLog;
    list(): ToolExecutionLog[];
    listForTool(toolId: string): ToolExecutionLog[];
  };
  calls: {
    list(): Call[];
    get(id: string): Call | null;
    create(input: Pick<Call, "channel" | "direction" | "agentId" | "status" | "startedAt"> & {
      phoneNumberId?: string | null;
    }): Call;
    update(call: Call): Call;
  };
  callEvents: {
    append(input: Omit<CallEvent, "id">): CallEvent;
    listForCall(callId: string): CallEvent[];
  };
  transaction<T>(fn: () => T): T;
  seedWorkspace(seed: ReturnType<typeof createDefaultWorkspace>): void;
  close(): void;
}

export function createRepositories(db: DatabaseConnection): Repositories {
  const agents = createJsonRepository(db, "agents", agentSchema.parse);
  const runtimes = createJsonRepository(db, "model_runtimes", modelRuntimeSchema.parse);
  const modelAssets = createJsonRepository(db, "model_assets", modelAssetSchema.parse);
  const voices = createJsonRepository(db, "voices", voiceSchema.parse);
  const tools = createJsonRepository(db, "tools", toolSchema.parse);
  const phoneNumbers = createJsonRepository(db, "phone_numbers", phoneNumberSchema.parse);
  const knowledgeBases = createJsonRepository(db, "knowledge_bases", knowledgeBaseSchema.parse);
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
    voices: {
      list: voices.list,
      get: voices.get,
    },
    tools: {
      list: tools.list,
      get: tools.get,
      save: tools.save,
    },
    phoneNumbers: {
      list: phoneNumbers.list,
      get: phoneNumbers.get,
      save: phoneNumbers.save,
    },
    knowledgeBases: {
      list: knowledgeBases.list,
      get: knowledgeBases.get,
      save: knowledgeBases.save,
    },
    knowledgeDocuments: {
      save(document) {
        const parsed = knowledgeDocumentSchema.parse(document);
        db.prepare(`
          INSERT INTO knowledge_documents (id, knowledge_base_id, data)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            knowledge_base_id = excluded.knowledge_base_id,
            data = excluded.data
        `).run(parsed.id, parsed.knowledgeBaseId, JSON.stringify(parsed));
        return parsed;
      },
      listForKnowledgeBase(knowledgeBaseId) {
        return db
          .prepare("SELECT data FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY id ASC")
          .all(knowledgeBaseId)
          .map((row) => knowledgeDocumentSchema.parse(JSON.parse((row as StoredRow).data)));
      },
      search(knowledgeBaseId, query) {
        const terms = tokenizeQuery(query);
        if (terms.length === 0) {
          return [];
        }

        return db
          .prepare("SELECT data FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY id ASC")
          .all(knowledgeBaseId)
          .map((row) => knowledgeDocumentSchema.parse(JSON.parse((row as StoredRow).data)))
          .map((document) => scoreDocument(document, terms))
          .filter((result): result is KnowledgeSearchResult => result !== null)
          .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
          .map((result) => knowledgeSearchResultSchema.parse(result));
      },
    },
    toolExecutions: {
      append(input) {
        const log = toolExecutionLogSchema.parse({
          id: nanoid(),
          ...input,
        });

        db.prepare(
          "INSERT INTO tool_execution_logs (id, tool_id, timestamp, data) VALUES (?, ?, ?, ?)",
        ).run(log.id, log.toolId, log.timestamp, JSON.stringify(log));

        return log;
      },
      list() {
        return db
          .prepare("SELECT data FROM tool_execution_logs ORDER BY timestamp DESC, id DESC")
          .all()
          .map((row) => toolExecutionLogSchema.parse(JSON.parse((row as StoredRow).data)));
      },
      listForTool(toolId) {
        return db
          .prepare("SELECT data FROM tool_execution_logs WHERE tool_id = ? ORDER BY timestamp DESC, id DESC")
          .all(toolId)
          .map((row) => toolExecutionLogSchema.parse(JSON.parse((row as StoredRow).data)));
      },
    },
    calls: {
      list: calls.list,
      get: calls.get,
      create(input) {
        const call: Call = {
          id: nanoid(),
          ...input,
          phoneNumberId: input.phoneNumberId ?? null,
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
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
    seedWorkspace(seed) {
      const transaction = db.transaction(() => {
        seed.agents.forEach(agents.insertMissing);
        seed.modelRuntimes.forEach(runtimes.insertMissing);
        seed.modelAssets.forEach(modelAssets.insertMissing);
        seed.voices.forEach(voices.insertMissing);
        const seedWithTools = seed as ReturnType<typeof createDefaultWorkspace> & { tools?: Tool[] };
        seedWithTools.tools?.forEach(tools.insertMissing);
        seed.phoneNumbers.forEach(phoneNumbers.insertMissing);
        seed.knowledgeBases.forEach(knowledgeBases.insertMissing);
        seed.knowledgeDocuments.forEach((document) => {
          const parsed = knowledgeDocumentSchema.parse(document);
          db.prepare("INSERT OR IGNORE INTO knowledge_documents (id, knowledge_base_id, data) VALUES (?, ?, ?)").run(
            parsed.id,
            parsed.knowledgeBaseId,
            JSON.stringify(parsed),
          );
        });
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

function tokenizeQuery(query: string) {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length > 1),
    ),
  );
}

function scoreDocument(document: KnowledgeDocument, terms: string[]): KnowledgeSearchResult | null {
  const haystack = `${document.title} ${document.content}`.toLowerCase();
  const score = terms.reduce((currentScore, term) => currentScore + (haystack.includes(term) ? 1 : 0), 0);

  if (score === 0) {
    return null;
  }

  return {
    documentId: document.id,
    title: document.title,
    snippet: createSnippet(document.content, terms),
    score,
  };
}

function createSnippet(content: string, terms: string[]) {
  const lowerContent = content.toLowerCase();
  const firstMatch = terms
    .map((term) => lowerContent.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstMatch - 50);
  const end = Math.min(content.length, start + 160);

  return content.slice(start, end);
}
