import { nanoid } from "nanoid";
import type { createDefaultWorkspace } from "@/domain/defaults";
import {
  agentSchema,
  appointmentSchema,
  callEventSchema,
  callSchema,
  campaignRunSchema,
  campaignSchema,
  consentRecordSchema,
  customerSchema,
  evalDefinitionSchema,
  evalRunSchema,
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  knowledgeSearchResultSchema,
  modelAssetSchema,
  modelRuntimeSchema,
  phoneNumberSchema,
  policySchema,
  ticketSchema,
  toolExecutionLogSchema,
  toolSchema,
  transferRecordSchema,
  voiceSchema,
  voiceSampleSchema,
  workspaceSettingsSchema,
} from "@/domain/schemas";
import type {
  Agent,
  Appointment,
  Call,
  CallEvent,
  Campaign,
  CampaignRun,
  ConsentRecord,
  Customer,
  EvalDefinition,
  EvalRun,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeSearchResult,
  ModelAsset,
  ModelRuntime,
  PhoneNumber,
  Policy,
  Ticket,
  Tool,
  ToolExecutionLog,
  TransferRecord,
  Voice,
  VoiceSample,
  WorkspaceSettings,
} from "@/domain/types";
import type { DatabaseConnection } from "./database";

type TableName =
  | "agents"
  | "model_runtimes"
  | "model_assets"
  | "voices"
  | "consent_records"
  | "tools"
  | "phone_numbers"
  | "knowledge_bases"
  | "evals"
  | "settings"
  | "calls";

type StoredRow = {
  data: string;
};

export interface StoredSecret {
  id: string;
  value: string;
  updatedAt: string;
}

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
  modelAssets: {
    list(): ModelAsset[];
  };
  voices: {
    list(): Voice[];
    get(id: string): Voice | null;
    save(voice: Voice): Voice;
  };
  voiceSamples: {
    append(input: Omit<VoiceSample, "id">): VoiceSample;
    list(): VoiceSample[];
  };
  consentRecords: {
    list(): ConsentRecord[];
    get(id: string): ConsentRecord | null;
    save(consent: ConsentRecord): ConsentRecord;
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
  customers: {
    list(): Customer[];
    get(id: string): Customer | null;
    findByPhone(phoneNumber: string): Customer | null;
    save(customer: Customer): Customer;
  };
  tickets: {
    list(): Ticket[];
    get(id: string): Ticket | null;
    save(ticket: Ticket): Ticket;
  };
  appointments: {
    list(): Appointment[];
    get(id: string): Appointment | null;
    save(appointment: Appointment): Appointment;
  };
  transfers: {
    list(): TransferRecord[];
    get(id: string): TransferRecord | null;
    save(transfer: TransferRecord): TransferRecord;
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
  evals: {
    list(): EvalDefinition[];
    get(id: string): EvalDefinition | null;
    save(evalDefinition: EvalDefinition): EvalDefinition;
  };
  evalRuns: {
    append(input: Omit<EvalRun, "id">): EvalRun;
    list(): EvalRun[];
    listForEval(evalId: string): EvalRun[];
  };
  settings: {
    get(): WorkspaceSettings;
    save(settings: WorkspaceSettings): WorkspaceSettings;
  };
  secrets: {
    get(id: string): StoredSecret | null;
    save(secret: StoredSecret): StoredSecret;
    delete(id: string): void;
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
  policies: {
    list(): Policy[];
    listForCustomer(customerId: string): Policy[];
    get(id: string): Policy | null;
    findByCmsId(cmsId: string): Policy | null;
    findDueForRenewal(withinDays: number): Policy[];
    save(policy: Policy): Policy;
  };
  campaigns: {
    list(): Campaign[];
    get(id: string): Campaign | null;
    save(campaign: Campaign): Campaign;
  };
  campaignRuns: {
    list(): CampaignRun[];
    listForCampaign(campaignId: string): CampaignRun[];
    listPending(campaignId: string): CampaignRun[];
    get(id: string): CampaignRun | null;
    save(run: CampaignRun): CampaignRun;
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
  const consentRecords = createJsonRepository(db, "consent_records", consentRecordSchema.parse);
  const tools = createJsonRepository(db, "tools", toolSchema.parse);
  const phoneNumbers = createJsonRepository(db, "phone_numbers", phoneNumberSchema.parse);
  const knowledgeBases = createJsonRepository(db, "knowledge_bases", knowledgeBaseSchema.parse);
  const evals = createJsonRepository(db, "evals", evalDefinitionSchema.parse);
  const settings = createJsonRepository(db, "settings", workspaceSettingsSchema.parse);
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
    modelAssets: {
      list: modelAssets.list,
    },
    voices: {
      list: voices.list,
      get: voices.get,
      save: voices.save,
    },
    voiceSamples: {
      append(input) {
        const sample = voiceSampleSchema.parse({
          id: nanoid(),
          ...input,
        });

        db.prepare(
          "INSERT INTO voice_samples (id, created_at, data) VALUES (?, ?, ?)",
        ).run(sample.id, sample.createdAt, JSON.stringify(sample));

        return sample;
      },
      list() {
        return db
          .prepare("SELECT data FROM voice_samples ORDER BY created_at DESC, id DESC")
          .all()
          .map((row) => voiceSampleSchema.parse(JSON.parse((row as StoredRow).data)));
      },
    },
    consentRecords: {
      list: consentRecords.list,
      get: consentRecords.get,
      save(consent) {
        const parsed = consentRecordSchema.parse(consent);
        db.prepare(`
          INSERT INTO consent_records (id, voice_id, data)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            voice_id = excluded.voice_id,
            data = excluded.data
        `).run(parsed.id, parsed.voiceId, JSON.stringify(parsed));
        return parsed;
      },
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
    customers: createCustomerRepository(db),
    tickets: createTicketRepository(db),
    appointments: createAppointmentRepository(db),
    transfers: createTransferRepository(db),
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
    evals: {
      list: evals.list,
      get: evals.get,
      save: evals.save,
    },
    evalRuns: {
      append(input) {
        const run = evalRunSchema.parse({
          id: nanoid(),
          ...input,
        });

        db.prepare(
          "INSERT INTO eval_runs (id, eval_id, started_at, data) VALUES (?, ?, ?, ?)",
        ).run(run.id, run.evalId, run.startedAt, JSON.stringify(run));

        return run;
      },
      list() {
        return db
          .prepare("SELECT data FROM eval_runs ORDER BY started_at DESC, id DESC")
          .all()
          .map((row) => evalRunSchema.parse(JSON.parse((row as StoredRow).data)));
      },
      listForEval(evalId) {
        return db
          .prepare("SELECT data FROM eval_runs WHERE eval_id = ? ORDER BY started_at DESC, id DESC")
          .all(evalId)
          .map((row) => evalRunSchema.parse(JSON.parse((row as StoredRow).data)));
      },
    },
    settings: {
      get() {
        const currentSettings = settings.get("workspace_settings");
        if (!currentSettings) {
          throw new Error("workspace_settings_not_seeded");
        }

        return currentSettings;
      },
      save: settings.save,
    },
    secrets: {
      get(id) {
        const row = db.prepare("SELECT data FROM secrets WHERE id = ?").get(id) as StoredRow | undefined;
        return row ? parseStoredSecret(JSON.parse(row.data)) : null;
      },
      save(secret) {
        const parsed = parseStoredSecret(secret);
        db.prepare(`
          INSERT INTO secrets (id, updated_at, data)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at,
            data = excluded.data
        `).run(parsed.id, parsed.updatedAt, JSON.stringify(parsed));
        return parsed;
      },
      delete(id) {
        db.prepare("DELETE FROM secrets WHERE id = ?").run(id);
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
    policies: {
      list() {
        return db
          .prepare("SELECT data FROM policies ORDER BY end_date DESC, id DESC")
          .all()
          .map((row) => policySchema.parse(JSON.parse((row as StoredRow).data)));
      },
      listForCustomer(customerId) {
        return db
          .prepare("SELECT data FROM policies WHERE customer_id = ? ORDER BY end_date DESC")
          .all(customerId)
          .map((row) => policySchema.parse(JSON.parse((row as StoredRow).data)));
      },
      get(id) {
        const row = db.prepare("SELECT data FROM policies WHERE id = ?").get(id) as StoredRow | undefined;
        return row ? policySchema.parse(JSON.parse(row.data)) : null;
      },
      findByCmsId(cmsId) {
        const row = db.prepare("SELECT data FROM policies WHERE cms_id = ? LIMIT 1").get(cmsId) as StoredRow | undefined;
        return row ? policySchema.parse(JSON.parse(row.data)) : null;
      },
      findDueForRenewal(withinDays) {
        const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        return db
          .prepare("SELECT data FROM policies WHERE status = 'active' AND end_date BETWEEN ? AND ? ORDER BY end_date ASC")
          .all(today, cutoff)
          .map((row) => policySchema.parse(JSON.parse((row as StoredRow).data)));
      },
      save(policy) {
        const parsed = policySchema.parse(policy);
        db.prepare(`
          INSERT INTO policies (id, customer_id, policy_number, status, end_date, cms_id, data)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            customer_id = excluded.customer_id,
            policy_number = excluded.policy_number,
            status = excluded.status,
            end_date = excluded.end_date,
            cms_id = excluded.cms_id,
            data = excluded.data
        `).run(
          parsed.id,
          parsed.customerId,
          parsed.policyNumber,
          parsed.status,
          parsed.endDate,
          parsed.cmsId,
          JSON.stringify(parsed),
        );
        return parsed;
      },
    },
    campaigns: {
      list() {
        return db
          .prepare("SELECT data FROM campaigns ORDER BY created_at DESC, id DESC")
          .all()
          .map((row) => campaignSchema.parse(JSON.parse((row as StoredRow).data)));
      },
      get(id) {
        const row = db.prepare("SELECT data FROM campaigns WHERE id = ?").get(id) as StoredRow | undefined;
        return row ? campaignSchema.parse(JSON.parse(row.data)) : null;
      },
      save(campaign) {
        const parsed = campaignSchema.parse(campaign);
        db.prepare(`
          INSERT INTO campaigns (id, status, type, scheduled_at, created_at, data)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            type = excluded.type,
            scheduled_at = excluded.scheduled_at,
            created_at = excluded.created_at,
            data = excluded.data
        `).run(
          parsed.id,
          parsed.status,
          parsed.type,
          parsed.scheduledAt,
          parsed.createdAt,
          JSON.stringify(parsed),
        );
        return parsed;
      },
    },
    campaignRuns: {
      list() {
        return db
          .prepare("SELECT data FROM campaign_runs ORDER BY scheduled_at ASC, id ASC")
          .all()
          .map((row) => campaignRunSchema.parse(JSON.parse((row as StoredRow).data)));
      },
      listForCampaign(campaignId) {
        return db
          .prepare("SELECT data FROM campaign_runs WHERE campaign_id = ? ORDER BY scheduled_at ASC")
          .all(campaignId)
          .map((row) => campaignRunSchema.parse(JSON.parse((row as StoredRow).data)));
      },
      listPending(campaignId) {
        return db
          .prepare("SELECT data FROM campaign_runs WHERE campaign_id = ? AND status = 'pending' ORDER BY scheduled_at ASC")
          .all(campaignId)
          .map((row) => campaignRunSchema.parse(JSON.parse((row as StoredRow).data)));
      },
      get(id) {
        const row = db.prepare("SELECT data FROM campaign_runs WHERE id = ?").get(id) as StoredRow | undefined;
        return row ? campaignRunSchema.parse(JSON.parse(row.data)) : null;
      },
      save(run) {
        const parsed = campaignRunSchema.parse(run);
        db.prepare(`
          INSERT INTO campaign_runs (id, campaign_id, customer_id, status, scheduled_at, created_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            scheduled_at = excluded.scheduled_at,
            data = excluded.data
        `).run(
          parsed.id,
          parsed.campaignId,
          parsed.customerId,
          parsed.status,
          parsed.scheduledAt,
          parsed.createdAt,
          JSON.stringify(parsed),
        );
        return parsed;
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
        seed.voiceSamples.forEach((sample) => {
          const parsed = voiceSampleSchema.parse(sample);
          db.prepare("INSERT OR IGNORE INTO voice_samples (id, created_at, data) VALUES (?, ?, ?)").run(
            parsed.id,
            parsed.createdAt,
            JSON.stringify(parsed),
          );
        });
        seed.consentRecords.forEach((consent) => {
          const parsed = consentRecordSchema.parse(consent);
          db.prepare("INSERT OR IGNORE INTO consent_records (id, voice_id, data) VALUES (?, ?, ?)").run(
            parsed.id,
            parsed.voiceId,
            JSON.stringify(parsed),
          );
        });
        const seedWithTools = seed as ReturnType<typeof createDefaultWorkspace> & { tools?: Tool[] };
        seedWithTools.tools?.forEach(tools.insertMissing);
        seed.phoneNumbers.forEach(phoneNumbers.insertMissing);
        const operationsSeed = seed as ReturnType<typeof createDefaultWorkspace> & {
          customers?: Customer[];
          tickets?: Ticket[];
          appointments?: Appointment[];
          transfers?: TransferRecord[];
        };
        operationsSeed.customers?.forEach((customer) => {
          const parsed = customerSchema.parse(customer);
          db.prepare("INSERT OR IGNORE INTO customers (id, phone, data) VALUES (?, ?, ?)").run(
            parsed.id,
            parsed.phoneNumber,
            JSON.stringify(parsed),
          );
        });
        operationsSeed.tickets?.forEach((ticket) => {
          const parsed = ticketSchema.parse(ticket);
          db.prepare(
            "INSERT OR IGNORE INTO tickets (id, customer_id, call_id, status, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            parsed.id,
            parsed.customerId,
            parsed.callId,
            parsed.status,
            parsed.updatedAt,
            JSON.stringify(parsed),
          );
        });
        operationsSeed.appointments?.forEach((appointment) => {
          const parsed = appointmentSchema.parse(appointment);
          db.prepare(
            "INSERT OR IGNORE INTO appointments (id, customer_id, call_id, scheduled_at, status, data) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            parsed.id,
            parsed.customerId,
            parsed.callId,
            parsed.scheduledAt,
            parsed.status,
            JSON.stringify(parsed),
          );
        });
        operationsSeed.transfers?.forEach((transfer) => {
          const parsed = transferRecordSchema.parse(transfer);
          db.prepare(
            "INSERT OR IGNORE INTO transfers (id, customer_id, call_id, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            parsed.id,
            parsed.customerId,
            parsed.callId,
            parsed.status,
            parsed.createdAt,
            JSON.stringify(parsed),
          );
        });
        seed.knowledgeBases.forEach(knowledgeBases.insertMissing);
        seed.knowledgeDocuments.forEach((document) => {
          const parsed = knowledgeDocumentSchema.parse(document);
          db.prepare("INSERT OR IGNORE INTO knowledge_documents (id, knowledge_base_id, data) VALUES (?, ?, ?)").run(
            parsed.id,
            parsed.knowledgeBaseId,
            JSON.stringify(parsed),
          );
        });
        seed.evals.forEach(evals.insertMissing);
        reconcileSeedSettings(settings, seed.settings);
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

function parseStoredSecret(input: unknown): StoredSecret {
  if (!input || typeof input !== "object") {
    throw new Error("invalid_secret");
  }

  const secret = input as Partial<Record<keyof StoredSecret, unknown>>;
  if (
    typeof secret.id !== "string" ||
    typeof secret.value !== "string" ||
    typeof secret.updatedAt !== "string"
  ) {
    throw new Error("invalid_secret");
  }

  return {
    id: secret.id,
    value: secret.value,
    updatedAt: secret.updatedAt,
  };
}

function createCustomerRepository(db: DatabaseConnection) {
  return {
    list(): Customer[] {
      return db
        .prepare("SELECT data FROM customers ORDER BY id DESC")
        .all()
        .map((row) => customerSchema.parse(JSON.parse((row as StoredRow).data)));
    },
    get(id: string): Customer | null {
      const row = db.prepare("SELECT data FROM customers WHERE id = ?").get(id) as StoredRow | undefined;
      return row ? customerSchema.parse(JSON.parse(row.data)) : null;
    },
    findByPhone(phoneNumber: string): Customer | null {
      const row = db.prepare("SELECT data FROM customers WHERE phone = ? ORDER BY id DESC").get(phoneNumber) as
        | StoredRow
        | undefined;
      return row ? customerSchema.parse(JSON.parse(row.data)) : null;
    },
    save(customer: Customer): Customer {
      const parsed = customerSchema.parse(customer);
      db.prepare(`
        INSERT INTO customers (id, phone, data)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          phone = excluded.phone,
          data = excluded.data
      `).run(parsed.id, parsed.phoneNumber, JSON.stringify(parsed));
      return parsed;
    },
  };
}

function createTicketRepository(db: DatabaseConnection) {
  return {
    list(): Ticket[] {
      return db
        .prepare("SELECT data FROM tickets ORDER BY updated_at DESC, id DESC")
        .all()
        .map((row) => ticketSchema.parse(JSON.parse((row as StoredRow).data)));
    },
    get(id: string): Ticket | null {
      const row = db.prepare("SELECT data FROM tickets WHERE id = ?").get(id) as StoredRow | undefined;
      return row ? ticketSchema.parse(JSON.parse(row.data)) : null;
    },
    save(ticket: Ticket): Ticket {
      const parsed = ticketSchema.parse(ticket);
      db.prepare(`
        INSERT INTO tickets (id, customer_id, call_id, status, updated_at, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          customer_id = excluded.customer_id,
          call_id = excluded.call_id,
          status = excluded.status,
          updated_at = excluded.updated_at,
          data = excluded.data
      `).run(
        parsed.id,
        parsed.customerId,
        parsed.callId,
        parsed.status,
        parsed.updatedAt,
        JSON.stringify(parsed),
      );
      return parsed;
    },
  };
}

function createAppointmentRepository(db: DatabaseConnection) {
  return {
    list(): Appointment[] {
      return db
        .prepare("SELECT data FROM appointments ORDER BY COALESCE(scheduled_at, '') DESC, id DESC")
        .all()
        .map((row) => appointmentSchema.parse(JSON.parse((row as StoredRow).data)));
    },
    get(id: string): Appointment | null {
      const row = db.prepare("SELECT data FROM appointments WHERE id = ?").get(id) as StoredRow | undefined;
      return row ? appointmentSchema.parse(JSON.parse(row.data)) : null;
    },
    save(appointment: Appointment): Appointment {
      const parsed = appointmentSchema.parse(appointment);
      db.prepare(`
        INSERT INTO appointments (id, customer_id, call_id, scheduled_at, status, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          customer_id = excluded.customer_id,
          call_id = excluded.call_id,
          scheduled_at = excluded.scheduled_at,
          status = excluded.status,
          data = excluded.data
      `).run(
        parsed.id,
        parsed.customerId,
        parsed.callId,
        parsed.scheduledAt,
        parsed.status,
        JSON.stringify(parsed),
      );
      return parsed;
    },
  };
}

function createTransferRepository(db: DatabaseConnection) {
  return {
    list(): TransferRecord[] {
      return db
        .prepare("SELECT data FROM transfers ORDER BY created_at DESC, id DESC")
        .all()
        .map((row) => transferRecordSchema.parse(JSON.parse((row as StoredRow).data)));
    },
    get(id: string): TransferRecord | null {
      const row = db.prepare("SELECT data FROM transfers WHERE id = ?").get(id) as StoredRow | undefined;
      return row ? transferRecordSchema.parse(JSON.parse(row.data)) : null;
    },
    save(transfer: TransferRecord): TransferRecord {
      const parsed = transferRecordSchema.parse(transfer);
      db.prepare(`
        INSERT INTO transfers (id, customer_id, call_id, status, created_at, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          customer_id = excluded.customer_id,
          call_id = excluded.call_id,
          status = excluded.status,
          created_at = excluded.created_at,
          data = excluded.data
      `).run(
        parsed.id,
        parsed.customerId,
        parsed.callId,
        parsed.status,
        parsed.createdAt,
        JSON.stringify(parsed),
      );
      return parsed;
    },
  };
}

function reconcileSeedSettings(
  repository: ReturnType<typeof createJsonRepository<WorkspaceSettings>>,
  seedSettings: WorkspaceSettings,
) {
  const currentSettings = repository.get("workspace_settings");
  if (!currentSettings) {
    repository.save(seedSettings);
    return;
  }

  if (
    currentSettings.publicBaseUrl === "http://127.0.0.1:8787" &&
    seedSettings.publicBaseUrl !== "http://127.0.0.1:8787"
  ) {
    repository.save({
      ...currentSettings,
      publicBaseUrl: seedSettings.publicBaseUrl,
      allowedOrigins: seedSettings.allowedOrigins,
      updatedAt: seedSettings.updatedAt,
    });
  }
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
