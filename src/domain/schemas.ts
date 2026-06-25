import { z } from "zod";

export const isoDateSchema = z.string().datetime();

export const callStatusSchema = z.enum([
  "idle",
  "requesting_mic",
  "connecting",
  "connected",
  "listening",
  "thinking",
  "speaking",
  "disconnected",
  "failed",
]);

export const runtimeKindSchema = z.enum(["llm", "stt", "tts", "vad", "embedding"]);
export const runtimeAdapterSchema = z.enum([
  "ollama",
  "vllm",
  "gemini",
  "whisper_cpp",
  "faster_whisper",
  "google_stt",
  "piper",
  "piper_http",
  "coqui_http",
  "fastpitch_http",
  "google_tts",
  "indic_parler",
  "omnivoice",
  "chatterbox_nepali",
  "coqui_vits",
  "kokoro",
  "energy_vad",
]);

export const runtimeHealthStatusSchema = z.enum([
  "unknown",
  "healthy",
  "unavailable",
  "missing_model",
  "license_required",
  "failed",
]);
export const phoneNumberProviderSchema = z.enum(["simulation", "byo_sip", "twilio", "telnyx"]);
export const phoneNumberStatusSchema = z.enum(["active", "pending", "disabled"]);
export const knowledgeBaseStatusSchema = z.enum(["ready", "indexing", "failed"]);
export const evalRunStatusSchema = z.enum(["passed", "failed"]);

export const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  greeting: z.string().min(1),
  systemPrompt: z.string().min(1),
  language: z.string().min(2),
  modelRuntimeId: z.string().min(1),
  modelAssetId: z.string().min(1),
  voiceId: z.string().min(1),
  transcriberRuntimeId: z.string().min(1),
  recordingEnabled: z.boolean(),
  interruptionSensitivity: z.enum(["low", "medium", "high"]),
  toolIds: z.array(z.string()),
  knowledgeBaseIds: z.array(z.string()),
  deploymentState: z.enum(["draft", "ready", "not_configured"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const modelRuntimeSchema = z.object({
  id: z.string().min(1),
  kind: runtimeKindSchema,
  adapter: runtimeAdapterSchema,
  endpoint: z.string(),
  configuredState: z.enum(["configured", "not_configured"]),
  healthStatus: runtimeHealthStatusSchema,
  defaultModelId: z.string(),
  concurrencyLimit: z.number().int().min(1).max(16),
  hardwareHints: z.array(z.string()),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const modelAssetSchema = z.object({
  id: z.string().min(1),
  runtimeId: z.string().min(1),
  name: z.string().min(1),
  kind: runtimeKindSchema,
  family: z.string().min(1),
  version: z.string().min(1),
  pathOrTag: z.string().min(1),
  license: z.string().min(1),
  parameterSize: z.string(),
  quantization: z.string(),
  languageSupport: z.array(z.string()),
  installedState: z.enum(["installed", "not_installed", "unknown"]),
});

export const voiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtimeId: z.string().min(1),
  type: z.enum(["builtin", "cloned"]),
  language: z.string().min(2),
  tags: z.array(z.string()),
  previewUrl: z.string(),
  privacy: z.enum(["private", "workspace"]),
  cloneStatus: z.enum(["not_clone", "pending", "processing", "available", "failed"]),
  consentId: z.string().nullable(),
});

export const voiceSampleSchema = z.object({
  id: z.string().min(1),
  voiceId: z.string().min(1),
  voiceName: z.string().min(1),
  text: z.string().min(1),
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1),
  createdAt: isoDateSchema,
});

export const consentRecordSchema = z.object({
  id: z.string().min(1),
  voiceId: z.string().min(1),
  speakerName: z.string().min(1),
  consentSource: z.string().min(1),
  capturedAt: isoDateSchema,
  termsVersion: z.string().min(1),
  auditNotes: z.string(),
});

export const toolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url({ message: "Invalid URL" }),
  authMode: z.enum(["none", "bearer", "header"]),
  headers: z.array(
    z.object({
      name: z.string().min(1),
      value: z.string(),
      secret: z.boolean(),
    }),
  ),
  parameters: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(["string", "number", "boolean"]),
      required: z.boolean(),
    }),
  ),
  timeoutMs: z.number().int().min(500).max(60000),
  retryCount: z.number().int().min(0).max(3),
  responseSchema: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const toolExecutionLogSchema = z.object({
  id: z.string().min(1),
  toolId: z.string().min(1),
  toolName: z.string().min(1),
  timestamp: isoDateSchema,
  ok: z.boolean(),
  status: z.number().int().min(0),
  attempts: z.number().int().min(0),
  durationMs: z.number().min(0),
  error: z.string().nullable(),
  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().min(1),
    headers: z.array(
      z.object({
        name: z.string().min(1),
        value: z.string(),
      }),
    ),
  }),
  response: z.object({
    body: z.string(),
  }),
});

export const phoneNumberSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  number: z.string().regex(/^\+[1-9]\d{6,14}$/, "Invalid E.164 phone number"),
  provider: phoneNumberProviderSchema,
  status: phoneNumberStatusSchema,
  agentId: z.string().min(1).nullable(),
  inboundEnabled: z.boolean(),
  outboundEnabled: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const customerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  phoneNumber: z.string().min(1),
  email: z.string().email().nullable(),
  address: z.string(),
  preferredLanguage: z.string().min(2),
  notes: z.string(),
  source: z.enum(["voice_call", "manual", "import"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  lastCallId: z.string().min(1).nullable(),
});

export const ticketSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1).nullable(),
  callId: z.string().min(1).nullable(),
  type: z.enum(["claim", "policy_question", "billing", "complaint", "callback", "other"]),
  status: z.enum(["open", "in_progress", "waiting_customer", "resolved", "closed"]),
  priority: z.enum(["normal", "high", "urgent"]),
  subject: z.string().min(1),
  description: z.string(),
  source: z.enum(["voice_call", "manual"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const appointmentSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1).nullable(),
  callId: z.string().min(1).nullable(),
  callerName: z.string().min(1),
  phoneNumber: z.string().min(1),
  scheduledAt: isoDateSchema.nullable(),
  preferredTime: z.string(),
  reason: z.string(),
  status: z.enum(["scheduled", "completed", "cancelled", "missed"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const transferRecordSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1).nullable(),
  callId: z.string().min(1).nullable(),
  department: z.string().min(1),
  reason: z.string(),
  status: z.enum(["queued", "completed", "failed", "cancelled"]),
  warmTransferAvailable: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const knowledgeBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: knowledgeBaseStatusSchema,
  documentCount: z.number().int().min(0),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const knowledgeDocumentSchema = z.object({
  id: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  title: z.string().min(1),
  sourceType: z.enum(["text", "url", "file"]),
  content: z.string().min(1),
  tokenCount: z.number().int().min(0),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const knowledgeSearchResultSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1),
  snippet: z.string(),
  score: z.number().min(0),
});

const urlOrEmptySchema = z.union([z.string().url(), z.literal("")]);

export const workspaceSettingsSchema = z.object({
  id: z.literal("workspace_settings"),
  workspaceName: z.string().min(1),
  publicBaseUrl: urlOrEmptySchema,
  allowedOrigins: z.array(urlOrEmptySchema),
  allowPrivateToolUrls: z.boolean(),
  redactToolSecrets: z.boolean(),
  recordingRetentionDays: z.number().int().min(1).max(3650),
  auditLogRetentionDays: z.number().int().min(1).max(3650),
  realtimeSessionTtlSeconds: z.number().int().min(15).max(3600),
  sipTrunk: z.object({
    enabled: z.boolean(),
    provider: z.string(),
    mode: z.enum(["direct", "asterisk"]),
    sipServer: z.string(),
    outboundProxy: z.string(),
    domain: z.string(),
    username: z.string(),
    authUsername: z.string(),
    fromNumber: z.string(),
    transport: z.enum(["udp", "tcp", "tls"]),
  }).default({
    enabled: false,
    provider: "",
    mode: "asterisk",
    sipServer: "",
    outboundProxy: "",
    domain: "",
    username: "",
    authUsername: "",
    fromNumber: "",
    transport: "udp",
  }),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const evalCheckSchema = z.object({
  type: z.enum(["includes", "excludes"]),
  value: z.string().min(1),
});

export const evalDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  agentId: z.string().min(1),
  cases: z.array(
    z.object({
      id: z.string().min(1),
      input: z.string().min(1),
      checks: z.array(evalCheckSchema).min(1),
    }),
  ).min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const evalRunSchema = z.object({
  id: z.string().min(1),
  evalId: z.string().min(1),
  agentId: z.string().min(1),
  status: evalRunStatusSchema,
  score: z.number().min(0).max(100),
  startedAt: isoDateSchema,
  completedAt: isoDateSchema,
  caseResults: z.array(
    z.object({
      caseId: z.string().min(1),
      input: z.string().min(1),
      response: z.string(),
      passed: z.boolean(),
      checkResults: z.array(evalCheckSchema.extend({ passed: z.boolean() })),
      recommendation: z.string().nullable(),
    }),
  ),
});

export const callSchema = z.object({
  id: z.string().min(1),
  channel: z.enum(["web", "phone", "simulation"]),
  direction: z.enum(["inbound", "outbound"]),
  agentId: z.string().min(1),
  phoneNumberId: z.string().min(1).nullable().optional(),
  status: callStatusSchema,
  startedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
  durationSeconds: z.number().min(0),
  costEstimateUsd: z.number().min(0),
  recordingUrl: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const callEventSchema = z.object({
  id: z.string().min(1),
  callId: z.string().min(1),
  timestamp: isoDateSchema,
  type: z.enum(["status", "transcript", "tool_call", "audio", "runtime", "error"]),
  actor: z.enum(["system", "user", "assistant", "tool"]),
  payload: z.record(z.string(), z.unknown()),
  severity: z.enum(["info", "warning", "error"]),
});

export const policyStatusSchema = z.enum(["active", "expired", "pending", "cancelled", "lapsed"]);
export const policyTypeSchema = z.enum([
  "motor", "property", "health", "life", "marine", "engineering", "agriculture", "micro", "miscellaneous",
]);

export const policySchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  policyNumber: z.string().min(1),
  type: policyTypeSchema,
  status: policyStatusSchema,
  insuredName: z.string(),
  premium: z.number().min(0),
  sumInsured: z.number().min(0),
  startDate: z.string(),
  endDate: z.string(),
  renewalDueDate: z.string().nullable(),
  claimCount: z.number().int().min(0),
  notes: z.string(),
  cmsId: z.string().nullable(),
  cmsSource: z.string().nullable(),
  syncedAt: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

const campaignContactSchema = z.object({
  customerId: z.string().min(1),
  phoneNumber: z.string().min(1),
  name: z.string().min(1),
  policyId: z.string().nullable().optional(),
  contextData: z.record(z.string(), z.string()).optional(),
});

export const campaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["renewal_reminder", "claim_followup", "survey", "account_update", "custom"]),
  status: z.enum(["draft", "scheduled", "running", "paused", "completed", "failed"]),
  agentId: z.string().min(1),
  contacts: z.array(campaignContactSchema),
  scheduledAt: isoDateSchema.nullable(),
  completedAt: isoDateSchema.nullable(),
  totalContacts: z.number().int().min(0),
  dialedCount: z.number().int().min(0),
  answeredCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  notes: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const campaignRunSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  customerId: z.string().min(1),
  callId: z.string().nullable(),
  status: z.enum(["pending", "dialing", "connected", "completed", "failed", "no_answer"]),
  attemptCount: z.number().int().min(0),
  scheduledAt: isoDateSchema,
  startedAt: isoDateSchema.nullable(),
  endedAt: isoDateSchema.nullable(),
  notes: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
