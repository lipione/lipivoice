# Multi-Adapter TTS Architecture

**Status:** ✅ IMPLEMENTED — Piper HTTP, Coqui XTTS, FastPitch all live. Google TTS fully removed.

This document describes how the multi-adapter TTS system fits into LipiVoice.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     LipiVoice Agent Voice Call                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              ┌─────▼────┐                    ┌─────▼─────┐
              │  STT     │                    │   LLM     │
              │ Adapter  │                    │ Adapter   │
              └──────────┘                    └───────────┘
                    │
                    │ "Synthesize this text"
                    ▼
        ┌──────────────────────────────┐
        │    TTS Adapter Selection      │
        │  (socketDeps.ts:ttsAdapter   │
        │   ForAgent)                   │
        └──────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         │                     │
    1. Get Voice Profile   2. Find Runtime
         │                     │
    agent.voiceId          voice.runtimeId
         │                     │
    repositories           repositories.
    .voices.get()          runtimes.get()
         │                     │
    Voice {               ModelRuntime {
      ttsProviderConfig     adapter: "piper"
      fallbackChain: [...]  endpoint: ...
    }                     }
         │                     │
         └──────────┬──────────┘
                    │
              ┌─────▼────────┐
              │ Adapter      │
              │ Selection    │
              │ ttsAdapters  │
              │ [runtime.    │
              │  adapter]    │
              └─────┬────────┘
                    │
        ┌───────────┼───────────────┐
        │           │               │
    ┌───▼───────┐  ┌─▼──────────┐  ┌─▼──────────┐
    │ Piper     │  │ FastPitch  │  │  Coqui     │
    │ HTTP      │  │ HTTP       │  │  XTTS HTTP │
    │ :5002     │  │ :5004      │  │  :5003     │
    │ piper_http│  │fastpitch_  │  │ coqui_http │
    └───┬───────┘  │http        │  └────┬───────┘
                   └─────┬──────┘
        │           │             │
    ┌───▼──────────▼────────────▼──┐
    │  Pipeline: synthesizeWithFall│
    │  back()                      │
    │                              │
    │  1. Try primary adapter      │
    │  2. If error → fallback chain│
    │  3. Return audio or error    │
    └───────────────┬──────────────┘
                    │
            ┌───────▼──────────┐
            │   Audio Output   │
            │  (base64, wav)   │
            │  Sent to client  │
            └──────────────────┘
```

---

## Voice Profile → Runtime Mapping

```
Agent Configuration:
├─ modelRuntimeId: "runtime_vllm"
├─ transcriberRuntimeId: "runtime_lipi_ml_stt"
└─ voiceId: "voice_lipi_ml_ne"  ← default; or any voice_piper_ne_*, voice_coqui_ne_*, voice_fastpitch_ne_*
                    │
                    ▼
Voice Profile (from repositories.voices.get):
├─ id: "voice_piper_ne_sita"
├─ runtimeId: "runtime_piper_http"  ← Links to TTS runtime
├─ language: "ne-NP"
└─ type: "builtin"
                    │
                    ▼
ModelRuntime (from repositories.runtimes.get):
├─ id: "runtime_piper_http"
├─ kind: "tts"
├─ adapter: "piper_http"  ← Determines which TTS adapter class
├─ endpoint: "http://localhost:5002"  (PIPER_HTTP_ENDPOINT)
└─ healthStatus: "healthy"
                    │
                    ▼
TTS Adapter Instance (from ttsAdapters map):
├─ ttsAdapters["piper_http"] = PiperHttpAdapter  (endpoint: :5002)
├─ ttsAdapters["coqui_http"] = CoquiHttpAdapter  (endpoint: :5003)
├─ ttsAdapters["fastpitch_http"] = FastPitchHttpAdapter (endpoint: :5004)
│
└─ adapter.synthesize({
     text: "नमस्ते",
     voicePath: "voice_piper_ne_sita"
   })
```

---

## Adapter Interface (Reused Pattern)

```typescript
// All TTS adapters implement this interface:
interface TtsAdapter {
  health(): Promise<RuntimeHealthResult>;
  synthesize(input: { 
    text: string; 
    voicePath: string;  // Voice profile ID
  }): Promise<{
    audioBase64: string;
    mimeType: string;   // "audio/wav" or "audio/mpeg"
    providerId?: string;
    voiceId?: string;
  }>;
}

// Adapter implementations:
class PiperAdapter implements TtsAdapter { ... }
class FastPitchAdapter implements TtsAdapter { ... }
class CoquiVitsAdapter implements TtsAdapter { ... }
class CustomFineTunedAdapter implements TtsAdapter { ... }
```

This pattern mirrors existing adapters:
- `GoogleCloudTtsAdapter` (implements TtsAdapter)
- `OpenAICompatibleAdapter` (implements LlmAdapter)
- `OllamaAdapter` (implements LlmAdapter)

---

## Runtime Adapter Selection (socketDeps.ts)

```typescript
/**
 * For a given agent and its assigned voice, find the corresponding TTS adapter.
 * This function does the critical mapping:
 *   Agent.voiceId → Voice profile → Runtime → Adapter implementation
 */
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
  // Step 1: Get voice profile
  const voice = repositories.voices.get(agent.voiceId);
  if (!voice) {
    return null;
  }

  // Step 2: Get runtime (connects to adapter)
  const runtime = repositories.runtimes
    .list()
    .find((candidate) => candidate.id === voice.runtimeId);
  
  const providerId = runtime?.adapter ?? "piper";

  // Step 3: Get adapter implementation
  const adapter = runtime 
    ? ttsAdapters[runtime.adapter] ?? fallbackTts 
    : fallbackTts;

  // Step 4: Build fallback chain (NEW)
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

---

## Synthesis with Fallback (pipeline.ts)

```typescript
/**
 * Synthesize text with automatic fallback to alternative providers.
 *
 * Flow:
 *   1. Try primary adapter (voice.ttsProviderConfig.providerId)
 *   2. On error: iterate through fallbackChain
 *   3. Return first successful synthesis, or throw after all fail
 */
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
        voicePath: voiceId,  // Same voice profile across adapters
      });
    } catch (error) {
      lastError = error as Error;
      console.warn(`TTS synthesis failed, trying next adapter: ${lastError.message}`);
      continue;
    }
  }

  throw lastError ?? new Error("All TTS adapters failed");
}

// In runVoiceTurn:
const assistantText = "नमस्ते, आज कस्तो छ?";
const ttsResult = await synthesizeWithFallback(
  assistantText,
  selectedTts.adapter,        // Primary (e.g., PiperAdapter)
  selectedTts.fallbackChain, // [FastPitchAdapter, GoogleTtsAdapter]
  agent.voiceId,              // "voice_piper_google_ne_medium"
);
```

---

## Docker Compose Deployment

```yaml
# docker-compose.local.yml

services:
  # Phase 1: Required
  piper-tts:
    image: synesthesiam/piper:latest
    ports:
      - "8005:8005"
    volumes:
      - ./voice-models/piper:/home/piper/.local/share/piper/models
    environment:
      PIPER_VOICE: ne_NP-google_medium
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8005/health"]

  # Phase 2: Optional
  fastpitch-tts:
    image: lipivoice/fastpitch:latest
    ports:
      - "8006:8006"
    environment:
      CUDA_VISIBLE_DEVICES: "0"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  # Phase 2: Optional
  coqui-tts:
    image: lipivoice/coqui-vits:latest
    ports:
      - "8007:8007"
    environment:
      GPU_ENABLED: "false"

  # Main app
  lipivoice-app:
    build: .
    depends_on:
      piper-tts:
        condition: service_healthy
    environment:
      PIPER_SERVICE_URL: http://piper-tts:8005
      FASTPITCH_SERVICE_URL: http://fastpitch-tts:8006
      COQUI_SERVICE_URL: http://coqui-tts:8007
```

---

## Configuration Flow

```
Environment Variables
(docker-compose, .env, system env)
        │
        ├─ PIPER_SERVICE_URL=http://localhost:8005
        ├─ FASTPITCH_ENABLED=false
        ├─ COQUI_ENABLED=false
        │
        ▼
ServerConfig (src/server/config.ts)
        │
        ├─ piperServiceUrl: string
        ├─ fastpitchEnabled: boolean
        ├─ coquiEnabled: boolean
        │
        ▼
createRuntimeAdapters(config)
        │
        ├─ const piper = new PiperAdapter({
        │    serviceUrl: config.piperServiceUrl
        │  })
        │
        ├─ if (config.fastpitchEnabled)
        │    const fastpitch = new FastPitchAdapter({...})
        │
        └─ return {
             tts: piper,
             ttsAdapters: {
               piper,
               fastpitch,
               google_tts,
             }
           }
```

---

## Voice Profile Examples

### Phase 1: Piper Nepali Voices

```typescript
{
  id: "voice_piper_google_ne_low",
  name: "Asha (Fast)",
  runtimeId: "runtime_piper",
  language: "ne-NP",
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
  fallbackChain: ["voice_piper_google_ne_medium"],
}

{
  id: "voice_piper_google_ne_medium",
  name: "Asha (Balanced)",
  runtimeId: "runtime_piper",
  language: "ne-NP",
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
    "voice_coqui_nepali_v1",
  ],
}

{
  id: "voice_piper_google_ne_high",
  name: "Asha (Quality)",
  runtimeId: "runtime_piper",
  language: "ne-NP",
  ttsProviderConfig: {
    providerId: "piper",
    modelId: "model_piper_google_ne_high",
    voiceKey: "ne_NP-google_high",
    qualityTier: "high",
    costMetrics: {
      cpuCoreSeconds: 1.2,
      latencyMs: 300,
    },
  },
  fallbackChain: ["voice_piper_google_ne_medium"],
}
```

### Phase 2: FastPitch Alternative

```typescript
{
  id: "voice_fastpitch_nepali_v1",
  name: "Maya (FastPitch)",
  runtimeId: "runtime_fastpitch",
  language: "ne-NP",
  ttsProviderConfig: {
    providerId: "fastpitch",
    modelId: "model_fastpitch_nepali_v1",
    voiceKey: "speaker_0",
    qualityTier: "high",
    costMetrics: {
      cpuCoreSeconds: 0.2,  // Much faster with GPU
      latencyMs: 120,
    },
  },
  fallbackChain: ["voice_piper_google_ne_high"],
}
```

### Phase 2.5: Custom Fine-Tuned Voice

```typescript
{
  id: "voice_custom_sita_finetuned_v1",
  name: "Sita (Custom)",
  runtimeId: "runtime_custom_finetuned",
  language: "ne-NP",
  type: "fine_tuned",
  ttsProviderConfig: {
    providerId: "custom",
    modelId: "model_sita_finetuned_piper_v1",
    voiceKey: "sita-v1",
    qualityTier: "high",
    costMetrics: {
      cpuCoreSeconds: 0.9,
      latencyMs: 250,
    },
  },
  fallbackChain: ["voice_piper_google_ne_high"],
}
```

---

## Fallback Chain Example

**Scenario:** Voice turns "Sita" voice (custom), but service is down.

```
Agent assigned: voice_custom_sita_finetuned_v1
    ↓
Voice profile lookup:
  fallbackChain: ["voice_piper_google_ne_high"]
    ↓
Try synthesis:
  1. CustomFineTunedAdapter.synthesize() → Error: service unavailable
     Fallback...
  2. PiperAdapter.synthesize(voice_piper_google_ne_high) → Success!
     Return audio from Piper model
    ↓
User hears voice in same language, slightly different accent
(acceptable degradation vs. complete failure)
```

---

## Testing Strategy

### Unit Tests

```typescript
// piperOssv2.test.ts
describe("PiperAdapter", () => {
  it("should return healthy status when service responds", async () => {
    const adapter = new PiperAdapter({ serviceUrl: "http://localhost:8005" });
    const health = await adapter.health();
    expect(health.status).toBe("healthy");
  });

  it("should synthesize Nepali text and return base64 audio", async () => {
    const adapter = new PiperAdapter({ serviceUrl: "http://localhost:8005" });
    const result = await adapter.synthesize({
      text: "नमस्ते",
      voicePath: "voice_piper_google_ne_medium",
    });
    expect(result.audioBase64).toBeTruthy();
    expect(result.mimeType).toBe("audio/wav");
  });

  it("should use fallback voice when specified voice not found", async () => {
    // voiceProfileToModel doesn't have "unknown_voice"
    // → defaults to defaultVoice
  });

  it("should throw error when service unavailable", async () => {
    const adapter = new PiperAdapter({ 
      serviceUrl: "http://localhost:9999" 
    });
    await expect(adapter.synthesize({...})).rejects.toThrow();
  });
});
```

### Integration Tests

```typescript
// pipeline.test.ts
describe("runVoiceTurnWithFallback", () => {
  it("should synthesize with primary adapter", async () => {
    const result = await runVoiceTurn({
      agent: mockAgent,
      stt: mockStt,
      llm: mockLlm,
      tts: piperAdapter,
      history: [],
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "audio",
        payload: expect.objectContaining({
          providerId: "piper",
        }),
      })
    );
  });

  it("should fall back to secondary adapter on error", async () => {
    const primaryAdapter = {
      health: async () => ({ status: "healthy" }),
      synthesize: async () => { throw new Error("Service down"); },
    };
    const fallbackAdapter = {
      health: async () => ({ status: "healthy" }),
      synthesize: async () => ({
        audioBase64: "...",
        mimeType: "audio/wav",
      }),
    };

    const result = await synthesizeWithFallback(
      "नमस्ते",
      primaryAdapter,
      [fallbackAdapter],
      "voice_piper_google_ne_medium",
    );

    expect(result.audioBase64).toBeTruthy();
  });
});
```

---

## Checklist: From Design to Deployment

### Phase 1: Piper HTTP ✅ DONE

- [x] Implement `PiperHttpAdapter` (`openAiCompatible.ts`, adapter key `piper_http`)
- [x] Add `FasterWhisperAdapter` for self-hosted STT
- [x] Update `socketDeps.ts` with `ttsAdapterForAgent()` using `voice.runtimeId → runtime.adapter`
- [x] Add Piper voices to `defaults.ts` (`voice_piper_ne_sita`, `voice_piper_ne_maya`)
- [x] Add `PIPER_HTTP_ENDPOINT` env var to `config.ts`
- [x] Tests passing (`socketDeps.test.ts`, `runtimes.test.ts`)

### Phase 2: Coqui XTTS + FastPitch ✅ DONE

- [x] Implement `CoquiHttpAdapter` (adapter key `coqui_http`)
- [x] Implement `FastPitchHttpAdapter` (adapter key `fastpitch_http`)
- [x] Add `COQUI_HTTP_ENDPOINT`, `FASTPITCH_HTTP_ENDPOINT` env vars
- [x] Add Coqui voices (`voice_coqui_ne_anju`, `voice_coqui_ne_kiran`) to defaults
- [x] Add FastPitch voices (`voice_fastpitch_ne_nabin`, `voice_fastpitch_ne_bikram`) to defaults
- [x] `piper_http_tts`, `coqui_xtts`, `fastpitch_tts` in TTS provider catalog
- [ ] VoiceSelector UI component (pending)
- [ ] A/B quality/latency comparison report (pending)

### Phase 2.5: Fine-Tuning (Pending)

- [ ] Build voice recording UI (RecordingPage extension in Voice Lab)
- [ ] Implement `recordingProcessor.ts` (SNR validation, segmentation)
- [ ] Implement `modelDeployment.ts` (training pipeline, ONNX export)
- [ ] Implement `CustomFineTunedAdapter`
- [ ] Test fine-tuning pipeline end-to-end
- [ ] Document fine-tuning workflow for Nepali speaker data

---

## Key Files Reference

| File | Purpose |
| ---- | ------- |
| `src/server/runtimes/types.ts` | `TtsAdapter`, `SttAdapter`, `LlmAdapter` interfaces |
| `src/server/runtimes/openAiCompatible.ts` | `PiperHttpAdapter`, `CoquiHttpAdapter`, `FastPitchHttpAdapter`, `FasterWhisperAdapter` |
| `src/server/voice/socketDeps.ts` | `ttsAdapterForAgent()` — voice → runtime → adapter selection |
| `src/server/voice/pipeline.ts` | `runVoiceTurn()` — full STT→LLM→TTS pipeline |
| `src/server/config.ts` | `PIPER_HTTP_ENDPOINT`, `COQUI_HTTP_ENDPOINT`, `FASTPITCH_HTTP_ENDPOINT`, `FASTER_WHISPER_ENDPOINT` |
| `src/domain/defaults.ts` | `createLipiVoiceNepaliVoices()` — 6 Nepali voices across 3 runtimes |
| `src/domain/ttsProviders.ts` | `piper_http_tts`, `coqui_xtts`, `fastpitch_tts` provider catalog |
| `src/server/app.ts` | Adapter registration (`ttsAdapters` map) for all presets |
| `docker-compose.remote.yml` | Production container stack |

---

## Success Criteria

### Phase 1 (MVP)
- Piper service responds to `/health` and `/synthesize` endpoints
- Voice turns complete with Piper audio (no crashes)
- Latency p50 < 250ms, p99 < 500ms
- MOS score ≥ 3.5 / 5.0
- Works reliably in docker-compose setup

### Phase 2 (Testing)
- All 3 engines (Piper, FastPitch, Coqui) operational
- At least 1 alternative to Piper within 20% latency & equal/better quality
- Fallback chain working end-to-end
- Voice selector UI functional & intuitive

### Phase 2.5 (Fine-Tuning)
- Custom voice trained and deployed successfully
- Voice profile created and usable in agent setup
- Fine-tuning process documented for team

