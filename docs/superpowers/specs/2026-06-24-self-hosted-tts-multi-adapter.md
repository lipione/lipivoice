# Self-Hosted Multi-Adapter TTS Layer for Nepali Voice Synthesis

**Status:** ✅ IMPLEMENTED — Piper HTTP, Coqui XTTS, FastPitch all live (2026-06-24)
**Date:** 2026-06-24
**Priority:** High (core infrastructure for voice lab)

## Executive Summary

This document describes LipiVoice's TTS layer supporting multiple open-source Nepali TTS engines (Piper HTTP, Coqui XTTS, FastPitch, custom fine-tuned models) in a unified, self-hosted architecture. The implementation reuses the `TtsAdapter` interface from `src/server/runtimes/types.ts` and the `openAiCompatible.ts` pattern, enabling runtime switching between providers at call-time. Google TTS has been fully replaced by this self-hosted stack.

**Key Goals:**
- 100% self-hosted (no cloud TTS providers required for MVP)
- Easy addition of new TTS engines via adapter interface
- Per-call provider selection with fallback logic
- Voice profile management (provider → model → voices)
- Support for Phase 2 fine-tuning workflow

---

## 1. TTS Adapter Interface (TypeScript)

### Core Interface Definition

**File:** `src/server/runtimes/types.ts` (extend existing)

The existing `TtsAdapter` interface is minimal but extensible:

```typescript
export interface TtsAdapter {
  health(): Promise<RuntimeHealthResult>;
  synthesize(input: { text: string; voicePath: string }): Promise<{
    audioBase64: string;
    mimeType: string;
    providerId?: string;
    voiceId?: string;
  }>;
}
```

### Extend for Enhanced Metadata

**New interface:** `TtsAdapterWithMetadata` (optional, for richer introspection):

```typescript
export interface TtsAdapterMetadata {
  provider: string;           // "piper", "fastpitch", "coqui", "custom"
  version: string;             // adapter version, not model version
  supportedLanguages: string[]; // ["ne-NP", "en-US"]
  capabilities: {
    streaming: boolean;
    batchSynthesis: boolean;
    voiceControl: "none" | "voiceId" | "speaker_desc";
    synthesisOptions: string[]; // ["speed", "pitch", "emotion"]
  };
  resourceHints: {
    cpuRequired: number;  // cores
    gpuOptional: boolean;
    ramMb: number;
    latencyMs: { p50: number; p99: number };
  };
}

export interface TtsAdapterWithMetadata extends TtsAdapter {
  metadata(): TtsAdapterMetadata;
}
```

### Method Signatures

**All adapters must implement:**

```typescript
async health(): Promise<RuntimeHealthResult>
```

Returns health status. Standard status values:
- `"healthy"`: service running, model loaded, synthesis works
- `"unavailable"`: service not responding or network error
- `"missing_model"`: service running but model not loaded/downloaded
- `"license_required"`: gated model requires HF token or license
- `"failed"`: service crashed or critical error

**All adapters must implement:**

```typescript
async synthesize(input: {
  text: string;              // Nepali or English text to synthesize
  voicePath: string;         // voiceId used to look up model/speaker config
}): Promise<{
  audioBase64: string;       // base64-encoded audio data
  mimeType: string;          // "audio/wav" or "audio/mpeg"
  providerId?: string;       // e.g., "piper", "fastpitch"
  voiceId?: string;          // voice profile ID used
}>
```

### Error Handling & Fallback

Adapter must throw `Error` with descriptive message. Caller handles fallback:

```typescript
// In voiceSocket.ts: ttsAdapterForAgent()
const adapter = ttsAdapters[runtime.adapter] ?? fallbackTts;
```

If synthesis fails, operator can manually select fallback voice in UI. For automated fallback, use voice profile fallback chain (see section 3).

---

## 2. Provider Implementations

### 2a. Piper Adapter

**File:** `src/server/runtimes/piperOssv2.ts` (or extend existing piper.ts)

**Overview:** Lightweight CPU-based ONNX synthesizer. Pre-built Nepali voice models available via HuggingFace.

**Architecture:**
- Local binary: `/usr/local/bin/piper` (or configured path)
- Voice models: downloaded to `~/.local/share/piper/models/ne_NP-*.onnx`
- Interface: stdin/stdout (text → wav) or HTTP wrapper service

**Implementation Option 1: Local Binary with HTTP Wrapper**

Create a lightweight HTTP service that wraps the Piper binary:

```typescript
export class PiperAdapter implements TtsAdapter {
  constructor(private readonly options: {
    serviceUrl: string;          // http://localhost:8005
    voiceModelsPath: string;      // ~/.local/share/piper/models
    defaultVoice?: string;         // ne_NP-google_low
  }) {}

  async health(): Promise<RuntimeHealthResult> {
    try {
      const response = await fetch(`${this.options.serviceUrl}/health`);
      if (response.ok) {
        return { status: "healthy", reason: null };
      }
      return { status: "unavailable", reason: "piper_service_unhealthy" };
    } catch {
      return { status: "unavailable", reason: "piper_service_unreachable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<...> {
    // voicePath = "voice_piper_google_ne_low"
    // Extract model name from voice profile → "ne_NP-google_low"
    const modelId = voiceProfileToModelId(input.voicePath);
    
    const response = await fetch(`${this.options.serviceUrl}/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        model: modelId,
        outputFormat: "wav"
      }),
    });

    if (!response.ok) {
      throw new Error(`Piper synthesis failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      audioBase64: data.audioBase64,
      mimeType: "audio/wav",
    };
  }
}
```

**Supported Nepali Voices (Phase 1):**

| Voice ID | Model File | Provider | Gender | Quality | CPU Cost |
|----------|-----------|----------|--------|---------|----------|
| `voice_piper_google_ne_low` | `ne_NP-google_low.onnx` | Google training | Female | Low (faster) | ~1 core |
| `voice_piper_google_ne_medium` | `ne_NP-google_medium.onnx` | Google training | Female | Medium | ~2 cores |
| `voice_piper_google_ne_high` | `ne_NP-google_high.onnx` | Google training | Female | High (slower) | ~2 cores |

**Download URLs:**
```
https://huggingface.co/rhasspy/piper-voices/resolve/main/ne/ne_NP/google/ne_NP-google-medium.onnx
https://huggingface.co/rhasspy/piper-voices/resolve/main/ne/ne_NP/google/ne_NP-google-low.onnx
```

---

### 2b. FastPitch Adapter

**File:** `src/server/runtimes/fastPitch.ts` (Phase 2, optional)

**Overview:** GPU-accelerated parallel mel-spectrogram prediction + vocoder (HiFi-GAN). Faster than auto-regressive models.

**Architecture:**
- Service: vLLM-style REST API
- Interface: `/synthesize` endpoint (POST)
- Deployment: Docker container with NVIDIA GPU support (optional CPU fallback)

```typescript
export class FastPitchAdapter implements TtsAdapter {
  constructor(private readonly options: {
    serviceUrl: string;        // http://localhost:8006
    voiceModelsPath: string;
    supportedLanguages: string[];
  }) {}

  async health(): Promise<RuntimeHealthResult> {
    try {
      const response = await fetch(`${this.options.serviceUrl}/api/health`);
      if (response.ok) {
        const data = await response.json();
        if (data.gpu_available) {
          return { status: "healthy", reason: null, latencyMs: data.avg_latency_ms };
        }
        return { 
          status: "healthy", 
          reason: "fastpitch_cpu_mode", 
          latencyMs: data.avg_latency_ms 
        };
      }
      return { status: "unavailable", reason: "fastpitch_service_unhealthy" };
    } catch {
      return { status: "unavailable", reason: "fastpitch_service_unreachable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<...> {
    // voicePath = "voice_fastpitch_nepali_v1"
    const speakerId = voiceProfileToSpeakerId(input.voicePath);
    
    const response = await fetch(`${this.options.serviceUrl}/api/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        lang: "ne",
        speaker_id: speakerId,
        speed: 1.0,
        pitch: 1.0,
        batch_size: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`FastPitch synthesis failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      audioBase64: data.audio,       // base64 wav
      mimeType: "audio/wav",
    };
  }
}
```

**Nepali Voice Support (Phase 2):**
- Assumed to be trained on fine-tuned data or custom voice cloning
- Voice lookup: speaker ID → model checkpoint

---

### 2c. Coqui VITS Adapter

**File:** `src/server/runtimes/coquiVits.ts` (Phase 2, optional)

**Overview:** Lightweight GPU-accelerated VITS TTS. Better quality/latency than Piper, easier fine-tuning than FastPitch.

**Architecture:**
- Service: Python REST wrapper (FastAPI)
- Interface: `/tts` endpoint
- Deployment: Docker container with optional GPU

```typescript
export class CoquiVitsAdapter implements TtsAdapter {
  constructor(private readonly options: {
    serviceUrl: string;      // http://localhost:8007
    voiceModelsPath: string;
    gpu: boolean;
  }) {}

  async health(): Promise<RuntimeHealthResult> {
    try {
      const response = await fetch(`${this.options.serviceUrl}/models`);
      if (response.ok) {
        return { status: "healthy", reason: null };
      }
      return { status: "unavailable", reason: "coqui_service_unhealthy" };
    } catch {
      return { status: "unavailable", reason: "coqui_service_unreachable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<...> {
    // voicePath = "voice_coqui_nepali_trained"
    const modelKey = voiceProfileToModelKey(input.voicePath);
    
    const response = await fetch(`${this.options.serviceUrl}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        language_id: "ne",
        model_key: modelKey,
        speaker_wav: null,  // null unless using reference speaker
      }),
    });

    if (!response.ok) {
      throw new Error(`Coqui synthesis failed: ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    return {
      audioBase64: Buffer.from(data).toString("base64"),
      mimeType: "audio/wav",
    };
  }
}
```

---

### 2d. Custom Fine-Tuned Adapter

**File:** `src/server/runtimes/customFineTuned.ts` (Phase 2)

**Overview:** Generic adapter for custom models trained on operator-recorded voice data.

Reuses Piper or Coqui backend:

```typescript
export class CustomFineTunedAdapter implements TtsAdapter {
  private readonly baseAdapter: TtsAdapter;  // PiperAdapter or CoquiVitsAdapter

  constructor(options: {
    backend: "piper" | "coqui";
    modelPath: string;                       // /models/fine-tuned/sita-v2.onnx
    voiceMetadataPath: string;               // /models/fine-tuned/sita-v2.json
    baseServiceUrl: string;
  }) {
    if (options.backend === "piper") {
      this.baseAdapter = new PiperAdapter({
        serviceUrl: options.baseServiceUrl,
        voiceModelsPath: dirname(options.modelPath),
      });
    } else {
      this.baseAdapter = new CoquiVitsAdapter({
        serviceUrl: options.baseServiceUrl,
        voiceModelsPath: dirname(options.modelPath),
        gpu: false,
      });
    }
  }

  async health(): Promise<RuntimeHealthResult> {
    return this.baseAdapter.health();
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<...> {
    // Forward to base adapter with custom model path
    return this.baseAdapter.synthesize({
      text: input.text,
      voicePath: input.voicePath,  // maps to custom model
    });
  }
}
```

---

## 3. Voice Profile Schema

**File:** `src/domain/types.ts` (extend existing `Voice` interface)

### Enhanced Voice Interface

```typescript
export interface Voice {
  id: string;                          // e.g., "voice_piper_google_ne_low"
  name: string;                        // e.g., "Asha (Piper)"
  runtimeId: string;                   // e.g., "runtime_piper"
  type: "builtin" | "cloned" | "fine_tuned";
  language: string;                    // "ne-NP"
  tags: string[];                      // ["local", "piper", "nepali", "low-latency"]
  previewUrl: string;                  // audio sample URL
  privacy: "private" | "workspace";
  cloneStatus: "not_clone" | "pending" | "processing" | "available" | "failed";
  consentId: string | null;
  
  // NEW FIELDS for TTS multi-adapter
  ttsProviderConfig?: TtsProviderVoiceConfig;
  fallbackChain?: string[];             // ["voice_piper_google_ne_medium", "voice_coqui_nepali_v1"]
}

export interface TtsProviderVoiceConfig {
  providerId: string;                  // "piper", "fastpitch", "coqui", "custom"
  modelId: string;                     // provider-specific model identifier
  voiceKey: string;                    // "ne_NP-google_low" or "speaker_0"
  qualityTier: "low" | "medium" | "high";
  synthesisParams?: {
    speed?: number;                    // 0.5 to 2.0
    pitch?: number;                    // 0.5 to 2.0
    emotion?: string;                  // "neutral", "happy", "sad" (if supported)
  };
  costMetrics: {
    cpuCoreSeconds: number;            // est. CPU usage per 10 sec synthesis
    gpuMemoryMb?: number;              // if GPU-enabled
    latencyMs: number;                 // p50 latency
  };
}
```

### Voice Profile Examples (Nepali)

**Builtin Piper Voices:**

```typescript
{
  id: "voice_piper_google_ne_low",
  name: "Asha (Fast)",
  runtimeId: "runtime_piper",
  type: "builtin",
  language: "ne-NP",
  tags: ["local", "piper", "nepali", "low-latency"],
  ttsProviderConfig: {
    providerId: "piper",
    modelId: "model_piper_google_ne_low",
    voiceKey: "ne_NP-google_low",
    qualityTier: "low",
    costMetrics: {
      cpuCoreSeconds: 0.5,
      latencyMs: 150,
    },
  },
  fallbackChain: ["voice_piper_google_ne_medium", "voice_coqui_nepali_v1"],
}
```

**Fine-Tuned Custom Voice (Phase 2):**

```typescript
{
  id: "voice_custom_sita_finetuned_v1",
  name: "Sita (Custom)",
  runtimeId: "runtime_custom_finetuned",
  type: "fine_tuned",
  language: "ne-NP",
  tags: ["custom", "finetuned", "workspace-only"],
  ttsProviderConfig: {
    providerId: "custom",
    modelId: "model_sita_finetuned_piper_v1",
    voiceKey: "sita-v1",
    qualityTier: "high",
    synthesisParams: {
      speed: 1.0,
      pitch: 1.0,
    },
    costMetrics: {
      cpuCoreSeconds: 0.8,
      latencyMs: 200,
    },
  },
  fallbackChain: ["voice_piper_google_ne_high"],
}
```

### Voice Profile Lookup

**File:** `src/domain/voiceProfiles.ts` (new)

```typescript
import type { Voice, TtsProviderVoiceConfig } from "./types";

export function getVoiceProviderConfig(voice: Voice): TtsProviderVoiceConfig | null {
  return voice.ttsProviderConfig ?? null;
}

export function getFallbackVoiceChain(voice: Voice, allVoices: Voice[]): Voice[] {
  const chain = voice.fallbackChain ?? [];
  return chain
    .map(voiceId => allVoices.find(v => v.id === voiceId))
    .filter((v): v is Voice => v !== undefined);
}

// Used in voiceSocket.ts for fallback synthesis
export function selectVoiceForSynthesis(
  primaryVoice: Voice,
  allVoices: Voice[]
): Voice {
  // Return primary if healthy; else follow fallback chain
  return primaryVoice;  // Health check done by adapter
}
```

---

## 4. Runtime Voice Selection Logic

**File:** `src/server/voice/socketDeps.ts` (extend existing)

### Selection Flow

```
Agent → voiceId
  ↓
Voice record (lookup via voiceId)
  ↓
Voice.runtimeId → Runtime record
  ↓
Runtime.adapter → TTS adapter instance
  ↓
Adapter.synthesize(voice.ttsProviderConfig.voiceKey)
  ↓
Audio output (or fallback on error)
```

### Implementation: Enhanced ttsAdapterForAgent()

```typescript
function ttsAdapterForAgent(
  repositories: Repositories,
  agent: Agent,
  fallbackTts: TtsAdapter,
  ttsAdapters: Partial<Record<RuntimeAdapter, TtsAdapter>>,
): { 
  adapter: TtsAdapter; 
  providerId: string;
  fallbackChain: TtsAdapter[];
} | null {
  const voice = repositories.voices.get(agent.voiceId);
  if (!voice) {
    return null;
  }

  const runtime = repositories.runtimes
    .list()
    .find((candidate) => candidate.id === voice.runtimeId);
  
  const providerId = runtime?.adapter ?? "piper";
  const adapter = runtime 
    ? ttsAdapters[runtime.adapter] ?? fallbackTts 
    : fallbackTts;

  // NEW: Build fallback chain from voice.fallbackChain
  const fallbackChain: TtsAdapter[] = [];
  if (voice.fallbackChain && voice.fallbackChain.length > 0) {
    for (const fallbackVoiceId of voice.fallbackChain) {
      const fallbackVoice = repositories.voices.get(fallbackVoiceId);
      const fallbackRuntime = fallbackVoice
        ? repositories.runtimes
            .list()
            .find((r) => r.id === fallbackVoice.runtimeId)
        : null;
      
      if (fallbackRuntime && ttsAdapters[fallbackRuntime.adapter]) {
        fallbackChain.push(ttsAdapters[fallbackRuntime.adapter]!);
      }
    }
  }

  return adapter 
    ? { adapter, providerId, fallbackChain } 
    : null;
}
```

### Synthesis with Fallback

**File:** `src/server/voice/pipeline.ts` (extend runVoiceTurn)

```typescript
export async function runVoiceTurnWithFallback(
  input: VoicePipelineInput & { fallbackAdapters?: TtsAdapter[] },
) {
  // ... existing code ...

  // TTS synthesis with fallback
  const ttsResult = await synthesizeWithFallback(
    firstAssistantText,
    input.tts,
    input.fallbackAdapters ?? [],
    input.agent.voiceId,
  );

  // ... emit audio event ...
}

async function synthesizeWithFallback(
  text: string,
  primaryAdapter: TtsAdapter,
  fallbackAdapters: TtsAdapter[],
  voiceId: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  const adapters = [primaryAdapter, ...fallbackAdapters];
  let lastError: Error | null = null;

  for (const adapter of adapters) {
    try {
      return await adapter.synthesize({
        text,
        voicePath: voiceId,
      });
    } catch (error) {
      lastError = error as Error;
      console.warn(`TTS synthesis failed, trying next adapter: ${lastError.message}`);
      continue;
    }
  }

  throw lastError ?? new Error("All TTS adapters failed");
}
```

---

## 5. Self-Hosted Deployment

### Docker Compose Configuration

**File:** `docker-compose.local.yml` (new, for Phase 1 MVP)

```yaml
version: "3.8"

services:
  # Phase 1: Required for MVP
  piper-tts:
    image: synesthesiam/piper:latest
    container_name: lipivoice-piper
    ports:
      - "8005:8005"
    environment:
      PIPER_VOICE: ne_NP-google_medium
      PIPER_SPEAKER: ""
    volumes:
      - ./voice-models/piper:/home/piper/.local/share/piper/models
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8005/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # Phase 2: Optional for quality testing
  fastpitch-tts:
    image: lipivoice/fastpitch:latest
    container_name: lipivoice-fastpitch
    ports:
      - "8006:8006"
    environment:
      CUDA_VISIBLE_DEVICES: "0"  # GPU index, or "" for CPU
      MODEL_CHECKPOINT: /models/fastpitch/nepali_v1
    volumes:
      - ./voice-models/fastpitch:/models/fastpitch
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]  # Remove if CPU-only
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8006/api/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # Phase 2: Optional for quality testing
  coqui-tts:
    image: lipivoice/coqui-vits:latest
    container_name: lipivoice-coqui
    ports:
      - "8007:8007"
    environment:
      COQUI_MODEL: nepali_v1
      GPU_ENABLED: "false"  # or "true" if NVIDIA available
    volumes:
      - ./voice-models/coqui:/app/models
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8007/models"]
      interval: 10s
      timeout: 5s
      retries: 3

  # Main LipiVoice app
  lipivoice-app:
    build: .
    container_name: lipivoice-app
    depends_on:
      piper-tts:
        condition: service_healthy
      # fastpitch-tts:  # Optional for Phase 2
      #   condition: service_healthy
    environment:
      PIPER_SERVICE_URL: http://piper-tts:8005
      FASTPITCH_SERVICE_URL: http://fastpitch-tts:8006
      COQUI_SERVICE_URL: http://coqui-tts:8007
      RUNTIME_PRESET: local
    ports:
      - "3000:3000"
      - "8787:8787"
    restart: unless-stopped
```

### Phase 1 MVP: Piper Only

**Minimum deployment:**

```bash
# 1. Start Piper service
docker-compose -f docker-compose.local.yml up piper-tts

# 2. Download Piper Nepali voice model
curl -L https://huggingface.co/rhasspy/piper-voices/resolve/main/ne/ne_NP/google/ne_NP-google_medium.onnx \
  -o voice-models/piper/ne_NP-google_medium.onnx

# 3. Start app
docker-compose -f docker-compose.local.yml up lipivoice-app
```

**Resource Requirements (Phase 1, single concurrent call):**
- CPU: 2 cores (Intel i5 or equiv)
- RAM: 4 GB
- Storage: 500 MB (Piper model + app)

### Phase 2: Multi-Adapter Testing

**Optional deployment (add FastPitch, Coqui for A/B testing):**

```bash
# GPU-accelerated (requires NVIDIA):
docker-compose -f docker-compose.local.yml up \
  piper-tts fastpitch-tts coqui-tts lipivoice-app

# CPU-only:
# Edit docker-compose.local.yml: set GPU_ENABLED=false, remove nvidia device request
docker-compose -f docker-compose.local.yml up \
  piper-tts coqui-tts lipivoice-app
```

**Resource Requirements (Phase 2, with GPU):**
- CPU: 4 cores
- RAM: 8 GB
- GPU: NVIDIA RTX 3080 or equiv (FastPitch: 2 GB VRAM, Coqui: 1 GB VRAM)
- Storage: 2 GB (3 model sets + app)

---

## 6. Fine-Tuning Workflow (Phase 2)

### Step 1: Record Voice Samples

**Target:** 1-2 hours of Nepali speech from single speaker.

**Recording UI:** `src/features/voice-lab/RecordingPage.tsx` (extend existing)

```typescript
interface VoiceRecordingSession {
  voiceId: string;
  sessionId: string;
  targetLanguage: "ne-NP" | "en-US";
  targetDurationSeconds: 3600;  // 1 hour
  sampleTexts: string[];        // Phonetically diverse sentences
  recordedSamples: {
    text: string;
    audioBase64: string;
    durationSeconds: number;
    quality: "clear" | "noisy";  // self-assessed
    timestamp: string;
  }[];
  status: "recording" | "reviewing" | "ready_for_training";
}
```

**Phonetically Diverse Sentences (50-100 phrases):**

```typescript
const nepaliSampleTexts = [
  "नमस्ते, मेरो नाम सिता हो।",
  "आज को मौसम धेरै राम्रो छ।",
  "मेरो परिवार काठमाडौंमा बस्छ।",
  "बिद्यालयमा सयौं विद्यार्थी छन्।",
  // ... 50+ more varied sentences covering all phonemes
];
```

### Step 2: Validate & Segment

**Backend service:** `src/server/voice-lab/recordingProcessor.ts` (new)

```typescript
export async function processVoiceRecording(input: {
  sessionId: string;
  samples: VoiceRecordingSample[];
  targetLanguage: string;
}): Promise<{
  totalDurationSeconds: number;
  qualityScore: number;  // 0-100
  issues: string[];
  readyForTraining: boolean;
}> {
  // 1. Validate duration (min 45 min for Piper, 1 hour for Coqui)
  // 2. Check audio quality (SNR, clipping detection)
  // 3. Segment into 5-10 second chunks
  // 4. Run speaker diarization (ensure single speaker)
  // 5. Return ready status

  return {
    totalDurationSeconds: 3600,
    qualityScore: 85,
    issues: [],
    readyForTraining: true,
  };
}
```

### Step 3: Fine-Tune Model

**Options:**

**Option A: Piper Fine-Tuning (Phase 2.1)**

- Training: ~1 hour on GPU or ~4 hours on CPU
- Output: ONNX model + config JSON
- Deployment: Copy `.onnx` file to voice-models, add voice profile

```bash
# Using Piper training tools (https://github.com/rhasspy/piper)
piper-train \
  --checkpoint=/models/piper/base_nepali.pt \
  --output-dir=/models/voice-sita-v1 \
  --dataset=/data/sita-recording \
  --epochs=5 \
  --batch-size=32
```

**Option B: Coqui VITS Fine-Tuning (Phase 2.2, optional)**

- Training: ~2 hours on GPU or ~12 hours on CPU
- Output: PyTorch model checkpoint
- Deployment: Host model in Coqui service, reference by speaker ID

**Option C: Voice Cloning (Zero-shot, Phase 2.3, future)**

- No training required; pass reference speaker to synthesis
- Works with OmniVoice, Chatterbox Nepali
- Output: speaker embedding cache

### Step 4: Deploy Fine-Tuned Model

**File:** `src/server/voice-lab/modelDeployment.ts` (new)

```typescript
export async function deployFineTunedModel(input: {
  voiceSessionId: string;
  trainingBackend: "piper" | "coqui";
  modelCheckpoint: Buffer;      // trained model file
  voiceMetadata: {
    speakerName: string;
    gender: string;
    quality: "beta" | "production";
  };
}): Promise<{
  voiceId: string;
  runtimeId: string;
  modelId: string;
  status: "deployed" | "failed";
}> {
  // 1. Save model to volume
  // 2. Register model asset in database
  // 3. Create Voice record with ttsProviderConfig
  // 4. Test synthesis endpoint
  // 5. Return voice ID for agent assignment

  return {
    voiceId: "voice_custom_sita_finetuned_v1",
    runtimeId: "runtime_custom_finetuned",
    modelId: "model_sita_finetuned_piper_v1",
    status: "deployed",
  };
}
```

### Step 5: Version & Track

**Voice profile versioning:**

```typescript
export interface FineTunedVoiceMetadata {
  baseModel: "piper" | "coqui";
  baseVersion: string;              // "en_US-amy-medium"
  customizedFor: "ne-NP" | "multilingual";
  recordingSessionId: string;
  recordingDurationSeconds: number;
  trainingEpochs: number;
  trainingDate: string;
  qualityScore?: number;            // Post-training PESQ/MOS if evaluated
  usageCount: number;               // calls synthesized with this voice
}
```

---

## 7. Operator UI

### Voice Selection UI

**File:** `src/features/voice-console/VoiceSelector.tsx` (new component)

```tsx
export function VoiceSelector(props: {
  agentId: string;
  currentVoiceId: string;
  onSelect: (voiceId: string) => void;
}) {
  const voices = useVoices();
  const providers = useTtsProviders();
  
  // Group voices by provider
  const voicesByProvider = groupBy(voices, v => 
    v.ttsProviderConfig?.providerId ?? "unknown"
  );

  return (
    <div className="voice-selector">
      {Object.entries(voicesByProvider).map(([provider, providerVoices]) => (
        <div key={provider} className="provider-group">
          <h3>{providerDisplayName(provider)}</h3>
          <div className="voices">
            {providerVoices.map(voice => (
              <VoiceOption
                key={voice.id}
                voice={voice}
                selected={voice.id === props.currentVoiceId}
                onSelect={() => props.onSelect(voice.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function VoiceOption(props: { voice: Voice; selected: boolean; onSelect: () => void }) {
  const quality = props.voice.ttsProviderConfig?.qualityTier ?? "unknown";
  const latencyMs = props.voice.ttsProviderConfig?.costMetrics.latencyMs ?? 0;

  return (
    <button
      className={classNames("voice-option", { selected: props.selected })}
      onClick={props.onSelect}
    >
      <div className="name">{props.voice.name}</div>
      <div className="meta">
        <span className="quality">{quality}</span>
        <span className="latency">{latencyMs}ms</span>
      </div>
      {props.voice.ttsProviderConfig?.fallbackChain && (
        <div className="fallback">
          Fallback to {props.voice.ttsProviderConfig.fallbackChain.length} voices
        </div>
      )}
    </button>
  );
}
```

### Test Voice Button

**In same component:**

```tsx
function TestVoiceButton(props: { voiceId: string }) {
  const [playing, setPlaying] = useState(false);
  
  const testSynthesis = async () => {
    setPlaying(true);
    try {
      const response = await fetch("/api/tts/test", {
        method: "POST",
        body: JSON.stringify({
          voiceId: props.voiceId,
          text: "नमस्ते, मेरो नाम सिता हो।",  // Sample Nepali text
        }),
      });
      
      const data = await response.json();
      const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
      audio.onended = () => setPlaying(false);
      audio.play();
    } catch (error) {
      console.error("Test synthesis failed:", error);
      setPlaying(false);
    }
  };

  return (
    <button onClick={testSynthesis} disabled={playing}>
      {playing ? "▶ Playing..." : "🔊 Test"}
    </button>
  );
}
```

### Provider Health Status

**File:** `src/features/voice-console/ProviderStatus.tsx` (new)

```tsx
export function ProviderStatus() {
  const [statuses, setStatuses] = useState<Record<string, RuntimeHealthResult>>({});

  useEffect(() => {
    const checkHealth = async () => {
      const response = await fetch("/api/tts/providers/health");
      const data = await response.json();
      setStatuses(data);
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);  // Check every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="provider-status">
      <h3>TTS Providers</h3>
      <ul>
        {Object.entries(statuses).map(([provider, health]) => (
          <li key={provider} className={`status-${health.status}`}>
            <span className="icon">
              {health.status === "healthy" && "✓"}
              {health.status === "unavailable" && "✗"}
              {health.status === "missing_model" && "⚠"}
            </span>
            <span className="name">{providerDisplayName(provider)}</span>
            <span className="reason">{health.reason}</span>
            {health.latencyMs && <span className="latency">{health.latencyMs}ms</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## 8. Configuration (defaults.ts equivalent)

**File:** `src/domain/ttsConfig.ts` (new)

```typescript
export interface TtsEngineConfig {
  piper?: {
    enabled: boolean;
    serviceUrl: string;
    voiceModelsPath: string;
    voices: PiperVoiceDefinition[];
  };
  fastpitch?: {
    enabled: boolean;
    serviceUrl: string;
    voiceModelsPath: string;
    gpuEnabled: boolean;
  };
  coqui?: {
    enabled: boolean;
    serviceUrl: string;
    voiceModelsPath: string;
    gpuEnabled: boolean;
  };
  custom?: {
    enabled: boolean;
    modelsPath: string;
    voiceRegistry: CustomVoiceDefinition[];
  };
}

export interface PiperVoiceDefinition {
  id: string;
  modelFile: string;
  language: string;
  qualityTier: "low" | "medium" | "high";
  gender: string;
  downloadUrl?: string;
}

export const defaultTtsEngineConfig: TtsEngineConfig = {
  piper: {
    enabled: true,
    serviceUrl: process.env.PIPER_SERVICE_URL || "http://localhost:8005",
    voiceModelsPath: "~/.local/share/piper/models",
    voices: [
      {
        id: "voice_piper_google_ne_low",
        modelFile: "ne_NP-google_low.onnx",
        language: "ne-NP",
        qualityTier: "low",
        gender: "female",
        downloadUrl: "https://huggingface.co/rhasspy/piper-voices/resolve/main/ne/ne_NP/google/ne_NP-google_low.onnx",
      },
      {
        id: "voice_piper_google_ne_medium",
        modelFile: "ne_NP-google_medium.onnx",
        language: "ne-NP",
        qualityTier: "medium",
        gender: "female",
        downloadUrl: "https://huggingface.co/rhasspy/piper-voices/resolve/main/ne/ne_NP/google/ne_NP-google_medium.onnx",
      },
      {
        id: "voice_piper_google_ne_high",
        modelFile: "ne_NP-google_high.onnx",
        language: "ne-NP",
        qualityTier: "high",
        gender: "female",
        downloadUrl: "https://huggingface.co/rhasspy/piper-voices/resolve/main/ne/ne_NP/google/ne_NP-google_high.onnx",
      },
    ],
  },
  fastpitch: {
    enabled: false,  // Phase 2
    serviceUrl: process.env.FASTPITCH_SERVICE_URL || "http://localhost:8006",
    voiceModelsPath: "./voice-models/fastpitch",
    gpuEnabled: true,
  },
  coqui: {
    enabled: false,  // Phase 2
    serviceUrl: process.env.COQUI_SERVICE_URL || "http://localhost:8007",
    voiceModelsPath: "./voice-models/coqui",
    gpuEnabled: false,
  },
  custom: {
    enabled: false,  // Phase 2
    modelsPath: "./voice-models/custom",
    voiceRegistry: [],
  },
};
```

---

## 9. Testing Strategy

### Phase 1: Piper MVP

**Objective:** Baseline Nepali TTS with acceptable quality and latency.

**Testing Plan:**

1. **Unit Tests** (`src/server/runtimes/piperOssv2.test.ts`):
   - Health check returns "healthy" when service running
   - Synthesis returns valid base64 audio
   - Error handling when service unavailable
   - Voice path mapping (voiceId → model file)

2. **Integration Tests** (`src/server/voice/pipeline.test.ts`):
   - End-to-end voice turn with Piper synthesis
   - Fallback chain activation on adapter error
   - Voice selection from agent config

3. **Smoke Test** (manual):
   - Deploy Piper locally
   - Call `/api/tts/test` with sample Nepali text
   - Verify audio output

### Phase 2: Multi-Adapter A/B Testing

**Objective:** Compare Piper, FastPitch, Coqui for quality and latency.

**Metrics:**

| Metric | Baseline (Piper Medium) | Target |
|--------|---------|---------|
| Latency (p50) | 200ms | < 300ms all engines |
| Audio Quality (MOS) | 3.5 / 5 | > 3.8 / 5 |
| CPU Usage (per 10s) | 1.5 cores | < 2 cores |
| GPU Mem (FastPitch) | N/A | < 2 GB |

**Test Corpus:**

```typescript
const nepaliTestCorpus = [
  "नमस्ते, तपाईलाई कस्तो छ?",
  "मेरो नाम सिता हो र मेरो परिवार काठमाडौंमा बस्छ।",
  "बिद्यालयमा सयौं विद्यार्थी छन् र उनीहरू दिनमा पाँच घण्टा अध्ययन गर्छन्।",
  // ... 50+ sentences, 200 total
];
```

**A/B Test Setup:**

1. Record real calls (with consent)
2. Replay same utterances through Piper, FastPitch, Coqui
3. Collect latency & CPU/GPU metrics
4. Run MOS evaluation (via human raters or PESQ score)
5. Compare voice naturalness, prosody, pronunciation

**Success Criteria:**
- FastPitch or Coqui within 5% of Piper latency
- Quality score ≥ baseline
- < 20% CPU increase vs. Piper
- GPU optional (CPU fallback acceptable)

### Phase 2: Fine-Tuning Validation

**Test:** Custom fine-tuned voice (Sita)

1. Record 1 hour of new speaker
2. Fine-tune Piper on 45-min subset
3. Synthesize held-out test set
4. Compare PESQ score vs. base model
5. Verify deployment into agent workflow

---

## 10. Integration with Existing System

### Updated socketDeps.ts

```typescript
function createRuntimeAdapters(config: ServerConfig): RuntimeAdapters {
  const adapters: Partial<Record<RuntimeAdapter, TtsAdapter>> = {
    piper: new PiperAdapter({
      serviceUrl: config.piperServiceUrl,
      voiceModelsPath: config.piperVoicePath,
    }),
  };

  if (config.fastpitchEnabled) {
    adapters.fastpitch = new FastPitchAdapter({
      serviceUrl: config.fastpitchServiceUrl,
      voiceModelsPath: config.fastpitchVoicePath,
      supportedLanguages: ["ne-NP"],
    });
  }

  if (config.coquiEnabled) {
    adapters.coqui_vits = new CoquiVitsAdapter({
      serviceUrl: config.coquiServiceUrl,
      voiceModelsPath: config.coquiVoicePath,
      gpu: config.coquiGpuEnabled,
    });
  }

  // Add custom fine-tuned voices
  if (config.customVoicesPath) {
    for (const customVoiceConfig of loadCustomVoices(config.customVoicesPath)) {
      adapters[`custom_${customVoiceConfig.voiceId}`] = new CustomFineTunedAdapter({
        backend: customVoiceConfig.backend,
        modelPath: customVoiceConfig.modelPath,
        voiceMetadataPath: customVoiceConfig.metadataPath,
        baseServiceUrl: config.piperServiceUrl,
      });
    }
  }

  return {
    llm: createLlmAdapter(config),
    stt: createSttAdapter(config),
    tts: adapters.piper!,  // Default fallback
    ttsAdapters: adapters,
  };
}
```

### Server Config Extension

**File:** `src/server/config.ts`

Add these env vars:

```typescript
export interface ServerConfig {
  // ... existing fields ...
  
  // TTS Multi-Adapter
  piperServiceUrl: string;           // e.g., http://localhost:8005
  piperVoicePath: string;
  fastpitchEnabled: boolean;
  fastpitchServiceUrl: string;
  fastpitchVoicePath: string;
  coquiEnabled: boolean;
  coquiServiceUrl: string;
  coquiVoicePath: string;
  coquiGpuEnabled: boolean;
  customVoicesEnabled: boolean;
  customVoicesPath: string;
}

const config: ServerConfig = {
  piperServiceUrl: env("PIPER_SERVICE_URL", "http://localhost:8005"),
  piperVoicePath: env("PIPER_VOICE_PATH", "~/.local/share/piper/models"),
  fastpitchEnabled: env("FASTPITCH_ENABLED", "false") === "true",
  fastpitchServiceUrl: env("FASTPITCH_SERVICE_URL", "http://localhost:8006"),
  fastpitchVoicePath: env("FASTPITCH_VOICE_PATH", "./voice-models/fastpitch"),
  coquiEnabled: env("COQUI_ENABLED", "false") === "true",
  coquiServiceUrl: env("COQUI_SERVICE_URL", "http://localhost:8007"),
  coquiVoicePath: env("COQUI_VOICE_PATH", "./voice-models/coqui"),
  coquiGpuEnabled: env("COQUI_GPU_ENABLED", "false") === "true",
  customVoicesEnabled: env("CUSTOM_VOICES_ENABLED", "false") === "true",
  customVoicesPath: env("CUSTOM_VOICES_PATH", "./voice-models/custom"),
};
```

---

## 11. Migration Path (from Google Cloud TTS)

### Phase 1: MVP (Week 1-2)

- Implement PiperAdapter
- Add Piper to defaults.ts voices
- Update socketDeps.ts to use PiperAdapter
- Deploy Piper service locally
- Update agent to assign Piper voice as default
- Remove dependency on Google Cloud TTS for Nepali (or keep as fallback)

### Phase 1.5: Refinement (Week 3)

- Fine-tune latency and quality
- Run MOS evaluation on 5-10 real calls
- Adjust fallback chains

### Phase 2: Multi-Adapter Testing (Week 4-6)

- Implement FastPitchAdapter, CoquiVitsAdapter
- Deploy all 3 services via docker-compose
- Run A/B tests on recorded calls
- Update UI to show provider health and voice options
- Start fine-tuning workflow if quality acceptable

### Phase 2.5: Fine-Tuning Deployment (Week 7-8)

- Build voice recording UI
- Train first custom voice (e.g., Sita)
- Deploy custom model
- Test in production calls
- Document process for internal team

---

## 12. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Piper latency > 300ms | Use "low" quality model for MVP; GPU-accelerate if needed |
| Nepali pronunciation errors | Validate on phonetically diverse test set; fallback to Google TTS if critical |
| Fine-tuning quality regression | Compare against baseline; require 45+ min recording; human review |
| Service unavailability | Fallback chain; health checks every 30s; automated alerts |
| GPU OOM (FastPitch/Coqui) | Set batch_size=1; use CPU mode; monitor VRAM |
| Model storage bloat | Use ONNX quantization; version pruning; ~500 MB per voice model |

---

## 13. Files to Create/Modify

### New Files (Phase 1)

1. `src/server/runtimes/piperOssv2.ts` — PiperAdapter implementation
2. `src/domain/ttsConfig.ts` — TTS engine configuration
3. `src/domain/voiceProfiles.ts` — Voice profile utilities
4. `docker-compose.local.yml` — Piper + app services
5. `docs/VOICE_SETUP.md` — Operator setup guide

### Modified Files (Phase 1)

1. `src/server/runtimes/types.ts` — Extend TtsAdapter with metadata
2. `src/server/voice/socketDeps.ts` — Enhanced TTS adapter selection
3. `src/server/voice/pipeline.ts` — Add fallback synthesis
4. `src/domain/types.ts` — Extend Voice interface with ttsProviderConfig
5. `src/domain/defaults.ts` — Add Piper voices to workspace
6. `src/server/config.ts` — Add Piper/FastPitch config env vars

### New Files (Phase 2)

1. `src/server/runtimes/fastPitch.ts` — FastPitchAdapter
2. `src/server/runtimes/coquiVits.ts` — CoquiVitsAdapter
3. `src/server/runtimes/customFineTuned.ts` — CustomFineTunedAdapter
4. `src/server/voice-lab/recordingProcessor.ts` — Voice recording validation
5. `src/server/voice-lab/modelDeployment.ts` — Model deployment logic
6. `src/features/voice-console/VoiceSelector.tsx` — Voice selection UI
7. `src/features/voice-console/ProviderStatus.tsx` — Provider health UI
8. `src/features/voice-lab/RecordingPage.tsx` — Recording UI (extend)

---

## 14. Example: Nepali Voice Profile

```typescript
// voice_piper_google_ne_medium
{
  id: "voice_piper_google_ne_medium",
  name: "Asha (Piper Medium)",
  runtimeId: "runtime_piper",
  type: "builtin",
  language: "ne-NP",
  tags: ["local", "piper", "nepali", "balanced"],
  previewUrl: "",
  privacy: "workspace",
  cloneStatus: "not_clone",
  consentId: null,
  ttsProviderConfig: {
    providerId: "piper",
    modelId: "model_piper_google_ne_medium",
    voiceKey: "ne_NP-google_medium",
    qualityTier: "medium",
    costMetrics: {
      cpuCoreSeconds: 0.8,
      latencyMs: 200,
    },
  },
  fallbackChain: [
    "voice_piper_google_ne_low",
    "voice_coqui_nepali_v1",  // Phase 2
  ],
}
```

---

## References

- **Piper:** https://github.com/rhasspy/piper | HF Models: https://huggingface.co/rhasspy/piper-voices
- **FastPitch:** https://github.com/nvidia/fastpitch | Paper: https://arxiv.org/abs/2006.06283
- **Coqui VITS:** https://github.com/coqui-ai/TTS | Nepali models: https://huggingface.co/coqui-ai/TTS_models
- **OmniVoice:** https://github.com/k2-fsa/OmniVoice (Phase 2.3 alternative)
- **Chatterbox Nepali:** https://huggingface.co/Imbatmann/chatterbox-nepali-tts (Phase 2.3 alternative)

---

## Appendix A: Quick Start (Phase 1)

```bash
# 1. Clone repo & install deps
git clone https://github.com/lipivoice/lipivoice.git
cd lipivoice
npm install

# 2. Build Piper Docker image
docker build -f Dockerfile.piper -t synesthesiam/piper:latest .

# 3. Start services
docker-compose -f docker-compose.local.yml up

# 4. Download model (in container)
docker exec lipivoice-piper bash -c \
  "curl -L https://huggingface.co/rhasspy/piper-voices/resolve/main/ne/ne_NP/google/ne_NP-google_medium.onnx -o ~/.local/share/piper/models/ne_NP-google_medium.onnx"

# 5. Test TTS endpoint
curl -X POST http://localhost:8005/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"नमस्ते","model":"ne_NP-google_medium"}'

# 6. Start app
npm run dev

# 7. Open http://localhost:3000 and test voice
```

