export type RuntimeKind = "llm" | "stt" | "tts" | "vad" | "embedding";
export type RuntimeAdapter =
  | "ollama"
  | "vllm"
  | "whisper_cpp"
  | "faster_whisper"
  | "piper"
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
