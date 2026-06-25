# Multi-Adapter TTS Design - Complete Index

**Status:** Design Complete & Ready for Implementation  
**Date:** 2026-06-24  
**Duration:** 8-10 weeks (Phase 1: 3 weeks, Phase 2: 3 weeks, Phase 2.5: 2 weeks)

---

## Quick Navigation

### Start Here
1. **[DESIGN_SUMMARY.md](./DESIGN_SUMMARY.md)** ← **START HERE** (5 min read)
   - Executive summary: what, why, how
   - Phase overview with timeline
   - Key design decisions
   - Resource requirements

2. **[IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md)** (15 min read)
   - Week-by-week task breakdown
   - Daily standup template
   - Success criteria per phase
   - Risk mitigation

### Comprehensive Design Documentation

3. **[docs/superpowers/specs/2026-06-24-self-hosted-tts-multi-adapter.md](./docs/superpowers/specs/2026-06-24-self-hosted-tts-multi-adapter.md)** (90 min read)
   - **Complete design with 14 sections:**
     - TTS Adapter Interface (TypeScript)
     - Provider Implementations (Piper, FastPitch, Coqui, Custom)
     - Voice Profile Schema
     - Runtime Voice Selection Logic
     - Self-Hosted Deployment (Docker Compose)
     - Fine-Tuning Workflow (Phase 2)
     - Operator UI Sketches
     - Configuration System
     - Testing Strategy
     - Integration with Existing System
     - Migration Path
     - Risk Mitigation
     - Files to Create/Modify
     - Nepali Voice Profile Examples

4. **[docs/superpowers/plans/2026-06-24-tts-multi-adapter-roadmap.md](./docs/superpowers/plans/2026-06-24-tts-multi-adapter-roadmap.md)** (20 min read)
   - Week-by-week roadmap (Phase 1, Phase 2, Phase 2.5)
   - Resource allocation by team
   - Success metrics per phase
   - Risk & contingency table

### Architecture & Reference

5. **[docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md](./docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md)** (45 min read)
   - System architecture diagram
   - Voice profile → runtime mapping flow
   - Adapter interface (reused pattern)
   - Runtime adapter selection (code example)
   - Synthesis with fallback (code example)
   - Docker Compose deployment
   - Configuration flow
   - Voice profile examples (Phase 1, 2, 2.5)
   - Fallback chain example
   - Testing strategy (unit, integration)
   - Checklist: from design to deployment

### Code Scaffolding

6. **[src/server/runtimes/piperOssv2.ts.scaffold](./src/server/runtimes/piperOssv2.ts.scaffold)** (reference)
   - Complete PiperAdapter implementation
   - Ready to copy and adapt
   - Full JSDoc comments
   - Voice path mapping
   - Error handling examples

---

## Document Map by Audience

### For Engineering Leads
1. Start: **DESIGN_SUMMARY.md** (overview & timeline)
2. Then: **IMPLEMENTATION_CHECKLIST.md** (task breakdown)
3. Reference: **docs/superpowers/specs/** (technical details)
4. Check: **docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md** (integration points)

### For Implementation Engineers
1. Start: **DESIGN_SUMMARY.md** (context)
2. Then: **docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md** (architecture)
3. Then: **docs/superpowers/specs/** (detailed requirements)
4. Reference: **piperOssv2.ts.scaffold** (code template)
5. Track: **IMPLEMENTATION_CHECKLIST.md** (week-by-week)

### For DevOps/Infrastructure
1. Start: **DESIGN_SUMMARY.md** (resource requirements)
2. Then: **docs/superpowers/specs/** (section 5: Docker Compose)
3. Reference: **docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md** (configuration)

### For Product/QA
1. Start: **DESIGN_SUMMARY.md** (high-level overview)
2. Then: **docs/superpowers/plans/** (roadmap & success metrics)
3. Reference: **IMPLEMENTATION_CHECKLIST.md** (definition of done)

---

## Key Sections by Topic

### Design Decisions
- **Where?** DESIGN_SUMMARY.md → "Key Design Decisions" (4 decisions)
- **Deep dive?** docs/superpowers/specs/ → Sections 1-3

### Voice Profiles
- **Quick overview?** DESIGN_SUMMARY.md → "Phase 1 Voice Profiles"
- **Detailed schema?** docs/superpowers/specs/ → Section 3
- **Examples?** docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md → "Voice Profile Examples"

### Implementation Timeline
- **Week-by-week?** IMPLEMENTATION_CHECKLIST.md → Phase 1/2/2.5 sections
- **High-level roadmap?** docs/superpowers/plans/ → "Quick Summary"
- **Resource allocation?** docs/superpowers/plans/ → "Team Assignments"

### Docker Deployment
- **Phase 1 (MVP)?** DESIGN_SUMMARY.md → "Resource Requirements"
- **Full spec?** docs/superpowers/specs/ → Section 5
- **Examples?** docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md → "Docker Compose Deployment"

### Fallback Synthesis
- **Overview?** DESIGN_SUMMARY.md → "Architecture in 30 Seconds"
- **Code example?** docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md → "Synthesis with Fallback"
- **Full spec?** docs/superpowers/specs/ → Section 4

### Testing Strategy
- **Phase 1?** IMPLEMENTATION_CHECKLIST.md → Week 2 section
- **Full spec?** docs/superpowers/specs/ → Section 9
- **A/B testing?** docs/superpowers/plans/ → Week 4-6 section

### Fine-Tuning Workflow
- **Overview?** DESIGN_SUMMARY.md → "Phase 2.5: Fine-Tuning"
- **Full workflow?** docs/superpowers/specs/ → Section 6
- **Implementation?** IMPLEMENTATION_CHECKLIST.md → Week 7-8 section

---

## Critical Implementation Points

### Phase 1 (Weeks 1-3)
**What:** Piper MVP with 3 Nepali voices (low/medium/high quality)

**Why:** Proven Nepali support, CPU-only (no GPU needed), lightweight

**Success Criteria:**
- Latency p50 < 250ms, p99 < 500ms
- MOS ≥ 3.5 / 5.0
- Voice turns complete end-to-end
- Operator guide published

**Key Files to Create:**
```
src/server/runtimes/piperOssv2.ts
src/domain/ttsConfig.ts
docker-compose.local.yml
docs/VOICE_SETUP.md
```

**Key Files to Modify:**
```
src/domain/types.ts              (add ttsProviderConfig & fallbackChain)
src/server/voice/socketDeps.ts   (enhanced adapter selection)
src/server/voice/pipeline.ts     (add synthesizeWithFallback)
src/domain/defaults.ts           (register Piper voices)
```

---

### Phase 2 (Weeks 4-6)
**What:** Add FastPitch & Coqui adapters, A/B test all 3 engines

**Why:** Compare quality vs. latency, find best alternative to Piper

**Success Criteria:**
- All 3 adapters operational & health-checking
- At least 1 alternative ≥ Piper quality within 20% latency
- A/B test results documented
- Voice selector UI functional

**New Providers:**
- **FastPitch:** GPU-accelerated, faster, higher quality
- **Coqui VITS:** Alternative backend, easier fine-tuning

---

### Phase 2.5 (Weeks 7-8)
**What:** Fine-tuning workflow + first custom voice

**Why:** Enable custom voice training on recorded data

**Success Criteria:**
- Recording UI functional
- Validation pipeline working
- First custom voice trained & deployed
- Process documented for team

---

## Architecture Summary

```
Agent Voice Call
    ↓
Voice Profile (voiceId)
    ├─ ttsProviderConfig (provider, model, quality)
    └─ fallbackChain (alternative voices)
    ↓
TTS Adapter Selection
    ├─ Find voice.runtimeId
    ├─ Get Runtime (adapter = "piper" / "fastpitch" / etc.)
    └─ Load TtsAdapter instance
    ↓
Synthesis
    ├─ Try primary adapter
    ├─ On error: iterate fallbackChain
    └─ Return audio or throw
    ↓
Audio Output to User
```

## Voice Provider Matrix

| Provider | Phase | Backend | Quality | Latency | CPU | GPU | Cost |
|----------|-------|---------|---------|---------|-----|-----|------|
| **Piper** | 1 | ONNX | Medium | 200ms | 0.8 core | No | Free |
| **FastPitch** | 2 | PyTorch/HiFi-GAN | High | 120ms | 0.2 core | Yes (2GB) | Free |
| **Coqui VITS** | 2 | VITS | High | 180ms | 0.5 core | Optional | Free |
| **Custom** | 2.5 | Piper/Coqui | High | 250ms | Variable | Optional | Free |

---

## Resource Checklist

### Phase 1 MVP
- [ ] 2 FTE engineers (voice infrastructure)
- [ ] 0.5 FTE DevOps
- [ ] 2-core CPU machine, 4 GB RAM, 500 MB storage
- [ ] Piper Nepali models (download from HF)
- [ ] 200 Nepali test sentences

### Phase 2 Multi-Adapter
- [ ] +1 GPU machine (RTX 3080 or equiv) optional but recommended
- [ ] +1 GB storage (FastPitch & Coqui models)
- [ ] +2 reviewer-days (MOS evaluation)

### Phase 2.5 Fine-Tuning
- [ ] 1 hour of Nepali speech (recorded)
- [ ] GPU machine (1-2 hours training time)
- [ ] Native Nepali speaker for quality validation

---

## Quick Reference Links

### Models & Datasets
- **Piper Voices:** https://huggingface.co/rhasspy/piper-voices
  - Download: `ne/ne_NP/google/ne_NP-google_{low,medium,high}.onnx`
- **FastPitch:** https://github.com/nvidia/fastpitch
- **Coqui TTS:** https://github.com/coqui-ai/TTS
- **Nepali Data:** https://commonvoice.mozilla.org (search "Nepali")

### Relevant Code
- Existing TtsAdapter: `src/server/runtimes/googleCloudTts.ts`
- Existing LlmAdapter pattern: `src/server/runtimes/openAiCompatible.ts`
- Voice selection: `src/server/voice/socketDeps.ts` → `ttsAdapterForAgent()`
- Voice profiles: `src/domain/defaults.ts` → `createLipiVoiceNepaliVoices()`

---

## FAQ

**Q: Why reuse the TtsAdapter interface instead of creating a new one?**
A: Existing interface is minimal and sufficient. We extend it optionally in Phase 2 with metadata for richer introspection (latency estimates, capabilities).

**Q: What if Piper latency is too high?**
A: Use "low" quality tier (150ms), or implement GPU acceleration with ONNX Runtime. Falls back to low automatically if medium is slow.

**Q: Do we need GPU for Phase 1?**
A: No. Piper CPU synthesis is < 300ms for ~10-second utterances. GPU optional for Phase 2 (FastPitch, Coqui).

**Q: Can we skip Phase 2?**
A: Yes, Phase 1 MVP is production-ready. Phase 2 is optional quality improvement. Phase 2.5 (fine-tuning) can be added later.

**Q: What if fine-tuning data is scarce?**
A: Minimum 45 minutes for Piper, 1 hour for Coqui. Use phonetically diverse sentences to maximize coverage. Can augment with TTS-generated data.

**Q: How do we measure MOS?**
A: Collect 10-20 audio samples. Play to 3-5 native speakers. Rate naturalness on 1-5 scale. Calculate mean = MOS score.

---

## Commit Message Format (for implementation)

When implementing, use commit messages following this pattern:

```
feat(tts): implement Piper adapter for Nepali synthesis

- Add PiperAdapter class in src/server/runtimes/piperOssv2.ts
- Extend Voice interface with ttsProviderConfig
- Add voice profile fallback chain support
- Register Piper Nepali voices (low, medium, high) in defaults
- Add PIPER_SERVICE_URL env var

Test coverage: 90%+
Latency: p50 < 250ms, p99 < 500ms
MOS: 3.5+ / 5.0

Closes #XXXX
```

---

## Progress Tracking

### Status Board Template

```markdown
# Phase 1: Piper MVP

## Week 1: Core Implementation
- [x] PiperAdapter (piperOssv2.ts)
- [x] Voice interface extension
- [x] socketDeps.ts integration
- [ ] docker-compose setup

## Week 2: Quality & Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] Performance baseline
- [ ] MOS evaluation

## Week 3: Refinement
- [ ] Latency tuning
- [ ] Documentation
- [ ] Final integration test
- [ ] Demo readiness

Blockers: None
Next: Start Week 2
```

---

## Sign-Off & Approval

**Design Review:**
- [ ] Engineering Lead
- [ ] Product Owner
- [ ] DevOps Lead
- [ ] Voice Research (if available)

**Ready to Implement:**
- [ ] All stakeholders approved
- [ ] Resources allocated
- [ ] Risks acknowledged
- [ ] Success metrics defined

---

## Contact & Support

For questions during implementation:

1. **Architecture questions?** → Review `docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md` (Section: relevant topic)
2. **Code scaffolding?** → Reference `piperOssv2.ts.scaffold`
3. **Timeline/schedule?** → Check `IMPLEMENTATION_CHECKLIST.md` (Week X section)
4. **Risk mitigation?** → See `docs/superpowers/specs/` (Section 12: Risk Mitigation)

**Key contacts:**
- Voice Lead: `[name]`
- DevOps Lead: `[name]`
- Product Owner: `[name]`

---

## Appendix: File Structure After Implementation

```
LipiVoice/
├── src/
│   ├── domain/
│   │   ├── types.ts                          (MODIFIED: Voice interface)
│   │   ├── defaults.ts                       (MODIFIED: Piper voices)
│   │   ├── ttsConfig.ts                      (NEW: Phase 1)
│   │   └── voiceProfiles.ts                  (NEW: Phase 1)
│   │
│   ├── server/
│   │   ├── runtimes/
│   │   │   ├── types.ts                      (MODIFIED: TtsAdapter)
│   │   │   ├── piperOssv2.ts                 (NEW: Phase 1)
│   │   │   ├── fastPitch.ts                  (NEW: Phase 2)
│   │   │   ├── coquiVits.ts                  (NEW: Phase 2)
│   │   │   ├── customFineTuned.ts            (NEW: Phase 2.5)
│   │   │   ├── piperOssv2.test.ts            (NEW: Phase 1)
│   │   │   ├── fastPitch.test.ts             (NEW: Phase 2)
│   │   │   └── coquiVits.test.ts             (NEW: Phase 2)
│   │   │
│   │   ├── voice/
│   │   │   ├── socketDeps.ts                 (MODIFIED: adapter selection)
│   │   │   ├── pipeline.ts                   (MODIFIED: fallback synthesis)
│   │   │   └── pipeline.test.ts              (MODIFIED: add fallback tests)
│   │   │
│   │   ├── config.ts                         (MODIFIED: TTS env vars)
│   │   │
│   │   └── voice-lab/
│   │       ├── recordingProcessor.ts         (NEW: Phase 2.5)
│   │       └── modelDeployment.ts            (NEW: Phase 2.5)
│   │
│   └── features/
│       ├── voice-console/
│       │   ├── VoiceSelector.tsx             (NEW: Phase 2)
│       │   └── ProviderStatus.tsx            (NEW: Phase 2)
│       │
│       └── voice-lab/
│           └── RecordingPage.tsx             (MODIFIED: Phase 2.5)
│
├── docs/
│   ├── superpowers/
│   │   ├── specs/
│   │   │   └── 2026-06-24-self-hosted-tts-multi-adapter.md
│   │   └── plans/
│   │       └── 2026-06-24-tts-multi-adapter-roadmap.md
│   │
│   ├── ARCHITECTURE-MULTI-ADAPTER-TTS.md
│   └── VOICE_SETUP.md                       (NEW: Phase 1)
│
├── docker-compose.local.yml                 (NEW: Phase 1)
│
├── DESIGN_SUMMARY.md                        (reference)
├── IMPLEMENTATION_CHECKLIST.md              (reference)
└── TTS_DESIGN_INDEX.md                      (this file)
```

---

**Last Updated:** 2026-06-24  
**Version:** 1.0 (Design Complete)  
**Next Review:** Start of Week 1 (implementation)

