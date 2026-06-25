# LipiVoice Multi-Adapter TTS Design Summary

**Date:** 2026-06-24  
**Status:** Design Complete - Ready for Phase 1 Implementation  
**Duration:** 8-10 weeks (2 weeks MVP, 4 weeks Phase 2, 2 weeks fine-tuning)

---

## Quick Overview

Redesign LipiVoice's TTS layer to support **multiple self-hosted Nepali speech synthesis engines** (Piper, FastPitch, Coqui, custom fine-tuned models) with a unified adapter interface and automatic fallback chains.

**Why?**
- 100% self-hosted (no cloud dependency for MVP)
- Test multiple engines to optimize quality vs. latency
- Support fine-tuned custom voices (Phase 2.5)
- Reuse existing adapter pattern (GoogleCloudTts, OpenAI-compatible LLM)

---

## Architecture in 30 Seconds

```
Agent (voiceId) → Voice Profile (ttsProviderConfig) → Runtime (adapter name)
    ↓
TTS Adapter Map: runtime.adapter → TtsAdapter instance
    ↓
PiperAdapter / FastPitchAdapter / CoquiVitsAdapter / CustomFineTunedAdapter
    ↓
HTTP call to local TTS service (port 8005/8006/8007)
    ↓
Audio output (base64 WAV)
    ↓
If error → fallback to next voice in fallbackChain
```

---

## Key Design Decisions

### 1. **Reuse TtsAdapter Interface**

All TTS engines implement the same interface (already exists):

```typescript
interface TtsAdapter {
  health(): Promise<RuntimeHealthResult>;
  synthesize(input: { text: string; voicePath: string }): Promise<{
    audioBase64: string;
    mimeType: string;
  }>;
}
```

No interface changes needed. Add optional metadata extension for Phase 2.

### 2. **Voice Profile Enhancement**

Add provider-specific config to Voice record:

```typescript
interface Voice {
  // Existing fields...
  ttsProviderConfig?: {
    providerId: string;      // "piper", "fastpitch", "coqui"
    modelId: string;         // maps to ModelAsset
    voiceKey: string;        // provider-specific voice identifier
    qualityTier: "low" | "medium" | "high";
    costMetrics: { cpuCoreSeconds: number; latencyMs: number };
  };
  fallbackChain?: string[];  // [voiceId2, voiceId3, ...]
}
```

This keeps voice → provider mapping explicit and queryable.

### 3. **Fallback Synthesis**

Extend `pipeline.ts` with fallback logic:

```typescript
async synthesizeWithFallback(
  text: string,
  primaryAdapter: TtsAdapter,
  fallbackAdapters: TtsAdapter[],
  voiceId: string
)
```

If primary fails → try fallback chain in order → throw if all fail.

### 4. **Docker Compose Deployment**

Phase 1 (MVP): Piper only
```bash
docker-compose -f docker-compose.local.yml up piper-tts lipivoice-app
```

Phase 2: Add optional services
```bash
# + fastpitch-tts (GPU-accelerated)
# + coqui-tts (alternative)
```

---

## Implementation Phases

### Phase 1: Piper MVP (Weeks 1-3)

**Week 1:** Implement PiperAdapter, integrate into socketDeps, update defaults
**Week 2:** Testing, MOS evaluation, quality validation
**Week 3:** Refinement, documentation

**Deliverable:** Nepali TTS via local Piper (3 quality tiers)

**Files to create:**
- `src/server/runtimes/piperOssv2.ts` (adapter)
- `src/domain/ttsConfig.ts` (config)
- `docker-compose.local.yml` (services)
- `docs/VOICE_SETUP.md` (operator guide)

**Files to modify:**
- `src/domain/types.ts` (extend Voice)
- `src/server/voice/socketDeps.ts` (adapter selection)
- `src/server/voice/pipeline.ts` (fallback synthesis)
- `src/domain/defaults.ts` (register voices)

---

### Phase 2: Multi-Adapter Testing (Weeks 4-6)

**Week 4-5:** Implement FastPitch & Coqui adapters, deploy services, run A/B tests
**Week 6:** Voice selector UI, provider health status

**Deliverable:** Compare Piper, FastPitch, Coqui quality/latency

**Files to create:**
- `src/server/runtimes/fastPitch.ts`
- `src/server/runtimes/coquiVits.ts`
- `src/features/voice-console/VoiceSelector.tsx`
- `src/features/voice-console/ProviderStatus.tsx`

---

### Phase 2.5: Fine-Tuning Workflow (Weeks 7-8)

**Week 7:** Voice recording UI, validation pipeline
**Week 8:** Model training, deployment, testing

**Deliverable:** Custom fine-tuned voice (e.g., "Sita")

**Files to create:**
- `src/server/voice-lab/recordingProcessor.ts`
- `src/server/voice-lab/modelDeployment.ts`
- `src/server/runtimes/customFineTuned.ts`
- Extended `RecordingPage.tsx` in voice-lab

---

## Phase 1 Voice Profiles

Three Piper Nepali voices (Google training, different quality tiers):

| Voice ID | Name | Model | Quality | Latency | CPU | Notes |
|----------|------|-------|---------|---------|-----|-------|
| `voice_piper_google_ne_low` | Asha (Fast) | `ne_NP-google_low` | Low | 150ms | 0.5 core | Fastest, ~speech speed variable |
| `voice_piper_google_ne_medium` | Asha (Balanced) | `ne_NP-google_medium` | Medium | 200ms | 0.8 core | **Recommended for MVP** |
| `voice_piper_google_ne_high` | Asha (Quality) | `ne_NP-google_high` | High | 300ms | 1.2 core | Best quality, slowest |

Fallback chain (medium → low → Coqui in Phase 2):
```typescript
voice_piper_google_ne_medium.fallbackChain = [
  "voice_piper_google_ne_low",
  "voice_coqui_nepali_v1",
]
```

---

## Resource Requirements

### Phase 1 (Local Development)
- CPU: 2 cores
- RAM: 4 GB
- Storage: 500 MB (Piper model + app)
- GPU: Not needed (CPU synthesis ~200ms)

### Phase 2 (Multi-Adapter Testing)
- CPU: 4 cores
- RAM: 8 GB
- GPU: NVIDIA RTX 3080 or equiv (optional but recommended)
- Storage: 2 GB (3 model sets + app)

---

## Testing Strategy

### Phase 1 Validation
1. **Health check:** Piper service responds to `/health`
2. **Basic synthesis:** Call `/synthesize` with Nepali text → audio
3. **Latency:** p50 < 250ms, p99 < 500ms (on single call)
4. **Quality:** MOS evaluation ≥ 3.5 / 5.0
5. **Integration:** Voice turns complete with fallback (if needed)

### Phase 2 A/B Testing
- 200-utterance Nepali test corpus
- Measure latency, CPU usage, MOS for all 3 engines
- Success: At least 1 alternative ≥ Piper quality, within 20% latency

### Phase 2.5 Fine-Tuning
- Record 1 hour of custom voice
- Train Piper model
- Test synthesis with fine-tuned model
- Verify deployment into agent workflow

---

## Configuration (Environment Variables)

```bash
# Phase 1
PIPER_SERVICE_URL=http://localhost:8005
PIPER_VOICE_PATH=~/.local/share/piper/models

# Phase 2 (optional)
FASTPITCH_ENABLED=false
FASTPITCH_SERVICE_URL=http://localhost:8006
COQUI_ENABLED=false
COQUI_SERVICE_URL=http://localhost:8007
COQUI_GPU_ENABLED=false

# Phase 2.5
CUSTOM_VOICES_ENABLED=false
CUSTOM_VOICES_PATH=./voice-models/custom
```

---

## Key Files & Locations

### To Create (Phase 1)
```
src/server/runtimes/piperOssv2.ts           # PiperAdapter
src/domain/ttsConfig.ts                     # TTS config constants
src/domain/voiceProfiles.ts                 # Voice profile utilities
docker-compose.local.yml                    # Service deployment
docs/VOICE_SETUP.md                         # Operator guide
src/server/runtimes/piperOssv2.ts.scaffold  # Reference implementation
```

### To Modify (Phase 1)
```
src/domain/types.ts                         # Extend Voice interface
src/server/voice/socketDeps.ts              # Enhanced adapter selection
src/server/voice/pipeline.ts                # Add fallback synthesis
src/domain/defaults.ts                      # Register Piper voices
src/server/config.ts                        # Add env vars
src/server/runtimes/types.ts                # Optional: extend TtsAdapter metadata
```

### Full Design Docs
```
docs/superpowers/specs/2026-06-24-self-hosted-tts-multi-adapter.md
  → 14-section comprehensive design (TtsAdapter, providers, voice profiles, etc.)

docs/superpowers/plans/2026-06-24-tts-multi-adapter-roadmap.md
  → Implementation roadmap with weekly tasks & resource allocation

docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md
  → Visual architecture diagram, mapping flows, examples
```

---

## Voice Selection Flow (Voice Console UI)

**Operator UI in voice-lab or agent config:**

```
┌─────────────────────────────────────────┐
│  Voice Selector                         │
├─────────────────────────────────────────┤
│ Piper                                   │
│  □ Asha (Fast)      [p50: 150ms]        │
│  ☑ Asha (Balanced)  [p50: 200ms]        │
│  □ Asha (Quality)   [p50: 300ms]        │
│                                          │
│ FastPitch [⚠ GPU disabled]               │
│  □ Maya (HiFi)      [p50: 120ms]        │
│                                          │
│ Coqui [✓ healthy]                       │
│  □ Nepali VITS      [p50: 180ms]        │
│                                          │
│ Custom                                   │
│  □ Sita (Fine-tuned) [p50: 250ms]       │
│                                          │
│                                          │
│  [🔊 Test Voice] [Save] [Cancel]        │
└─────────────────────────────────────────┘
```

---

## Fallback Chain Example

**User scenario:** Agent assigned "Sita" custom voice, but service is down.

```
Try synthesis:
  1. CustomFineTunedAdapter (Sita) → Error: service unavailable
     ↓ fallback
  2. PiperAdapter (google_ne_high) → Success!
     Return audio
     
User hears: Piper voice instead of custom, but call doesn't fail
Log entry: "CustomFineTuned synthesis failed, fell back to Piper"
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Piper latency too high | Use "low" quality tier, add GPU acceleration |
| Poor Nepali pronunciation | Validate on test corpus early (Week 1), fallback to Google TTS if needed |
| Fine-tuning data scarcity | 45-60 min minimum; use phonetically diverse sentences |
| Service crashes | Health checks every 30s; automated alerts; fallback chain |
| GPU OOM (FastPitch) | CPU-only mode; batch_size=1; monitor VRAM |

---

## Success Metrics

### Phase 1 MVP
- ✅ Piper service deployed & healthy
- ✅ Voice turns complete, no synthesis errors
- ✅ Latency p50 < 250ms, p99 < 500ms
- ✅ MOS ≥ 3.5 / 5.0
- ✅ CPU usage < 2 cores per call

### Phase 2 Multi-Adapter
- ✅ All 3 adapters healthy
- ✅ At least 1 alternative ≥ Piper quality within 20% latency
- ✅ Fallback chain functional end-to-end
- ✅ Voice selector UI intuitive

### Phase 2.5 Fine-Tuning
- ✅ Custom voice trained & deployed
- ✅ Voice profile registered & usable
- ✅ Fine-tuning process documented

---

## Next Steps

1. **Review & approve** this design (especially Phase 1 scope)
2. **Allocate engineers** (2 FTE for voice, 0.5 FTE DevOps)
3. **Procure compute:** 1 GPU machine (RTX 3080) for Phase 2
4. **Download models:** Piper Nepali voices from HF (500 MB)
5. **Kick off Week 1:** PiperAdapter implementation

**Timeline:** 8-10 weeks end-to-end (2 weeks MVP, 6 weeks Phase 2, 2 weeks fine-tuning)

---

## References

- **Main Design Doc:** `docs/superpowers/specs/2026-06-24-self-hosted-tts-multi-adapter.md`
- **Roadmap:** `docs/superpowers/plans/2026-06-24-tts-multi-adapter-roadmap.md`
- **Architecture:** `docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md`
- **Piper Voices:** https://huggingface.co/rhasspy/piper-voices
- **FastPitch:** https://github.com/nvidia/fastpitch
- **Coqui TTS:** https://github.com/coqui-ai/TTS

---

## Contact & Questions

For clarifications on this design, refer to the comprehensive docs:
- **Section 1-5:** Adapter interface, provider implementations, voice profiles, selection logic
- **Section 6:** Self-hosted deployment (docker-compose)
- **Section 7-8:** Fine-tuning workflow & operator UI
- **Section 9-14:** Testing strategy, configuration, integration, migration path

