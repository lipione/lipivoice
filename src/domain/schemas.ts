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
  "whisper_cpp",
  "faster_whisper",
  "piper",
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

export const callSchema = z.object({
  id: z.string().min(1),
  channel: z.enum(["web", "phone", "simulation"]),
  direction: z.enum(["inbound", "outbound"]),
  agentId: z.string().min(1),
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
