export type RuntimeKind = "llm" | "stt" | "tts" | "vad" | "embedding";
export type RuntimeAdapter =
  | "ollama"
  | "vllm"
  | "gemini"
  | "whisper_cpp"
  | "faster_whisper"
  | "google_stt"
  | "piper"
  | "piper_http"
  | "coqui_http"
  | "fastpitch_http"
  | "google_tts"
  | "indic_parler"
  | "omnivoice"
  | "chatterbox_nepali"
  | "coqui_vits"
  | "kokoro"
  | "energy_vad";
export type RuntimeHealthStatus =
  | "unknown"
  | "healthy"
  | "unavailable"
  | "missing_model"
  | "license_required"
  | "failed";
export type ConfiguredState = "configured" | "not_configured";
export type DeploymentState = "draft" | "ready" | "not_configured";
export type CallStatus =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "disconnected"
  | "failed";
export type PhoneNumberProvider = "simulation" | "byo_sip" | "twilio" | "telnyx";
export type PhoneNumberStatus = "active" | "pending" | "disabled";
export type KnowledgeBaseStatus = "ready" | "indexing" | "failed";
export type EvalRunStatus = "passed" | "failed";

export interface Agent {
  id: string;
  name: string;
  greeting: string;
  systemPrompt: string;
  language: string;
  modelRuntimeId: string;
  modelAssetId: string;
  voiceId: string;
  transcriberRuntimeId: string;
  recordingEnabled: boolean;
  interruptionSensitivity: "low" | "medium" | "high";
  toolIds: string[];
  knowledgeBaseIds: string[];
  deploymentState: DeploymentState;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRuntime {
  id: string;
  kind: RuntimeKind;
  adapter: RuntimeAdapter;
  endpoint: string;
  configuredState: ConfiguredState;
  healthStatus: RuntimeHealthStatus;
  defaultModelId: string;
  concurrencyLimit: number;
  hardwareHints: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelAsset {
  id: string;
  runtimeId: string;
  name: string;
  kind: RuntimeKind;
  family: string;
  version: string;
  pathOrTag: string;
  license: string;
  parameterSize: string;
  quantization: string;
  languageSupport: string[];
  installedState: "installed" | "not_installed" | "unknown";
}

export interface Voice {
  id: string;
  name: string;
  runtimeId: string;
  type: "builtin" | "cloned";
  language: string;
  tags: string[];
  previewUrl: string;
  privacy: "private" | "workspace";
  cloneStatus: "not_clone" | "pending" | "processing" | "available" | "failed";
  consentId: string | null;
}

export interface VoiceSample {
  id: string;
  voiceId: string;
  voiceName: string;
  text: string;
  audioBase64: string;
  mimeType: string;
  createdAt: string;
}

export type TtsProviderAccess = "open" | "gated" | "custom_training" | "cloud";

export interface TtsProvider {
  id: string;
  name: string;
  role: string;
  access: TtsProviderAccess;
  adapter: RuntimeAdapter;
  runtimeId: string | null;
  voiceId: string | null;
  configuredState: ConfiguredState;
  healthStatus: RuntimeHealthStatus;
  sourceUrl: string;
  license: string;
  languageSupport: string[];
  capabilities: string[];
  hardwareHints: string[];
}

export interface TtsBenchmarkResult {
  id: string;
  providerId: string;
  providerName: string;
  text: string;
  status: "generated" | "unavailable";
  healthStatus: RuntimeHealthStatus;
  code: string | null;
  audioBase64: string | null;
  mimeType: string | null;
  latencyMs: number;
  createdAt: string;
}

export interface ConsentRecord {
  id: string;
  voiceId: string;
  speakerName: string;
  consentSource: string;
  capturedAt: string;
  termsVersion: string;
  auditNotes: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  authMode: "none" | "bearer" | "header";
  headers: Array<{ name: string; value: string; secret: boolean }>;
  parameters: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
  }>;
  timeoutMs: number;
  retryCount: number;
  responseSchema: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolExecutionLog {
  id: string;
  toolId: string;
  toolName: string;
  timestamp: string;
  ok: boolean;
  status: number;
  attempts: number;
  durationMs: number;
  error: string | null;
  request: {
    method: Tool["method"];
    url: string;
    headers: Array<{ name: string; value: string }>;
  };
  response: {
    body: string;
  };
}

export interface PhoneNumber {
  id: string;
  label: string;
  number: string;
  provider: PhoneNumberProvider;
  status: PhoneNumberStatus;
  agentId: string | null;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CustomerSource = "voice_call" | "manual" | "import";

export interface Customer {
  id: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  address: string;
  preferredLanguage: string;
  notes: string;
  source: CustomerSource;
  createdAt: string;
  updatedAt: string;
  lastCallId: string | null;
}

export type TicketType = "claim" | "policy_question" | "billing" | "complaint" | "callback" | "other";
export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "normal" | "high" | "urgent";

export interface Ticket {
  id: string;
  customerId: string | null;
  callId: string | null;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  subject: string;
  description: string;
  source: "voice_call" | "manual";
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "missed";

export interface Appointment {
  id: string;
  customerId: string | null;
  callId: string | null;
  callerName: string;
  phoneNumber: string;
  scheduledAt: string | null;
  preferredTime: string;
  reason: string;
  status: AppointmentStatus;
  createdAt: string;
  updatedAt: string;
}

export type TransferStatus = "queued" | "completed" | "failed" | "cancelled";

export interface TransferRecord {
  id: string;
  customerId: string | null;
  callId: string | null;
  department: string;
  reason: string;
  status: TransferStatus;
  warmTransferAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  status: KnowledgeBaseStatus;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  sourceType: "text" | "url" | "file";
  content: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
}

export interface UsageSummary {
  agents: number;
  phoneNumbers: number;
  callsTotal: number;
  activeCalls: number;
  callMinutes: number;
  estimatedCostUsd: number;
  toolExecutions: number;
  knowledgeBases: number;
  knowledgeDocuments: number;
}

export type SipTrunkMode = "direct" | "asterisk";
export type SipTransport = "udp" | "tcp" | "tls";

export interface SipTrunkSettings {
  enabled: boolean;
  provider: string;
  mode: SipTrunkMode;
  sipServer: string;
  outboundProxy: string;
  domain: string;
  username: string;
  authUsername: string;
  fromNumber: string;
  transport: SipTransport;
}

export interface WorkspaceSettings {
  id: "workspace_settings";
  workspaceName: string;
  publicBaseUrl: string;
  allowedOrigins: string[];
  allowPrivateToolUrls: boolean;
  redactToolSecrets: boolean;
  recordingRetentionDays: number;
  auditLogRetentionDays: number;
  realtimeSessionTtlSeconds: number;
  sipTrunk: SipTrunkSettings;
  createdAt: string;
  updatedAt: string;
}

export interface EvalCheck {
  type: "includes" | "excludes";
  value: string;
}

export interface EvalCase {
  id: string;
  input: string;
  checks: EvalCheck[];
}

export interface EvalDefinition {
  id: string;
  name: string;
  description: string;
  agentId: string;
  cases: EvalCase[];
  createdAt: string;
  updatedAt: string;
}

export interface EvalRunCaseResult {
  caseId: string;
  input: string;
  response: string;
  passed: boolean;
  checkResults: Array<EvalCheck & { passed: boolean }>;
  recommendation: string | null;
}

export interface EvalRun {
  id: string;
  evalId: string;
  agentId: string;
  status: EvalRunStatus;
  score: number;
  startedAt: string;
  completedAt: string;
  caseResults: EvalRunCaseResult[];
}

export interface Call {
  id: string;
  channel: "web" | "phone" | "simulation";
  direction: "inbound" | "outbound";
  agentId: string;
  phoneNumberId?: string | null;
  status: CallStatus;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  costEstimateUsd: number;
  recordingUrl: string | null;
  failureReason: string | null;
}

export interface CallEvent {
  id: string;
  callId: string;
  timestamp: string;
  type: "status" | "transcript" | "tool_call" | "audio" | "runtime" | "error";
  actor: "system" | "user" | "assistant" | "tool";
  payload: Record<string, unknown>;
  severity: "info" | "warning" | "error";
}

export type PolicyStatus = "active" | "expired" | "pending" | "cancelled" | "lapsed";
export type PolicyType =
  | "motor"
  | "property"
  | "health"
  | "life"
  | "marine"
  | "engineering"
  | "agriculture"
  | "micro"
  | "miscellaneous";

export interface Policy {
  id: string;
  customerId: string;
  policyNumber: string;
  type: PolicyType;
  status: PolicyStatus;
  insuredName: string;
  premium: number;
  sumInsured: number;
  startDate: string;
  endDate: string;
  renewalDueDate: string | null;
  claimCount: number;
  notes: string;
  cmsId: string | null;
  cmsSource: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "failed";
export type CampaignType = "renewal_reminder" | "claim_followup" | "survey" | "account_update" | "custom";

export interface CampaignContact {
  customerId: string;
  phoneNumber: string;
  name: string;
  policyId?: string | null;
  contextData?: Record<string, string>;
}

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  agentId: string;
  contacts: CampaignContact[];
  scheduledAt: string | null;
  completedAt: string | null;
  totalContacts: number;
  dialedCount: number;
  answeredCount: number;
  failedCount: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type CampaignRunStatus = "pending" | "dialing" | "connected" | "completed" | "failed" | "no_answer";

export interface CampaignRun {
  id: string;
  campaignId: string;
  customerId: string;
  callId: string | null;
  status: CampaignRunStatus;
  attemptCount: number;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CmsConfig {
  enabled: boolean;
  baseUrl: string;
  authMode: "none" | "bearer" | "api_key" | "basic";
  authValue: string;
  customerEndpoint: string;
  policyEndpoint: string;
  syncIntervalMinutes: number;
  lastSyncedAt: string | null;
  lastSyncStatus: "idle" | "running" | "success" | "failed";
  lastSyncError: string | null;
}
