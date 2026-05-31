import type {
  ConfiguredState,
  ModelRuntime,
  RuntimeAdapter,
  RuntimeHealthStatus,
  TtsProvider,
  TtsProviderAccess,
  Voice,
} from "./types";

interface ProviderDefinition {
  id: string;
  name: string;
  role: string;
  access: TtsProviderAccess;
  adapter: RuntimeAdapter;
  sourceUrl: string;
  license: string;
  languageSupport: string[];
  capabilities: string[];
  hardwareHints: string[];
  fallbackHealthStatus: RuntimeHealthStatus;
}

interface RuntimeOverlay {
  configuredState?: ConfiguredState;
  healthStatus?: RuntimeHealthStatus;
}

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "indic_parler_tts",
    name: "Indic Parler TTS",
    role: "best proven Nepali baseline",
    access: "open",
    adapter: "indic_parler",
    sourceUrl: "https://huggingface.co/ai4bharat/indic-parler-tts",
    license: "Apache-2.0",
    languageSupport: ["ne-NP", "hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN"],
    capabilities: ["Indic-language TTS", "speaker description control", "Nepali baseline"],
    hardwareHints: ["remote", "gpu"],
    fallbackHealthStatus: "missing_model",
  },
  {
    id: "omnivoice",
    name: "OmniVoice",
    role: "experimental multilingual and cloning candidate",
    access: "open",
    adapter: "omnivoice",
    sourceUrl: "https://github.com/k2-fsa/OmniVoice",
    license: "Apache-2.0",
    languageSupport: ["ne-NP", "multilingual"],
    capabilities: ["600+ language target", "zero-shot voice cloning", "voice design"],
    hardwareHints: ["remote", "gpu", "gguf"],
    fallbackHealthStatus: "missing_model",
  },
  {
    id: "chatterbox_nepali",
    name: "Chatterbox Nepali",
    role: "Nepali-specific cloning candidate",
    access: "gated",
    adapter: "chatterbox_nepali",
    sourceUrl: "https://huggingface.co/Imbatmann/chatterbox-nepali-tts",
    license: "MIT",
    languageSupport: ["ne-NP"],
    capabilities: ["Nepali fine-tune", "zero-shot cloning", "reference audio prompt"],
    hardwareHints: ["remote", "gpu", "hf-token"],
    fallbackHealthStatus: "license_required",
  },
  {
    id: "coqui_piper_vits",
    name: "Coqui VITS / Piper-VITS",
    role: "stable custom Nepali voice path",
    access: "custom_training",
    adapter: "piper",
    sourceUrl: "https://docs.coqui.ai/en/stable/models/vits.html",
    license: "model-dependent",
    languageSupport: ["ne-NP", "en-US"],
    capabilities: ["custom VITS training", "ONNX deployment", "stable production voice"],
    hardwareHints: ["cpu", "gpu", "onnx"],
    fallbackHealthStatus: "missing_model",
  },
];

export function listTtsProviders(input: {
  runtimes: ModelRuntime[];
  voices: Voice[];
  runtimeOverlays?: Partial<Record<RuntimeAdapter, RuntimeOverlay>>;
}): TtsProvider[] {
  return providerDefinitions.map((definition) => {
    const runtime = findRuntimeForProvider(definition, input.runtimes);
    const voice = runtime
      ? input.voices.find((candidate) => candidate.runtimeId === runtime.id && candidate.language.startsWith("ne")) ??
        input.voices.find((candidate) => candidate.runtimeId === runtime.id) ??
        null
      : null;
    const overlay = input.runtimeOverlays?.[definition.adapter];
    const healthStatus = overlay?.healthStatus ?? runtime?.healthStatus ?? definition.fallbackHealthStatus;
    const configuredState =
      overlay?.configuredState ?? runtime?.configuredState ?? healthConfiguredState(healthStatus);

    return {
      id: definition.id,
      name: definition.name,
      role: definition.role,
      access: definition.access,
      adapter: definition.adapter,
      runtimeId: runtime?.id ?? null,
      voiceId: voice?.id ?? null,
      configuredState,
      healthStatus,
      sourceUrl: definition.sourceUrl,
      license: definition.license,
      languageSupport: definition.languageSupport,
      capabilities: definition.capabilities,
      hardwareHints: definition.hardwareHints,
    };
  });
}

export function getTtsProviderDefinition(providerId: string): ProviderDefinition | null {
  return providerDefinitions.find((provider) => provider.id === providerId) ?? null;
}

function findRuntimeForProvider(definition: ProviderDefinition, runtimes: ModelRuntime[]) {
  if (definition.id === "coqui_piper_vits") {
    return runtimes.find((runtime) => runtime.kind === "tts" && runtime.adapter === "piper") ?? null;
  }

  return runtimes.find((runtime) => runtime.kind === "tts" && runtime.adapter === definition.adapter) ?? null;
}

function healthConfiguredState(healthStatus: RuntimeHealthStatus): ConfiguredState {
  return healthStatus === "healthy" || healthStatus === "unavailable" || healthStatus === "failed"
    ? "configured"
    : "not_configured";
}
