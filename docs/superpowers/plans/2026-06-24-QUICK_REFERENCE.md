# LipiVoice Enterprise Insurance Platform — Quick Reference

## Documents

1. **Architecture Specification** (`2026-06-24-lipivoice-enterprise-insurance-platform-architecture.md`)
   - Full system design (boxes & arrows, data flows, API surface)
   - Tech stack decisions with rationale
   - Database schema (PostgreSQL scale-out target)
   - Open questions & answers
   - Covers Phases 1-4

2. **Implementation Plan** (`2026-06-24-enterprise-insurance-mvp-implementation.md`)
   - Executable tasks for Phase 1 (6 weeks, 2 parallel workstreams)
   - Week-by-week breakdown with definition of done
   - Resource allocation + success criteria

---

## Quick Decision Matrix

| Decision | Selection | Rationale | Trade-off |
| -------- | --------- | --------- | --------- |
| **Nepali STT** | Faster-Whisper (self-hosted, OpenAI-compatible HTTP) | 100% open-source, Nepali-capable, low latency, no cloud cost | Needs GPU for real-time scale; accuracy slightly below cloud-only |
| **Nepali TTS** | Piper HTTP (primary) + Coqui XTTS + FastPitch (A/B) | 100% self-hosted, multi-adapter, Nepali ONNX voices | Piper ~200ms CPU latency; Coqui/FastPitch need more RAM/GPU |
| **LLM** | Gemma 4B via vLLM (remote) + Ollama (local fallback) | Efficient (4B params), Nepali-capable, fully open-source | Needs GPU for vLLM; Ollama CPU fallback ~3-5x slower |
| **Call Signaling** | LiveKit (open-source SFU) + Python worker | No vendor lock-in, agent orchestration built-in, SIP bridge ready | More ops complexity vs. managed service (Vapi/Daily) |
| **Database** | SQLite (current) → PostgreSQL (scale-out path) | Zero-ops for single-node; JSON blob pattern + indexed columns | No concurrent writes > 1 writer; migrate when needed |
| **Call Storage** | Local filesystem (Phase 1) → S3-compatible (Phase 2) | Phase 1 simplicity; Phase 2 scalability + durability | No HA initially; manual backup in Phase 1 |
| **Auth** | API key (current) → JWT + OAuth2 (Phase 2) | Simple to start; enterprise-ready path | No multi-tenant until Phase 2 |

---

## Current Build Status (2026-06-24)

**Phase 1 MVP complete. Outbound campaigns also shipped ahead of schedule.**

### What's Built

```text
✅ Inbound WebRTC calls (browser-based, LiveKit)
✅ Agent session (Faster-Whisper STT + Gemma 4B LLM + Piper/Coqui/FastPitch TTS)
✅ Self-hosted only — no Google TTS/STT/LLM anywhere
✅ CMS sync (HTTP adapter, bearer/api_key/basic/none auth)
✅ Customer + policy import and deduplication
✅ Ticket auto-generation from completed calls
✅ Call history + search UI (Calls page)
✅ Operations CRM (customers, policies, tickets, appointments, transfers)
✅ Outbound campaigns (renewal, claim_followup, survey — with personalized prompts)
✅ Campaign quick-build from policies due for renewal
✅ Docker Compose remote deployment
✅ Nepali-first agent (SALICO receptionist, Devanagari by default)
✅ Multi-adapter TTS (Piper HTTP, Coqui XTTS, FastPitch — per-voice runtime selection)
```

### What's Still Pending

```text
🔲 Multi-agent workforce + availability tracking
🔲 Claim follow-ups automated enrichment
🔲 Workflow graph editor
🔲 Knowledge base / RAG
🔲 Multi-tenant auth (currently single workspace + API key)
🔲 Warm transfer to human agents
🔲 SIP phone inbound
🔲 Call analytics dashboard
🔲 PostgreSQL / Redis migration (SQLite sufficient for < 5 concurrent writers)
```

---

## Key Flows (End-to-End)

### Inbound Call

```text
1. Caller opens browser → WebRTC peer negotiation (LiveKit)
2. API creates call record (status: connecting)
3. LiveKit room allocated, agent worker dispatched
4. Worker loads agent config (greeting, system prompt, tools)
5. Agent greets in Nepali → Piper HTTP TTS synthesizes audio
6. Caller speaks → Faster-Whisper STT transcribes to Devanagari text
7. LLM generates response (Gemma 4B via vLLM or Ollama fallback)
8. TTS synthesizes audio → worker publishes to WebRTC peer track
9. Tool calls execute (callback collection, claim intake, etc.)
10. All events (transcript, status, tools) → persisted to SQLite
11. Call ends → ticket auto-generated, duration recorded
12. Supervisor reviews in Calls page → Operations page shows linked records
```

### CMS Customer Sync

```text
1. POST /api/cms/sync with baseUrl + authMode
2. CmsAdapter fetches customers and policies from external API
3. Normalises snake_case / camelCase field names
4. Upserts into SQLite customers + policies tables
5. Deduplicates by phone number / cmsId
6. When call starts, customer lookup populates agent context
```

### Outbound Campaign

```text
1. POST /api/campaigns/build-renewal with date range
2. CampaignService queries policies due for renewal
3. Builds campaign with one contact per customer
4. POST /api/campaigns/:id/launch dispatches calls
5. Each contact: CampaignService.buildContextSuffix() injects
   customer name, phone, policy number, renewal date into system prompt
6. Outbound call initiated → full STT → LLM → TTS pipeline
7. Campaign run record updated (pending → dialing → completed/failed)
```

### Ticket Auto-Generation

```text
1. Call ends → all transcripts + tool events available in SQLite
2. Worker tool create-escalation / schedule-callback creates typed records
3. Ticket inserted with type, priority, linked customerId and callId
4. Operations page shows ticket; supervisor can edit and reassign
```

---

## Tech Stack Summary (Current)

```text
Frontend
├── React 19 + Vite
├── Radix UI + Tailwind
└── LiveKit JS client

Backend
├── Node.js + Express + TypeScript
├── SQLite (better-sqlite3) — single-node, JSON blob pattern
└── LiveKit SDK

Self-Hosted Inference (no cloud dependencies)
├── Piper HTTP      — TTS, fast CPU, ONNX Nepali voices    :5002
├── Coqui XTTS HTTP — TTS, expressive, voice cloning       :5003
├── FastPitch HTTP  — TTS, GPU-accelerated, multi-speaker  :5004
├── Faster-Whisper  — STT, OpenAI-compatible HTTP API      :9000
├── Gemma 4B/Ollama — LLM local fallback                   :11434
└── Gemma 4B/vLLM   — LLM remote GPU inference             :8002

Infrastructure
├── LiveKit server (SFU + agent dispatch)
├── Python LiveKit Agents worker (lipivoice-receptionist)
├── Docker Compose (remote deployment)
└── S3-compatible storage (Phase 2 — local filesystem now)

Scale-Out Path (when SQLite becomes a bottleneck)
├── PostgreSQL 15 (multi-writer, JSONB)
└── Redis (cache + job queue)
```

---

## Open Questions Resolved

### Q: How does customer data flow?

**A:** On-demand HTTP sync via `POST /api/cms/sync`. Provide a `baseUrl` and auth mode (bearer/api_key/basic/none). The `CmsAdapter` normalises snake_case and camelCase field names and deduplicates by phone number. SQLite is the source of truth. Scheduled polling is a Phase 2 addition when Redis is added.

### Q: Tickets created where?

**A:** SQLite `tickets` table. Worker tools (`create-escalation`, `schedule-callback`, etc.) create records during live calls and attach them to the call event log. Phase 2: bidirectional sync to external CRM via webhook.

### Q: How are outbound campaigns personalised?

**A:** `CampaignService.buildContextSuffix()` fetches the customer and their linked policies from SQLite and appends a context block to the agent system prompt before each outbound call. The contact's name, phone, policy number, and renewal date are injected — the LLM sees them in its context window.

### Q: Recording storage?

**A:** Tiered.

- Phase 1: Local filesystem (`/var/lib/lipivoice/recordings/{callId}.wav`)
- Phase 2: S3-compatible (MinIO or AWS S3) with versioning
- Retention: 30 days hot, 1 year cold archive, PII redaction before archival

### Q: Agent auth & multi-tenancy?

**A:** Progressive.

- Phase 1: Single workspace, API key auth for system integrations
- Phase 2: OAuth2 + JWT, per-user workspace scoping, RBAC (admin, supervisor, agent, auditor)
- Phase 3: Full multi-tenant isolation, billing per workspace

---

## Deployment Quick Start

### Current (Docker Compose)

```bash
# Set env vars for self-hosted services
export PIPER_HTTP_ENDPOINT=http://piper:5002
export COQUI_HTTP_ENDPOINT=http://coqui:5003
export FASTPITCH_HTTP_ENDPOINT=http://fastpitch:5004
export FASTER_WHISPER_ENDPOINT=http://whisper:9000
export VLLM_BASE_URL=http://vllm:8002/v1
export VLLM_MODEL=gemma-4b-salico-v1
export LIPIVOICE_RUNTIME_PRESET=remote

# Start app stack
docker compose -f docker-compose.remote.yml up -d --build

# Check health
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/tts/providers
```

### Scale-Out (Docker + Load Balancer)

```text
Self-hosted bare-metal or cloud VM:
├── App servers (2-4 instances, load-balanced)
├── vLLM worker (GPU instance — A100/L40S recommended)
├── LiveKit servers (1-2 instances)
├── Piper / Coqui / FastPitch containers
├── Faster-Whisper container
├── PostgreSQL (when SQLite limit reached)
├── Redis (cache + job queue, when added)
└── MinIO or S3 for recording storage
```

---

## Key Files (Implemented)

### Backend

- `src/server/store/database.ts` — SQLite tables (campaigns, policies, campaign_runs added)
- `src/server/store/repositories.ts` — typed repositories for all entities
- `src/server/campaigns/campaignService.ts` — outbound scheduling + context injection
- `src/server/cms/cmsAdapter.ts` — HTTP CMS sync adapter
- `src/server/runtimes/openAiCompatible.ts` — Piper HTTP, Coqui, FastPitch, Faster-Whisper adapters
- `src/server/app.ts` — all API routes including `/api/policies`, `/api/campaigns`, `/api/cms/sync`

### Frontend

- `src/features/campaigns/CampaignsPage.tsx` — outbound campaign management UI
- `src/features/operations/OperationsPage.tsx` — CRM with policies + CMS sync panel
- `src/features/voice-lab/VoiceLabPage.tsx` — TTS benchmark across all 3 adapters
- `src/features/calls/CallsPage.tsx` — inbound call console with runtime diagnostics

---

## Success Metrics

| Metric | Target | Status |
| ------ | ------ | ------ |
| **E2E Call Flow** | 1 complete call per agent | ✅ Browser call → transcript → ticket |
| **Self-hosted TTS** | All 3 adapters responding | ✅ Piper/Coqui/FastPitch wired |
| **CMS sync** | Import customers + policies | ✅ `/api/cms/sync` live |
| **Outbound campaigns** | Personalised prompts per contact | ✅ `buildContextSuffix()` injects policy context |
| **Test coverage** | 237/240 passing | ✅ 3 pre-existing UI timing issues |

---

## Architecture Document Locations

- **Full Spec:** `docs/superpowers/specs/2026-06-24-lipivoice-enterprise-insurance-platform-architecture.md`
- **MVP Plan:** `docs/superpowers/plans/2026-06-24-enterprise-insurance-mvp-implementation.md`
- **TTS Roadmap:** `docs/superpowers/plans/2026-06-24-tts-multi-adapter-roadmap.md`
- **This Summary:** `docs/superpowers/plans/2026-06-24-QUICK_REFERENCE.md`

---

## One-Line Summary

**LipiVoice:** Browser-based Nepali insurance call center (WebRTC + Gemma 4B + Piper/Coqui/FastPitch TTS), fully self-hosted, CMS integration, outbound campaigns, auto-ticket generation, SALICO-branded agent.
