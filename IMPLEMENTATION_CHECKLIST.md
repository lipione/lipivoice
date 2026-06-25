# Multi-Adapter TTS Implementation Checklist

Use this checklist to track progress through all phases.

---

## Phase 1: Piper MVP (Weeks 1-3)

### Week 1: Core Implementation

#### Monday-Tuesday: Foundation

- [ ] **piperOssv2.ts:** Implement PiperAdapter class
  - [ ] `health()` method (check service at PIPER_SERVICE_URL/health)
  - [ ] `synthesize()` method (POST to /synthesize)
  - [ ] Error handling (timeout, unavailable, missing_model)
  - [ ] Voice path mapping (voiceId → model name)
  - [ ] Unit test: health checks work
  - [ ] Unit test: synthesize returns base64 audio
  - [ ] Unit test: error handling

- [ ] **types.ts:** Extend TtsAdapter interface (optional)
  - [ ] Add TtsAdapterMetadata interface (for Phase 2)
  - [ ] Document voicePath parameter meaning

- [ ] **ttsConfig.ts:** Create TTS configuration constants
  - [ ] Define PiperVoiceDefinition interface
  - [ ] List Piper Nepali voices (low, medium, high)
  - [ ] Add HuggingFace download URLs

#### Wednesday-Thursday: Integration

- [ ] **types.ts (domain):** Extend Voice interface
  - [ ] Add `ttsProviderConfig?: TtsProviderVoiceConfig`
  - [ ] Add `fallbackChain?: string[]`
  - [ ] Type TtsProviderVoiceConfig

- [ ] **socketDeps.ts:** Enhance ttsAdapterForAgent()
  - [ ] Refactor to extract voice runtime
  - [ ] Build fallback adapter chain from voice.fallbackChain
  - [ ] Return { adapter, providerId, fallbackChain }
  - [ ] Unit test: returns correct adapter for voice

- [ ] **pipeline.ts:** Add fallback synthesis logic
  - [ ] Implement `synthesizeWithFallback()` function
  - [ ] Loop through adapters in order
  - [ ] Log fallback attempts
  - [ ] Throw after all adapters fail

#### Friday: Configuration & Defaults

- [ ] **config.ts:** Add TTS environment variables
  - [ ] PIPER_SERVICE_URL (default: http://localhost:8005)
  - [ ] PIPER_VOICE_PATH (default: ~/.local/share/piper/models)
  - [ ] Parse from env in ServerConfig

- [ ] **defaults.ts:** Register Piper voices
  - [ ] Add runtime_piper ModelRuntime
  - [ ] Add 3 ModelAsset entries (low, medium, high)
  - [ ] Add 3 Voice entries with ttsProviderConfig
  - [ ] Set up fallback chains (medium → low → Coqui)

- [ ] **docker-compose.local.yml:** Create services
  - [ ] Piper TTS service (synesthesiam/piper)
  - [ ] Health check for Piper
  - [ ] Volume mount for models
  - [ ] LipiVoice app service (depends on Piper)
  - [ ] Environment variable pass-through

#### Friday Afternoon: First Integration Test

- [ ] Start docker-compose locally
- [ ] Verify Piper health endpoint responds
- [ ] Call /api/tts/test endpoint (if exists) with Nepali text
- [ ] Confirm base64 audio output
- [ ] Basic smoke test complete

---

### Week 2: Quality & Testing

#### Monday: Test Coverage

- [ ] **piperOssv2.test.ts:** Write comprehensive unit tests
  - [ ] Health check returns healthy (mock service)
  - [ ] Health check returns unavailable (mock error)
  - [ ] Health check returns missing_model (empty models list)
  - [ ] Synthesize returns audio
  - [ ] Synthesize throws on timeout
  - [ ] Synthesize throws on invalid voice path
  - [ ] Voice path mapping works correctly
  - [ ] Test coverage > 90%

- [ ] **socketDeps test:** Test adapter selection
  - [ ] ttsAdapterForAgent returns correct adapter
  - [ ] ttsAdapterForAgent builds fallback chain correctly
  - [ ] ttsAdapterForAgent returns null if no voice found

- [ ] **pipeline test:** Test fallback synthesis
  - [ ] Primary adapter succeeds → return audio
  - [ ] Primary adapter fails → try fallback
  - [ ] All adapters fail → throw error
  - [ ] Fallback order correct

#### Tuesday-Wednesday: Integration Testing

- [ ] Deploy Piper in docker-compose
- [ ] Download model: ne_NP-google_medium.onnx
- [ ] Test voice turns end-to-end
  - [ ] STT → LLM → TTS (Piper)
  - [ ] Audio output correct
  - [ ] No crashes or errors
- [ ] Test with different quality tiers
  - [ ] Verify latency differences (low < medium < high)
  - [ ] All tiers produce valid audio

- [ ] **Performance baseline:**
  - [ ] Measure latency p50, p95, p99 for medium quality
  - [ ] Record: CPU usage, memory, model load time
  - [ ] Verify p50 < 250ms, p99 < 500ms (goal)

#### Thursday-Friday: Quality Evaluation

- [ ] **Prepare test corpus:**
  - [ ] Select 10-15 diverse Nepali sentences
  - [ ] Mix of short (< 5 sec) and medium (5-15 sec) utterances
  - [ ] Include various phonemes and consonant clusters

- [ ] **Record baseline evaluation:**
  - [ ] Synthesize all sentences with Piper medium
  - [ ] Save audio samples to folder
  - [ ] Document any pronunciation issues

- [ ] **Optional: Compare with Google TTS**
  - [ ] If credentials available, synthesize same corpus
  - [ ] Side-by-side listen test
  - [ ] Document pros/cons (quality, latency, pronunciation)

- [ ] **Initial MOS evaluation** (informal):
  - [ ] Play samples to 2-3 native Nepali speakers
  - [ ] Rate naturalness on 1-5 scale
  - [ ] Document mean score
  - [ ] Note any specific pronunciation errors

#### Friday Afternoon: Checkpoint

- [ ] All tests passing
- [ ] Latency target met (p50 < 250ms or documented trade-off)
- [ ] MOS score documented (target ≥ 3.5)
- [ ] No critical bugs
- [ ] Ready for Phase 1.5

---

### Week 3: Refinement & Documentation

#### Monday-Tuesday: Quality Tuning

- [ ] **Review latency results:**
  - [ ] If p50 > 250ms: adjust quality tier or GPU-accelerate
  - [ ] If p99 too high: investigate service bottleneck
  - [ ] Profile Piper adapter code (any slow paths?)

- [ ] **Review pronunciation:**
  - [ ] Any consistent mispronunciations?
  - [ ] Compare Piper low/medium/high (which best?)
  - [ ] If critical issues: document fallback to Google TTS

- [ ] **Stability testing:**
  - [ ] Run 100 consecutive synthesis calls
  - [ ] Check for memory leaks (RSS should stabilize)
  - [ ] Verify no service crashes

#### Wednesday: Documentation

- [ ] **docs/VOICE_SETUP.md** - Operator guide
  - [ ] Prerequisites (Docker, space)
  - [ ] Download Piper models (script)
  - [ ] Run docker-compose command
  - [ ] Verify health endpoints
  - [ ] Troubleshooting section
  - [ ] Performance tips

- [ ] **In-code documentation:**
  - [ ] PiperAdapter class: JSDoc comments
  - [ ] Voice profile mapping: explain ttsProviderConfig
  - [ ] Fallback synthesis: explain chain logic

- [ ] **Design doc updates:**
  - [ ] Verify all sections match implementation
  - [ ] Add actual latency/MOS results
  - [ ] Update resource requirements if different
  - [ ] Add known issues or workarounds

#### Thursday-Friday: Final Integration & Demo

- [ ] **End-to-end test with all components:**
  - [ ] STT → LLM → TTS (Piper) → audio output
  - [ ] Test interruption (stop mid-synthesis)
  - [ ] Test error recovery
  - [ ] Test voice selection change mid-call

- [ ] **Fallback chain test:**
  - [ ] Stop Piper service
  - [ ] Verify fallback logic triggers
  - [ ] Confirm audio still works (if fallback available)
  - [ ] Restart Piper, confirm back to primary

- [ ] **Demo readiness:**
  - [ ] Prepare 2-3 minute demo script
  - [ ] Record demo call with Piper audio
  - [ ] Share results with team
  - [ ] Collect feedback

#### End of Week 3 Gate

- ✅ Phase 1 MVP complete: Piper TTS working end-to-end
- ✅ Latency acceptable (or documented workaround)
- ✅ Quality acceptable (MOS ≥ 3.5 or plan to improve)
- ✅ Tests passing, no critical bugs
- ✅ Operator guide published
- ✅ Ready for Phase 2 planning (or proceed if on schedule)

---

## Phase 2: Multi-Adapter Testing (Weeks 4-6)

### Week 4-5: FastPitch & Coqui Implementation

- [ ] **fastPitch.ts:** Implement FastPitchAdapter
  - [ ] HTTP service integration
  - [ ] Health check
  - [ ] Synthesize with speaker_id
  - [ ] Error handling

- [ ] **coquiVits.ts:** Implement CoquiVitsAdapter
  - [ ] HTTP service integration
  - [ ] Health check
  - [ ] Synthesize with model_key
  - [ ] Error handling

- [ ] **docker-compose.local.yml:** Add services
  - [ ] fastpitch-tts service (with GPU option)
  - [ ] coqui-tts service (with GPU toggle)
  - [ ] Health checks for both
  - [ ] Update lipivoice-app dependencies

- [ ] **config.ts:** Add Phase 2 env vars
  - [ ] FASTPITCH_ENABLED, FASTPITCH_SERVICE_URL
  - [ ] COQUI_ENABLED, COQUI_SERVICE_URL, COQUI_GPU_ENABLED

- [ ] **defaults.ts:** Register Phase 2 voices
  - [ ] Add runtime_fastpitch, runtime_coqui
  - [ ] Add model assets for both
  - [ ] Add Voice entries with ttsProviderConfig
  - [ ] Set fallback chains

- [ ] **socketDeps.ts:** Add to ttsAdapters map
  - [ ] Load FastPitchAdapter if enabled
  - [ ] Load CoquiVitsAdapter if enabled
  - [ ] Pass to voiceSocketDeps

- [ ] **Unit & integration tests:** FastPitch & Coqui
  - [ ] Health checks
  - [ ] Synthesize calls
  - [ ] Error handling

### Week 6: UI & Operator Experience

- [ ] **VoiceSelector.tsx:** Create voice selection component
  - [ ] Group voices by provider
  - [ ] Display quality tier badges
  - [ ] Show latency info
  - [ ] "Test voice" button for preview

- [ ] **ProviderStatus.tsx:** Health status component
  - [ ] List all providers
  - [ ] Show health status (✓, ✗, ⚠)
  - [ ] Display latency if available
  - [ ] Auto-refresh every 30s

- [ ] **A/B test setup:**
  - [ ] Create 200-utterance test corpus (Nepali)
  - [ ] Synthesize with Piper, FastPitch, Coqui
  - [ ] Measure latency, CPU, GPU, PESQ
  - [ ] Document results

- [ ] **Fallback chain configuration:**
  - [ ] Finalize fallback order (based on A/B test results)
  - [ ] Test end-to-end with primary + fallbacks

- [ ] **Phase 2 documentation:**
  - [ ] Update VOICE_SETUP.md with Phase 2 options
  - [ ] Document A/B test results
  - [ ] Recommend quality/latency trade-off per provider

#### End of Week 6 Gate

- ✅ All 3 adapters implemented & tested
- ✅ UI components working
- ✅ A/B test complete (quality/latency metrics)
- ✅ Fallback chains configured
- ✅ Ready for Phase 2.5 or production deployment

---

## Phase 2.5: Fine-Tuning Workflow (Weeks 7-8)

### Week 7: Voice Recording & Validation

- [ ] **RecordingPage.tsx:** Extend voice-lab UI
  - [ ] Recording interface (start/stop)
  - [ ] Time tracking (target 1-2 hours)
  - [ ] Display sample text to record
  - [ ] Save recordings locally

- [ ] **recordingProcessor.ts:** Validation pipeline
  - [ ] Duration check (min 45 min for Piper)
  - [ ] Audio quality check (SNR, clipping)
  - [ ] Single speaker verification
  - [ ] Segment into 5-10 sec chunks
  - [ ] Return ready/not_ready status

- [ ] **Database schema:** Voice recording session
  - [ ] Store recording metadata
  - [ ] Link to voice profile (once trained)
  - [ ] Track training progress

- [ ] **Test with sample data:**
  - [ ] Record 1 hour of Nepali speech (operator or volunteer)
  - [ ] Run through validation pipeline
  - [ ] Verify quality checks work

### Week 8: Model Training & Deployment

- [ ] **modelDeployment.ts:** Training orchestration
  - [ ] Start Piper fine-tuning job
  - [ ] Monitor training progress
  - [ ] Save model checkpoint
  - [ ] Convert to ONNX if needed

- [ ] **customFineTuned.ts:** Custom model adapter
  - [ ] Wraps base adapter (Piper or Coqui)
  - [ ] Loads fine-tuned model
  - [ ] Synthesize with custom voice

- [ ] **Voice profile creation:**
  - [ ] Register fine-tuned model as ModelAsset
  - [ ] Create Voice entry with custom config
  - [ ] Add fallback chain (to Piper high-quality)

- [ ] **End-to-end testing:**
  - [ ] Record training data (1 hour)
  - [ ] Train model (~1-2 hours on GPU)
  - [ ] Deploy model to runtime
  - [ ] Test synthesis with custom voice
  - [ ] Use in live agent call

- [ ] **Documentation:**
  - [ ] Document fine-tuning workflow (for team)
  - [ ] Record training times on various hardware
  - [ ] Publish voice profile example

#### End of Week 8 Gate

- ✅ Fine-tuning pipeline complete
- ✅ First custom voice trained & deployed
- ✅ Voice usable in agent setup
- ✅ Process documented for team reuse
- ✅ Phase 2.5 complete

---

## Pre-Implementation Checklist

Before starting Week 1, ensure:

- [ ] Design doc reviewed & approved by stakeholders
- [ ] 2 FTE engineers allocated (voice infrastructure)
- [ ] 0.5 FTE DevOps allocated (docker, services)
- [ ] Machine ready: 4+ cores, 8 GB RAM, 2 GB storage
- [ ] GPU machine reserved for Phase 2 (optional but recommended)
- [ ] Piper Nepali models downloaded or script prepared
- [ ] Test corpus prepared (200 Nepali sentences)
- [ ] Repo ready for feature branch (git feature/multi-adapter-tts)

---

## Daily Standup Template

```
Date: YYYY-MM-DD
Week: X of Y
Phase: 1 / 2 / 2.5

Completed:
- [x] Item 1
- [x] Item 2

In Progress:
- [ ] Item 3
- [ ] Item 4

Blockers:
- (None) or description

Next:
- [ ] Item 5 (owner: name)
- [ ] Item 6 (owner: name)

Metrics:
- Latency p50: XXX ms
- MOS: X.X / 5.0
- Test coverage: XX%
```

---

## Definition of Done

### Phase 1
- [ ] PiperAdapter implemented & tested
- [ ] Voice profiles with fallback chains working
- [ ] Latency p50 < 250ms, p99 < 500ms
- [ ] MOS ≥ 3.5 / 5.0
- [ ] All tests passing
- [ ] Operator guide published
- [ ] Demo successful

### Phase 2
- [ ] FastPitch & Coqui adapters implemented
- [ ] All 3 engines health-checking
- [ ] A/B test results documented
- [ ] Voice selector UI working
- [ ] Provider status UI working
- [ ] At least 1 alternative ≥ Piper quality
- [ ] All tests passing

### Phase 2.5
- [ ] Recording UI functional
- [ ] Validation pipeline working
- [ ] Training pipeline functional
- [ ] Custom model deployed & usable
- [ ] End-to-end fine-tuning tested
- [ ] Process documented
- [ ] All tests passing

---

## Risk Mitigation Checklist

### During Phase 1

- [ ] Week 1: Validate Piper installation early
- [ ] Week 1: Check Nepali pronunciation on day 1
- [ ] Week 2: If latency > 300ms, plan workaround (GPU or quality downgrade)
- [ ] Week 2: If MOS < 3.5, consider Google TTS fallback
- [ ] Week 3: Stability test (100 consecutive calls)
- [ ] Week 3: Memory leak check

### During Phase 2

- [ ] Week 4: Verify GPU space before FastPitch deployment
- [ ] Week 5: Test GPU OOM scenarios (batch_size reduction)
- [ ] Week 6: A/B test on real calls (not just samples)
- [ ] Week 6: Fallback chain tested thoroughly

### During Phase 2.5

- [ ] Week 7: Validate recording quality before training
- [ ] Week 8: Test model deployment in isolated env first
- [ ] Week 8: Verify fallback chain includes Piper (not just custom)

---

## Success Metrics Tracking

Create a metrics spreadsheet with these columns:

| Date | Metric | Phase 1 Target | Phase 1 Actual | Phase 2 Target | Phase 2 Actual |
|------|--------|---|---|---|---|
| Latency p50 (ms) | < 250 | | | < 300 | |
| Latency p99 (ms) | < 500 | | | < 600 | |
| MOS Score | ≥ 3.5 | | | ≥ 3.7 | |
| CPU cores per call | < 2 | | | < 2.5 | |
| GPU memory (GB) | N/A | | | < 2 | |
| Test coverage | > 90% | | | > 85% | |
| Uptime (72h) | > 99% | | | > 99.5% | |

---

## Sign-Off

**Phase 1 Sign-Off** (EOW 3)
- [ ] Engineering lead: ____________________  Date: _______
- [ ] Product owner: ____________________  Date: _______

**Phase 2 Sign-Off** (EOW 6)
- [ ] Engineering lead: ____________________  Date: _______
- [ ] Product owner: ____________________  Date: _______

**Phase 2.5 Sign-Off** (EOW 8)
- [ ] Engineering lead: ____________________  Date: _______
- [ ] Product owner: ____________________  Date: _______

---

**Last Updated:** 2026-06-24  
**Owner:** Voice Infrastructure Team  
**Next Review:** End of Week 1
