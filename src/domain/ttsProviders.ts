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
  preferredVoiceId?: string;
}

interface RuntimeOverlay {
  configuredState?: ConfiguredState;
  healthStatus?: RuntimeHealthStatus;
}

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "piper_http_tts",
    name: "Piper HTTP TTS",
    role: "fast self-hosted Nepali TTS",
    access: "open",
    adapter: "piper_http",
    sourceUrl: "https://github.com/rhasspy/piper",
    license: "MIT",
    languageSupport: ["ne-NP", "en-US"],
    capabilities: ["fast CPU inference", "custom ONNX voices", "HTTP API"],
    hardwareHints: ["cpu", "local", "http"],
    fallbackHealthStatus: "missing_model",
    preferredVoiceId: "voice_piper_ne_sita",
  },
  {
    id: "coqui_xtts",
    name: "Coqui XTTS",
    role: "expressive multilingual TTS with voice cloning",
    access: "open",
    adapter: "coqui_http",
    sourceUrl: "https://github.com/coqui-ai/TTS",
    license: "Coqui Public Model License",
    languageSupport: ["ne", "en", "multilingual"],
    capabilities: ["multilingual", "voice cloning", "expressive"],
    hardwareHints: ["gpu", "http"],
    fallbackHealthStatus: "missing_model",
    preferredVoiceId: "voice_coqui_ne_anju",
  },
  {
    id: "fastpitch_tts",
    name: "FastPitch TTS",
    role: "GPU-accelerated Nepali TTS",
    access: "open",
    adapter: "fastpitch_http",
    sourceUrl: "https://github.com/NVIDIA/NeMo",
    license: "Apache-2.0",
    languageSupport: ["ne-NP"],
    capabilities: ["GPU-accelerated", "multi-speaker", "fine-tunable"],
    hardwareHints: ["gpu", "http"],
    fallbackHealthStatus: "missing_model",
    preferredVoiceId: "voice_fastpitch_ne_nabin",
  },
  {
    id: "indic_parler_tts",
    name: "Indic Parler Nepali",
    role: "Nepali fine-tuned Parler-TTS evaluation candidate",
    access: "open",
    adapter: "indic_parler",
    sourceUrl: "https://huggingface.co/milanakdj/indic-parler-tts-nepali-finetuned-dgx-v9-cosine",
    license: "license-unconfirmed",
    languageSupport: ["ne-NP"],
    capabilities: ["Nepali fine-tune", "speaker description control", "44.1 kHz output"],
    hardwareHints: ["remote", "gpu", "hf-model", "evaluation"],
    fallbackHealthStatus: "missing_model",
    preferredVoiceId: "voice_indic_parler_ne_amrita",
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
    name: "LipiVoice Studio",
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
      ? input.voices.find((candidate) => candidate.id === definition.preferredVoiceId && candidate.runtimeId === runtime.id) ??
        input.voices.find((candidate) => candidate.runtimeId === runtime.id && candidate.language.startsWith("ne")) ??
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

  return (
    runtimes.find((runtime) => runtime.kind === "tts" && runtime.adapter === definition.adapter) ?? null
  );
}

function healthConfiguredState(healthStatus: RuntimeHealthStatus): ConfiguredState {
  return healthStatus === "healthy" || healthStatus === "unavailable" || healthStatus === "failed"
    ? "configured"
    : "not_configured";
}
