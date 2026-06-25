# LipiVoice Multi-Adapter TTS Design - Delivery Summary

**Completed:** 2026-06-24  
**Status:** ✅ Design Complete & Ready for Implementation  
**Duration:** 8-10 weeks (Phase 1: 3 weeks, Phase 2: 3 weeks, Phase 2.5: 2 weeks)

---

## What Was Delivered

A **complete, production-ready design** for LipiVoice's next-generation TTS layer that supports multiple self-hosted Nepali speech synthesis engines (Piper, FastPitch, Coqui, custom fine-tuned models) with automatic fallback and easy runtime switching.

### 7 Comprehensive Documents

#### 1. **DESIGN_SUMMARY.md** (3 KB, 5-minute read)
**Quick reference guide covering:**
- Executive summary & high-level overview
- Architecture in 30 seconds
- Key design decisions (4 critical choices)
- Implementation phases overview
- Resource requirements per phase
- Voice profile examples
- Success metrics

**Use case:** Share with stakeholders, product team, engineers getting started

---

#### 2. **TTS_DESIGN_INDEX.md** (8 KB, 10-minute read)
**Navigation guide for all documentation:**
- Document map by audience (engineering lead, implementer, DevOps, product)
- Quick navigation links
- Key sections by topic
- Critical implementation points summary
- FAQ addressing common questions
- Resource checklist
- Commit message format
- Sign-off & approval workflow

**Use case:** Reference when you need to find a specific section, know where to look

---

#### 3. **IMPLEMENTATION_CHECKLIST.md** (18 KB, 30-minute read)
**Week-by-week task breakdown covering Phases 1-2.5:**
- **Phase 1 (3 weeks):**
  - Week 1: Core implementation (Friday smoke test)
  - Week 2: Quality testing & MOS evaluation
  - Week 3: Refinement & documentation
- **Phase 2 (3 weeks):** FastPitch & Coqui adapters, A/B testing, UI
- **Phase 2.5 (2 weeks):** Fine-tuning workflow, custom voice training

**Detailed sections:**
- Pre-implementation checklist
- Daily standup template
- Definition of done (per phase)
- Risk mitigation checklist
- Success metrics tracking spreadsheet
- Sign-off form

**Use case:** Engineering team reference during implementation, track progress weekly

---

#### 4. **docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md** (18 KB, 45-minute read)
**Technical architecture documentation:**
- System architecture diagram (ASCII)
- Voice profile → runtime mapping flow
- Adapter interface (reused pattern explanation)
- Runtime adapter selection (code example from socketDeps.ts)
- Synthesis with fallback (code example from pipeline.ts)
- Docker Compose deployment overview
- Configuration flow (env vars → config → adapters)
- Voice profile examples (Phase 1, 2, 2.5)
- Fallback chain concrete example
- Testing strategy (unit, integration)
- Implementation checklist

**Use case:** Engineers understanding how pieces fit together, integration points

---

#### 5. **docs/superpowers/specs/2026-06-24-self-hosted-tts-multi-adapter.md** (90 KB, 90-minute read)
**Complete specification with 14 sections:**

1. **TTS Adapter Interface** - Method signatures, input/output, error handling
2. **Provider Implementations:**
   - Piper (HTTP wrapper, 3 Nepali voices)
   - FastPitch (GPU-accelerated, Phase 2)
   - Coqui VITS (alternative backend, Phase 2)
   - Custom Fine-Tuned (Phase 2.5)
3. **Voice Profile Schema** - Extended interface with provider config & fallback chain
4. **Runtime Voice Selection Logic** - How agent → voice → runtime → adapter
5. **Self-Hosted Deployment** - Docker Compose configs (Phase 1 MVP, Phase 2 optional)
6. **Fine-Tuning Workflow** - 5-step process (record → validate → train → deploy → test)
7. **Operator UI** - Voice selector UI sketch, test voice button, provider health
8. **Configuration** - Defaults.ts equivalent, env vars, voice registry
9. **Testing Strategy** - Unit tests, integration tests, A/B testing plan
10. **Integration with Existing System** - Updated socketDeps, config, defaults
11. **Migration Path** - From Google Cloud TTS to self-hosted
12. **Risk Mitigation** - Table of risks and mitigations
13. **Files to Create/Modify** - Complete list for all phases
14. **References** - Links to external resources

**Use case:** Engineers implementing specific sections, product understanding requirements

---

#### 6. **docs/superpowers/plans/2026-06-24-tts-multi-adapter-roadmap.md** (8 KB, 20-minute read)
**Implementation roadmap with timeline:**
- Quick 1-paragraph summary
- Phase-by-phase breakdown (objectives, deliverables, resource needs)
- Architecture changes summary
- Docker deployment overview (Phase 1 vs Phase 2)
- Risk & contingency table
- Success metrics per phase
- Team assignments (suggested)
- Next steps

**Use case:** Project planning, resource allocation, stakeholder communication

---

#### 7. **src/server/runtimes/piperOssv2.ts.scaffold** (6 KB)
**Reference implementation of PiperAdapter:**
- Complete, production-ready code
- Full JSDoc comments
- Voice path mapping
- Error handling patterns
- HTTP request/response handling
- Health check implementation
- Timeout management

**Use case:** Copy & adapt for actual implementation, coding reference

---

## Key Design Highlights

### ✅ Reuses Existing Adapter Pattern
- `TtsAdapter` interface already exists (minimal, sufficient)
- Same pattern as `GoogleCloudTtsAdapter`, `OpenAICompatibleAdapter`
- No breaking changes to existing code

### ✅ Voice Profile Enhancement
- Add `ttsProviderConfig` (provider-specific settings)
- Add `fallbackChain` (automatic failover to alternatives)
- Keep voice → provider mapping explicit and queryable

### ✅ Three-Phase Implementation
1. **Phase 1 (MVP):** Piper only, proven Nepali support, CPU synthesis
2. **Phase 2:** Add FastPitch (GPU) & Coqui (alternative), compare quality/latency
3. **Phase 2.5:** Fine-tuning workflow, custom voice training

### ✅ Self-Hosted Deployment
- Docker Compose services (Piper, FastPitch, Coqui, app)
- Phase 1: Piper only (minimal footprint)
- Phase 2: Optional GPU services
- Resource requirements documented

### ✅ Automatic Fallback
- Primary provider fails → try fallback chain
- Graceful degradation (user hears different voice, not silence)
- Logged for debugging

### ✅ Comprehensive Testing
- Unit tests per adapter
- Integration tests (full voice pipeline)
- A/B testing framework (Phase 2)
- MOS evaluation guide (Phase 1)

---

## Implementation Path

### Week 1: Foundation
- Implement PiperAdapter (`piperOssv2.ts`)
- Extend Voice interface with ttsProviderConfig & fallbackChain
- Update socketDeps.ts adapter selection
- Add to docker-compose.local.yml
- First smoke test by Friday

### Week 2: Quality
- Unit & integration tests
- Performance baseline (latency, CPU)
- MOS evaluation on test corpus
- Quality gates: MOS ≥ 3.5, latency p50 < 250ms

### Week 3: Polish
- Refine latency (if needed)
- Document operator guide
- Final integration test
- Demo ready

### Weeks 4-6: Multi-Adapter
- FastPitch & Coqui adapters
- A/B test all 3 engines
- Voice selector UI
- Provider health status UI

### Weeks 7-8: Fine-Tuning
- Recording UI
- Validation pipeline
- Model training & deployment
- Custom voice in production

---

## What's Included vs. Excluded

### ✅ Included in Design
- Complete TypeScript interfaces & types
- All adapter implementations (Piper, FastPitch, Coqui, Custom)
- Voice profile schema with examples
- Docker Compose configs
- Configuration system
- Fallback synthesis logic
- Unit & integration test strategy
- A/B testing framework
- Fine-tuning workflow
- Operator UI sketches
- Migration path from Google Cloud TTS

### ❌ Not Included (Separate Work)
- Voice cloning / zero-shot synthesis (OmniVoice, Chatterbox mentioned but not designed)
- Cloud-hosted fallback (optional for Phase 2, not required)
- Real-time TTS streaming (Phase 1 focuses on request-response)
- Multi-language support beyond Nepali (can be added later)
- Hardware acceleration beyond GPU (ASIC, TPU etc.)

---

## Files Created (7 Total)

```
Root directory:
├── DESIGN_SUMMARY.md                                     [3 KB]
├── TTS_DESIGN_INDEX.md                                   [8 KB]
├── IMPLEMENTATION_CHECKLIST.md                           [18 KB]
│
docs/ directory:
├── docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md               [18 KB]
│
docs/superpowers/specs/ directory:
├── docs/superpowers/specs/2026-06-24-self-hosted-tts-multi-adapter.md  [90 KB]
│
docs/superpowers/plans/ directory:
├── docs/superpowers/plans/2026-06-24-tts-multi-adapter-roadmap.md      [8 KB]
│
src/server/runtimes/ directory:
├── src/server/runtimes/piperOssv2.ts.scaffold           [6 KB]

Total: 7 documents, 151 KB of documentation
```

---

## How to Use This Design

### For Project Planning
1. Share **DESIGN_SUMMARY.md** with stakeholders
2. Review **docs/superpowers/plans/** for timeline & resources
3. Use **IMPLEMENTATION_CHECKLIST.md** for sprint planning

### For Implementation
1. Read **TTS_DESIGN_INDEX.md** for navigation
2. Study **docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md** for integration points
3. Deep dive relevant sections in **docs/superpowers/specs/**
4. Use **piperOssv2.ts.scaffold** as reference implementation
5. Follow **IMPLEMENTATION_CHECKLIST.md** week-by-week

### For Quality Assurance
1. Review **docs/superpowers/specs/ Section 9** (Testing Strategy)
2. Use **IMPLEMENTATION_CHECKLIST.md** Week 2 & 6 for QA tasks
3. Check success metrics in **TTS_DESIGN_INDEX.md FAQ**

### For DevOps/Infrastructure
1. Review **DESIGN_SUMMARY.md** for resource requirements
2. Study **docs/superpowers/specs/ Section 5** (Docker Compose)
3. Reference **docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md** (Configuration Flow)

---

## Key Decisions Made (for Review)

1. **Reuse TtsAdapter interface** (no breaking changes)
2. **Three-phase approach** (MVP first, testing second, fine-tuning third)
3. **Piper as Phase 1** (proven Nepali, CPU-only, lightweight)
4. **Fallback chains in voice profiles** (explicit, queryable)
5. **Docker Compose for deployment** (self-hosted, no cloud for MVP)
6. **Extended Voice interface** (ttsProviderConfig, fallbackChain)

---

## Success Criteria (Phase 1)

- ✅ Piper service deployed & responds to /health
- ✅ Voice turns complete with TTS audio (no crashes)
- ✅ Latency p50 < 250ms, p99 < 500ms
- ✅ MOS score ≥ 3.5 / 5.0
- ✅ CPU usage < 2 cores per call
- ✅ All tests passing (> 90% coverage)
- ✅ Operator guide published
- ✅ Fallback logic functional (tested)

---

## Next Steps (After Review)

1. **Approve design** (stakeholder sign-off)
2. **Allocate resources** (2 FTE engineers, 0.5 FTE DevOps)
3. **Procure compute** (GPU machine for Phase 2 - optional)
4. **Download models** (Piper Nepali voices from HuggingFace)
5. **Prepare test data** (200 Nepali sentences)
6. **Kick off Week 1** (PiperAdapter implementation sprint)

---

## Questions & Support

**For architecture questions:** Review **docs/ARCHITECTURE-MULTI-ADAPTER-TTS.md**

**For implementation details:** See **docs/superpowers/specs/** (search by section number)

**For timeline/tasks:** Check **IMPLEMENTATION_CHECKLIST.md** (week-by-week)

**For overview:** Start with **DESIGN_SUMMARY.md**

**For navigation:** Use **TTS_DESIGN_INDEX.md** (document map by audience)

---

## Sign-Off

**Design Status:** ✅ Complete & Ready for Implementation

**Reviewed by:**
- [ ] Engineering Lead: _________________ Date: _______
- [ ] Product Owner: _________________ Date: _______
- [ ] DevOps Lead: _________________ Date: _______

**Approved for Implementation:** [ ] Yes

---

## Document Statistics

| Document | Purpose | Length | Read Time |
|----------|---------|--------|-----------|
| DESIGN_SUMMARY.md | Quick overview | 3 KB | 5 min |
| TTS_DESIGN_INDEX.md | Navigation guide | 8 KB | 10 min |
| IMPLEMENTATION_CHECKLIST.md | Week-by-week tasks | 18 KB | 30 min |
| ARCHITECTURE-MULTI-ADAPTER-TTS.md | Technical deep dive | 18 KB | 45 min |
| Self-hosted TTS multi-adapter spec | Complete specification | 90 KB | 90 min |
| TTS multi-adapter roadmap | Project timeline | 8 KB | 20 min |
| piperOssv2.ts.scaffold | Reference code | 6 KB | 15 min |
| **TOTAL** | **Complete design package** | **151 KB** | **3 hours** |

---

**Created:** 2026-06-24  
**Version:** 1.0 (Design Complete)  
**Next Step:** Implementation Phase 1 (Week 1 kickoff)

