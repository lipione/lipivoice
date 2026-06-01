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
  whisperCppBin: string;
  whisperModelPath: string;
  piperBin: string;
  piperVoicePath: string;
}

export function loadServerConfig(env = process.env): ServerConfig {
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
    whisperCppBin: env.WHISPER_CPP_BIN ?? "",
    whisperModelPath: env.WHISPER_MODEL_PATH ?? "",
    piperBin: env.PIPER_BIN ?? "",
    piperVoicePath: env.PIPER_VOICE_PATH ?? "",
  };
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 8787);

  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8787;
}

function parseRuntimePreset(value: string | undefined): "local" | "remote" {
  return value === "remote" ? "remote" : "local";
}
