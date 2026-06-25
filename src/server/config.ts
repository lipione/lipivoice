export interface ServerConfig {
  port: number;
  databasePath: string;
  runtimePreset: "local" | "remote";
  ollamaBaseUrl: string;
  ollamaModel: string;
  vllmBaseUrl: string;
  vllmModel: string;
  lipiMlBaseUrl: string;
  ttsModelManifestPath: string;
  googleTtsCredentialsPath: string;
  googleLlmCredentialsPath: string;
  googleLlmModel: string;
  googleTtsLanguageCode: string;
  googleTtsModel: string;
  googleTtsVoiceName: string;
  whisperCppBin: string;
  whisperModelPath: string;
  piperBin: string;
  piperVoicePath: string;
  piperHttpEndpoint: string;
  coquiHttpEndpoint: string;
  fastPitchHttpEndpoint: string;
  indicParlerEndpoint: string;
  fasterWhisperEndpoint: string;
  livekitWsUrl: string;
  livekitApiUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitAgentName: string;
  workerApiKey: string;
  adminToken: string;
  adminUsername: string;
  adminPassword: string;
  publicBaseUrl: string;
}

export function loadServerConfig(env = process.env): ServerConfig {
  const livekitWsUrl = trimTrailingSlash(env.LIVEKIT_URL ?? "");

  return {
    port: parsePort(env.PORT),
    databasePath: env.LIPIVOICE_DB_PATH ?? "data/lipivoice.sqlite",
    runtimePreset: parseRuntimePreset(env.LIPIVOICE_RUNTIME_PRESET),
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    ollamaModel: env.LIPIVOICE_LLM_MODEL ?? "llama3.2:3b",
    vllmBaseUrl: env.VLLM_BASE_URL ?? "",
    vllmModel: env.VLLM_MODEL ?? env.LIPIVOICE_LLM_MODEL ?? "gemma-4",
    lipiMlBaseUrl: env.LIPI_ML_BASE_URL ?? "",
    ttsModelManifestPath: env.LIPIVOICE_TTS_MODEL_MANIFEST ?? "",
    googleTtsCredentialsPath: env.GOOGLE_TTS_CREDENTIALS_PATH ?? env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
    googleLlmCredentialsPath:
      env.GOOGLE_LLM_CREDENTIALS_PATH ?? env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
    googleLlmModel: env.GOOGLE_LLM_MODEL ?? "gemini-2.5-flash",
    googleTtsLanguageCode: normalizeGoogleLanguageCode(env.GOOGLE_TTS_LANGUAGE_CODE ?? "ne-NP"),
    googleTtsModel: env.GOOGLE_TTS_MODEL ?? "",
    googleTtsVoiceName: resolveGoogleTtsVoiceName(env),
    whisperCppBin: env.WHISPER_CPP_BIN ?? "",
    whisperModelPath: env.WHISPER_MODEL_PATH ?? "",
    piperBin: env.PIPER_BIN ?? "",
    piperVoicePath: env.PIPER_VOICE_PATH ?? "",
    piperHttpEndpoint: env.PIPER_HTTP_ENDPOINT ?? "http://localhost:5002",
    coquiHttpEndpoint: env.COQUI_HTTP_ENDPOINT ?? "http://localhost:5003",
    fastPitchHttpEndpoint: env.FASTPITCH_HTTP_ENDPOINT ?? "http://localhost:5004",
    indicParlerEndpoint: env.INDIC_PARLER_ENDPOINT ?? "http://localhost:5010",
    fasterWhisperEndpoint: env.FASTER_WHISPER_ENDPOINT ?? "http://localhost:9000",
    livekitWsUrl,
    livekitApiUrl: trimTrailingSlash(env.LIVEKIT_API_URL ?? deriveLiveKitApiUrl(livekitWsUrl)),
    livekitApiKey: env.LIVEKIT_API_KEY ?? "",
    livekitApiSecret: env.LIVEKIT_API_SECRET ?? "",
    livekitAgentName: env.LIVEKIT_AGENT_NAME ?? "lipivoice-receptionist",
    workerApiKey: env.LIPIVOICE_WORKER_API_KEY ?? "",
    adminToken: env.LIPIVOICE_ADMIN_TOKEN ?? "",
    adminUsername: env.LIPIVOICE_ADMIN_USERNAME ?? "admin",
    adminPassword: env.LIPIVOICE_ADMIN_PASSWORD ?? "",
    publicBaseUrl: trimTrailingSlash(env.LIPIVOICE_PUBLIC_BASE_URL ?? ""),
  };
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 8787);

  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8787;
}

function parseRuntimePreset(value: string | undefined): "local" | "remote" {
  return value === "remote" ? "remote" : "local";
}

function normalizeGoogleLanguageCode(value: string): string {
  const normalized = value.trim();

  return normalized.toLowerCase() === "ne" ? "ne-NP" : normalized;
}

function resolveGoogleTtsVoiceName(env: NodeJS.ProcessEnv): string {
  const languageCode = normalizeGoogleLanguageCode(env.GOOGLE_TTS_LANGUAGE_CODE ?? "ne-NP").toLowerCase();

  if (languageCode.startsWith("ne") && env.GOOGLE_TTS_VOICE_NE) {
    return env.GOOGLE_TTS_VOICE_NE;
  }

  return env.GOOGLE_TTS_VOICE_NAME ?? "";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveLiveKitApiUrl(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) {
    return `https://${wsUrl.slice("wss://".length)}`;
  }

  if (wsUrl.startsWith("ws://")) {
    return `http://${wsUrl.slice("ws://".length)}`;
  }

  return "";
}
