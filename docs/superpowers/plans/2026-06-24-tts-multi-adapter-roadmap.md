# TTS Multi-Adapter Implementation Roadmap

**Status:** ✅ COMPLETE — Phases 1 & 2 implemented (2026-06-24)
**Ownership:** Voice infrastructure team

## Quick Summary

LipiVoice TTS supports three self-hosted Nepali speech synthesis engines via a unified HTTP adapter pattern:

- ✅ **Phase 1 (Piper HTTP):** `PiperHttpAdapter` — fast CPU inference, ONNX voices (`src/server/runtimes/openAiCompatible.ts` + piper_http adapter)
- ✅ **Phase 2 (Coqui XTTS):** `CoquiHttpAdapter` — expressive, multilingual, voice cloning
- ✅ **Phase 2 (FastPitch):** `FastPitchHttpAdapter` — GPU-accelerated, multi-speaker
- 🔲 **Phase 2.5:** Fine-tuning workflow + custom voice training (pending)

**Key Pattern:** All adapters implement `TtsAdapter` (`health()` + `synthesize()`). Runtime selected per-voice via `voice.runtimeId → ModelRuntime.adapter → ttsAdapters[adapter]`. Google TTS has been fully removed from the stack.

---

## Phase 1: Piper MVP (2 weeks)

### Week 1: Core Implementation

**Objectives:**
- Implement PiperAdapter that wraps local Piper HTTP service
- Add Piper voices to workspace defaults
- Update socketDeps.ts to select TTS adapter from voice profile
- Deploy Piper in docker-compose

**Key Files to Create:**
1. `src/server/runtimes/piperOssv2.ts` — PiperAdapter class
2. `src/domain/ttsConfig.ts` — Engine configuration & voice definitions
3. `docker-compose.local.yml` — Piper service + app

**Key Files to Modify:**
1. `src/server/runtimes/types.ts` — Extend TtsAdapter interface (optional metadata)
2. `src/domain/types.ts` — Add `ttsProviderConfig` & `fallbackChain` to Voice
3. `src/server/voice/socketDeps.ts` — Enhanced `ttsAdapterForAgent()` with fallback
4. `src/domain/defaults.ts` — Register Piper voices (3 quality tiers)
5. `src/server/config.ts` — Add PIPER_SERVICE_URL env var

**Resource Needs:**
- 2 engineer-days (adapter + tests)
- 1 engineer-day (integration + config)
- 0.5 engineer-day (docs)

**Success Criteria:**
- Piper service responds to `/synthesize` calls
- Voice turns complete with Piper audio (no crashes)
- latency < 300ms (p50) for 10-second utterance
- Works in local docker-compose setup

---

### Week 2: Quality & Testing

**Objectives:**
- Record 10-15 real calls with Piper synthesis
- Run PESQ/MOS evaluation vs. baseline (Google Cloud TTS if available)
- Adjust quality tier defaults based on latency testing
- Document voice setup guide for operators

**Deliverables:**
1. MOS evaluation report (Piper medium vs. Google TTS)
2. Latency benchmark (p50, p95, p99)
3. `docs/VOICE_SETUP.md` — How to deploy Piper locally
4. Updated voice profiles with final quality tier recommendations

**Quality Gates:**
- MOS score ≥ 3.5 / 5.0
- Latency p50 < 250ms (adjusted if needed)
- CPU usage < 2 cores for single concurrent call
- Zero pronunciation errors on phonetically diverse test set

**Resource Needs:**
- 1 engineer-day (test setup + analysis)
- 0.5 engineer-day (documentation)
- 1-2 reviewer-days (MOS evaluation)

---

## Phase 1.5: Fine-Tuning Prep (1 week)

**Optional, can overlap with Phase 2 if time-constrained.**

**Objectives:**
- Finalize Piper quality tier selection (low/medium/high)
- Create phonetically diverse Nepali test sentences (50+ phrases)
- Plan fine-tuning workflow for Phase 2

**Key Decision:** Should MVP commit to "low" (faster) or "medium" (higher quality)?
- Recommendation: "medium" for initial launch, "low" as fallback

---

## Phase 2: Multi-Adapter Testing (4 weeks)

### Week 4-5: FastPitch & Coqui Setup

**Objectives:**
- Implement FastPitchAdapter
- Implement CoquiVitsAdapter
- Deploy all 3 engines via docker-compose
- Run parallel synthesis on test corpus

**Key Files to Create:**
1. `src/server/runtimes/fastPitch.ts` — FastPitchAdapter
2. `src/server/runtimes/coquiVits.ts` — CoquiVitsAdapter
3. Update `docker-compose.local.yml` with FastPitch & Coqui services
4. `src/features/voice-console/ProviderStatus.tsx` — Health check UI

**A/B Test Plan:**
- 200-utterance Nepali test corpus (phonetically diverse)
- Measure: latency (p50, p95, p99), CPU usage, GPU memory, PESQ score
- Evaluate on real calls if possible (A/B test different providers)

**Success Criteria:**
- All 3 engines within 20% latency of each other
- At least 1 alternative engine has quality ≥ Piper
- GPU-accelerated option reduces latency by 30%+

**Resource Needs:**
- 2 engineer-days (implementation)
- 1 engineer-day (A/B test setup)
- 2-3 reviewer-days (MOS evaluation)

---

### Week 6: UI & Operator Experience

**Objectives:**
- Add voice selector UI grouped by provider
- Add provider health status indicator
- Add "Test voice" button for preview
- Implement fallback logic in synthesizeWithFallback()

**Key Files to Create:**
1. `src/features/voice-console/VoiceSelector.tsx` — Provider-grouped voice selector
2. Fallback synthesis logic in `src/server/voice/pipeline.ts`

**Key UI Components:**
- Voice dropdown: "Piper Medium", "FastPitch Nepali", "Coqui VITS", grouped by provider
- Quality badges: "Low (fast)", "Medium (balanced)", "High (quality)"
- Latency display: p50 latency for each voice
- Health icons: ✓ healthy, ✗ unavailable, ⚠ degraded

**Resource Needs:**
- 1.5 engineer-days (UI components)
- 0.5 engineer-day (fallback synthesis logic)

---

## Phase 2.5: Fine-Tuning Workflow (2 weeks)

### Week 7: Voice Recording & Validation

**Objectives:**
- Build voice recording UI in Voice Lab
- Validate recording quality (duration, SNR, single speaker)
- Save recording session to database

**Key Files to Create:**
1. `src/features/voice-lab/RecordingPage.tsx` — Recording UI (extend existing)
2. `src/server/voice-lab/recordingProcessor.ts` — Audio validation + segmentation

**Recording Target:** 1-2 hours of Nepali speech from single speaker
- Phonetically diverse sentences (all Nepali phonemes)
- Audio quality checks: SNR > 20 dB, no clipping, single speaker only
- Estimated training time: 1-2 hours on GPU, ~8 hours on CPU

**Resource Needs:**
- 1 engineer-day (recording UI)
- 1 engineer-day (audio validation)

---

### Week 8: Model Training & Deployment

**Objectives:**
- Fine-tune Piper on custom voice data
- Package and deploy model to runtime
- Create Voice profile for fine-tuned model
- Test fine-tuned voice in real calls

**Training Options:**
- **Piper:** ~1 hour on GPU, ~4 hours on CPU (simplest path)
- **Coqui VITS:** ~2 hours on GPU, ~12 hours on CPU (higher quality)

**Key Files to Create:**
1. `src/server/voice-lab/modelDeployment.ts` — Model registration & deployment
2. `src/server/runtimes/customFineTuned.ts` — Custom model adapter

**Deliverable:** Fine-tuned "Sita" or "Mina" voice available in agent setup

**Resource Needs:**
- 1 engineer-day (training pipeline)
- 1 engineer-day (model deployment)
- 0.5 engineer-day (testing)

---

## Architecture Changes Summary

### New Adapter Pattern

```typescript
// All TTS engines implement same interface:
export interface TtsAdapter {
  health(): Promise<RuntimeHealthResult>;
  synthesize(input: { 
    text: string; 
    voicePath: string;     // voiceId → looks up provider config
  }): Promise<{
    audioBase64: string;
    mimeType: string;
    providerId?: string;
    voiceId?: string;
  }>;
}
```

### Voice Profile Enhancement

```typescript
export interface Voice {
  // ... existing fields ...
  
  // NEW: Specify which provider/model to use
  ttsProviderConfig?: {
    providerId: string;      // "piper", "fastpitch", "coqui"
    modelId: string;         // provider-specific model key
    voiceKey: string;        // voice identifier for provider
    qualityTier: "low" | "medium" | "high";
    costMetrics: {
      cpuCoreSeconds: number;
      latencyMs: number;
    };
  };
  
  // NEW: Fallback chain when primary provider unavailable
  fallbackChain?: string[];  // [voiceId2, voiceId3, ...]
}
```

### Runtime Selection

```
Agent (voiceId: "voice_piper_google_ne_medium")
  ↓
Voice record + ttsProviderConfig
  ↓
ModelRuntime + adapter ("piper")
  ↓
TtsAdapterForAgent() → PiperAdapter instance
  ↓
Synthesize with fallback chain
  ↓
Audio output
```

---

## Docker Deployment

### Phase 1: Piper Only (MVP)

```bash
docker-compose -f docker-compose.local.yml up piper-tts lipivoice-app
```

**Resource footprint:**
- CPU: 2 cores (light usage)
- RAM: 4 GB
- Storage: 500 MB (Piper model + app)

### Phase 2: Full Stack (A/B Testing)

```bash
docker-compose -f docker-compose.local.yml up \
  piper-tts fastpitch-tts coqui-tts lipivoice-app
```

**Resource footprint:**
- CPU: 4 cores
- RAM: 8 GB
- GPU: RTX 3080 (or equiv) — optional, enables GPU-accelerated engines
- Storage: 2 GB

---

## Risk & Contingency

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Piper Nepali quality poor | Phase 1 fails | A) Test early (day 1); B) Fallback to Google TTS |
| Service latency > 500ms | User experience | Use low quality tier; GPU-accelerate; reduce batch size |
| Fine-tuning training time too long | Phase 2.5 slips | Run on cloud GPU (Lambda Labs); pre-sample from larger dataset |
| GPU OOM on FastPitch/Coqui | Phase 2 blocked | Run CPU-only; reduce batch size; use smaller model variant |

---

## Success Metrics (Phase 1)

- ✅ Piper MVP deployed in docker-compose
- ✅ Voice turns complete with Piper audio (no crashes)
- ✅ Latency p50 < 250ms, p99 < 500ms
- ✅ MOS score ≥ 3.5 / 5.0
- ✅ CPU usage < 2 cores per call
- ✅ Setup guide written & tested

## Success Metrics (Phase 2)

- ✅ All 3 engines (Piper, FastPitch, Coqui) healthy & responding
- ✅ At least 1 alternative to Piper within 20% latency with ≥ quality
- ✅ Voice selector UI functional & tested
- ✅ Fallback chain working end-to-end
- ✅ A/B test results documented

## Success Metrics (Phase 2.5)

- ✅ First custom fine-tuned voice deployed (e.g., Sita)
- ✅ Voice profile registered in agent setup
- ✅ Test synthesis successful with custom voice
- ✅ Fine-tuning process documented for team

---

## Team Assignments (Suggested)

- **Voice Engineering (2 FTE):**
  - Week 1-2: PiperAdapter, integration, testing
  - Week 3: Quality validation, MOS evaluation
  - Week 4-6: FastPitch & Coqui adapters, A/B testing, UI
  - Week 7-8: Fine-tuning pipeline

- **DevOps (0.5 FTE):**
  - Week 1: Docker setup for Piper service
  - Week 4: Docker updates for FastPitch & Coqui

- **Product/QA (1 FTE):**
  - Week 3, 6: MOS evaluation & quality reviews
  - Week 8: Fine-tuning validation

---

## Next Steps

1. **Approve Phase 1 scope** (PiperAdapter + tests)
2. **Reserve compute:** 1 GPU machine (for Phase 2) or 2 CPU machines for testing
3. **Procure Nepali test data:** Download Piper models, collect 200-utterance test corpus
4. **Kick-off Week 1:** PiperAdapter implementation sprint

See main design document: `/docs/superpowers/specs/2026-06-24-self-hosted-tts-multi-adapter.md`
