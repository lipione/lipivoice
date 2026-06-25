# LipiVoice Enterprise Insurance Call Center Platform Architecture

**Date:** 2026-06-24  
**Status:** Phase 1 MVP COMPLETE — SQLite single-node stack running; PostgreSQL/Redis scale-out is next  
**Author:** Architecture Review  

---

## Executive Summary

This document defines a scalable, multi-tenant architecture for an enterprise insurance call center platform built on LipiVoice. The design targets:

- **50+ concurrent calls** (inbound + outbound)
- **100k+ customer base** with CMS integration (Salesforce, custom API)
- **Open-source Nepali STT/TTS** (Whisper-based, Piper-based)
- **Gemma 4B LLM** (local or remote)
- **Ticket & campaign automation** (policy renewals, claim follow-ups)
- **Multi-agent workforce** with availability tracking

**MVP Scope (Phase 1):**  
Single agent, inbound WebRTC calls, basic ticket generation, CMS customer lookup, persistent call history.

---

## 1. System Architecture

### 1.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Browser / Mobile Client                        │
│  (React SPA, WebRTC Media, JWT Auth, Real-time Transcript)         │
└──────────┬──────────────────────────────────────────────────────────┘
           │ HTTPS + WebSocket
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      API Gateway / Load Balancer                     │
│  (Auth, Rate Limiting, Request Routing, TLS)                        │
└──────────┬──────────────────────────────────────────────────────────┘
           │
     ┌─────┴──────────────────────────┬──────────────────────────┐
     ▼                                ▼                          ▼
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│ Control Plane    │  │ Realtime Voice       │  │ Background Jobs  │
│ (TypeScript API) │  │ (LiveKit + Python    │  │ (Job Queue +     │
│                  │  │  Workers)            │  │  Schedulers)     │
│ - Call CRUD      │  │                      │  │                  │
│ - Agent Config   │  │ - RTC Media          │  │ - Campaigns      │
│ - CMS Sync       │  │ - STT/TTS/VAD        │  │ - Batch Tasks    │
│ - Tickets        │  │ - LLM Integration    │  │ - Data Sync      │
│ - Auth/Users     │  │ - Interruption       │  │ - Reporting      │
└──────────┬───────┘  │ - Tool Execution     │  └────────┬─────────┘
           │          │ - Event Streaming    │           │
           │          └──────────┬───────────┘           │
           │                     │                       │
     ┌─────┴─────────────────────┴───────────────────────┴─────┐
     │                                                          │
     ▼                                                          ▼
┌──────────────────────────────────────┐  ┌──────────────────────┐
│          PostgreSQL Database          │  │  Redis (Cache +      │
│  (Calls, CallEvents, Agents,         │  │  Message Queue)      │
│   Customers, Policies, Tickets,      │  │  - Session state     │
│   Campaigns, AgentSessions)          │  │  - Rate limits       │
│                                      │  │  - Job queue         │
└──────────────┬───────────────────────┘  │  - Real-time pub/sub │
               │                           │  - CMS cache         │
               │                           └─────────┬────────────┘
               │                                    │
     ┌─────────┴────────────┬──────────────────────┴──────┐
     ▼                      ▼                             ▼
┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐
│ S3/S3-compat │  │ CMS APIs        │  │ External Services    │
│ (Recordings, │  │ (Salesforce,    │  │ (Twilio SIP, Email   │
│  Transcripts)│  │  custom API)    │  │  Delivery, Analytics)│
└──────────────┘  └─────────────────┘  └──────────────────────┘
```

### 1.2 Core Data Flow

#### Inbound Call (WebRTC)

1. **Caller initiates call** → Browser opens WebRTC peer connection
2. **API validates caller** → JWT auth, rate limits, customer lookup from CMS cache
3. **Call record created** → Status: `connecting` in PostgreSQL
4. **LiveKit room allocated** → Caller joins room, agent worker dispatched
5. **Agent session starts** → Worker loads agent config from API, initializes STT/TTS/LLM
6. **Conversation loop**:
   - VAD detects speech → STT transcribes to text
   - LLM generates response (with customer context, tools available)
   - TTS synthesizes audio → Worker publishes to WebRTC track
   - Tool calls execute (callback collection, claim intake, etc.)
   - All events (transcripts, tools, status) → persisted to PostgreSQL
7. **Call ends** → Status: `completed`, recording location stored, ticket auto-generated

#### Outbound Campaign (Scheduled)

1. **Campaign scheduled** (e.g., policy renewal for cohort of 1000 customers)
2. **Job queue picks up campaign** → Bull/RQ worker processes in batches
3. **For each customer**:
   - Fetch customer profile + policy from CMS cache
   - Allocate agent (find available agent from pool)
   - Create outbound call record
   - Initiate SIP call or simulated WebRTC room
   - Run conversation (pre-built prompt tailored to renewal/claim follow-up)
   - Collect response + update CMS as needed
4. **Persist results** → Call record, transcript, ticket

#### CMS Data Sync

1. **Periodic sync (hourly or webhook-driven)**
2. **Fetch customers from Salesforce/API** → De-duplicate, update PostgreSQL `customers` table
3. **Cache hot data in Redis** → Customer name, phone, policy ID, status
4. **Invalidate cache on CMS change** (webhook if available, else polling)

---

## 2. Tech Stack Decisions & Rationale

### 2.1 Open-Source Nepali STT

**Selected: Faster-Whisper (local) + Google STT (cloud fallback)**

| Aspect | Rationale |
|--------|-----------|
| **Faster-Whisper** | Open-source, Nepali-capable base model (`tiny.en`, `base.en` → fine-tuned for Nepali), runs locally on GPU/CPU, no cloud API calls → lower latency, privacy. |
| **Google STT** | Cloud fallback; better accuracy for noisy environments. Set `GOOGLE_STT_LANGUAGE_CODES=ne-NP,en-US`. |
| **Why not Sarvam?** | Sarvam is strong but cloud-only; consider for Phase 3 multi-language expansion. |
| **Why not Silero?** | Silero VAD is best; Silero ASR is less Nepali-optimized than Whisper. Use Silero for VAD only. |

**Implementation:**
- Local path: `services/speech-processing/whisper-runner` (async inference server, queue-based batch processing)
- Config: `WHISPER_MODEL_PATH=/path/to/ggml-base.en.bin`, `WHISPER_CPP_BIN=/path/to/whisper-cli`
- Fallback header: if STT latency > 2s or local unavailable, switch to `google_stt` runtime

---

### 2.2 Open-Source Nepali TTS

**Selected: Piper (local) + Google TTS (cloud primary)**

| Aspect | Rationale |
|--------|-----------|
| **Google Gemini TTS** (cloud) | Best Nepali voice quality today (`Kore` voice, `ne-NP`). Used as primary for Phase 1. |
| **Piper (local)** | Open-source, lightweight (~2GB disk), runs on CPU. Suitable for cost-sensitive deployments or offline scenarios. Nepali voice: `ne_NP/noa-medium.onnx` or similar. |
| **When to switch** | If Google cost becomes prohibitive (Phase 2), rotate to Piper with latency trade-off (~500ms vs. 100ms). |
| **Future: Open-source alternatives** | FastPitch + HiFi-GAN (Research phase); Indic Parler TTS; Kokoro (if Nepali models available). |

**Implementation:**
- Primary: `RuntimeAdapter: "google_tts"` with `GOOGLE_TTS_MODEL=gemini-2.5-flash-tts`
- Fallback: `RuntimeAdapter: "piper"` with `PIPER_BIN`, `PIPER_VOICE_PATH`
- Selection: Agent config allows per-call voice override (e.g., for testing, regional accents)

---

### 2.3 Gemma 4B LLM Integration

**Selected: vLLM server (remote) + Ollama (local fallback)**

| Aspect | Rationale |
|--------|-----------|
| **vLLM** | Fast inference server (batching, paged attention, quantization). Best for 50+ concurrent calls. Deploy on GPU-enabled VM (A100 / L40S). Expose OpenAI-compatible API endpoint. |
| **Why Gemma 4B?** | Efficient (4B params), Nepali-capable, proven in LipiVoice phase experiments. Fits in 8-16GB VRAM with quantization (int8/int4). |
| **Ollama** | Local fallback for development / single-agent testing. Slower but zero infra cost. |
| **Fine-tuning path** | Phase 2: Instruction-tune Gemma 4B on insurance domain prompts (ticket classification, intent detection). LoRA for efficiency. |
| **Model hosting** | Don't self-host fine-tuned weights; use HuggingFace Hub or internal model registry with version pinning. |

**Implementation:**
- vLLM Docker: `docker run --gpus all -p 8000:8000 vllm/vllm-openai --model TBD`
- Config: `VLLM_BASE_URL=http://vllm-svc:8000/v1`, `VLLM_MODEL=gemma-4-finetuned-indic-4b`
- Fallback: `OLLAMA_BASE_URL=http://ollama:11434`, `LIPIVOICE_LLM_MODEL=gemma:4b`
- Error budget: if vLLM latency > 3s, fall back to Ollama; if both fail, return templated response

---

### 2.4 Call Signaling & WebRTC

**Selected: LiveKit (Agents + SIP bridge) + custom WebRTC negotiation**

| Aspect | Rationale |
|--------|-----------|
| **LiveKit** | Open-source SFU + agent orchestration. Handles RTC media, room management, agent dispatch, SIP inbound/outbound. No Vapi/Dograh vendor lock-in. |
| **Why not Twilio?** | Cost (per-minute SIP, per-AI-minute), closed-source. LiveKit more cost-efficient for self-hosted 50+ calls. |
| **Browser WebRTC** | LiveKit JS client handles peer negotiation + ICE. Workers (Python) use LiveKit Python SDK. |
| **Phone inbound (Phase 2)** | SIP gateway on LiveKit; inbound calls route to agent worker via metadata dispatch. |
| **Phone outbound (Phase 2)** | LiveKit agent worker initiates SIP call; conversation recorded as normal call. |

**Implementation:**
- LiveKit server: `livekit-server` (Docker / Kubernetes). Default ports: TCP 7880 (WS), TCP 8080 (API), UDP 443 (DTLS).
- Rooms: `lipivoice-call-{callId}`, max 4 participants (caller + agent + observer + fallback).
- Worker dispatch: Metadata includes `{ callId, agentId }` for session bootstrap.
- Recording: LiveKit records all tracks to local disk or S3; post-process for transcript + archive.

---

### 2.5 Job Queue & Scheduling

**Selected: Bull (Redis-backed) for Node.js, Celery for Python workers (Phase 2)**

| Aspect | Rationale |
|--------|-----------|
| **Bull** | Lightweight, Redis-backed, reliable. Built into Node.js stack. Handles campaigns, batch customer syncs, ticket generation. |
| **Celery** (future) | If Python workers scale beyond LiveKit agent pool, Celery for long-running ML tasks (transcription post-processing, NER, intent classification). |
| **Retry strategy** | Bull: exponential backoff (base 2), max 5 retries. Logs failures to PostgreSQL for audit. |
| **Rate limiting** | Campaigns throttle to X calls/min (e.g., 10 outbound calls/min to avoid carrier blocks). |

**Implementation:**
- `services/job-worker` (Node.js): `npm run dev:jobs`
- Queue names: `campaigns`, `sync-customers`, `generate-tickets`, `cleanup-old-recordings`
- Example job: `campaigns:process-renewal-cohort` → iterate customers, dispatch calls, await results

---

## 3. Data Model

### 3.1 PostgreSQL Schema (Key Tables)

```sql
-- Customers (synced from CMS)
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  external_id VARCHAR UNIQUE,  -- Salesforce ID
  name VARCHAR NOT NULL,
  phone VARCHAR,
  email VARCHAR,
  language VARCHAR DEFAULT 'ne',
  cms_data JSONB,  -- Salesforce object
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Policies (synced from CMS)
CREATE TABLE policies (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers,
  external_id VARCHAR UNIQUE,
  policy_number VARCHAR,
  status VARCHAR,  -- active, lapsed, renewed, cancelled
  type VARCHAR,  -- health, life, motor, etc.
  premium_amount DECIMAL,
  renewal_date DATE,
  cms_data JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Calls (inbound + outbound)
CREATE TABLE calls (
  id UUID PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  customer_id UUID REFERENCES customers,
  channel VARCHAR,  -- 'web', 'sip', 'simulation'
  direction VARCHAR,  -- 'inbound', 'outbound'
  type VARCHAR,  -- 'reception', 'renewal_campaign', 'claim_followup'
  status VARCHAR,  -- 'connecting', 'connected', 'listening', 'completed', 'failed'
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  duration_seconds INT,
  recording_url VARCHAR,
  livekit_room_name VARCHAR,
  campaign_id UUID REFERENCES campaigns,
  outcome VARCHAR,  -- 'completed', 'abandoned', 'escalated'
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  INDEX (customer_id),
  INDEX (agent_id),
  INDEX (campaign_id),
  INDEX (created_at DESC)
);

-- Call Events (streaming transcripts + tool calls)
CREATE TABLE call_events (
  id UUID PRIMARY KEY,
  call_id UUID REFERENCES calls,
  timestamp TIMESTAMP,
  type VARCHAR,  -- 'transcript', 'tool_call', 'status', 'error', 'audio_metadata'
  actor VARCHAR,  -- 'user', 'assistant', 'tool', 'system'
  payload JSONB,
  severity VARCHAR,  -- 'info', 'warning', 'error'
  created_at TIMESTAMP,
  INDEX (call_id),
  INDEX (type),
  INDEX (timestamp DESC)
);

-- Agents (operators + AI)
CREATE TABLE agents (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  type VARCHAR,  -- 'ai', 'human', 'hybrid'
  language VARCHAR DEFAULT 'ne',
  greeting VARCHAR,
  system_prompt TEXT,
  voice_id VARCHAR,
  model_runtime_id VARCHAR,
  stt_runtime_id VARCHAR,
  tts_runtime_id VARCHAR,
  tools JSONB,  -- array of tool IDs
  max_concurrent_calls INT DEFAULT 1,
  status VARCHAR,  -- 'active', 'paused', 'offline'
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Tickets (auto-generated from calls)
CREATE TABLE tickets (
  id UUID PRIMARY KEY,
  call_id UUID REFERENCES calls,
  customer_id UUID REFERENCES customers,
  agent_id VARCHAR REFERENCES agents,
  title VARCHAR,
  description TEXT,
  category VARCHAR,  -- 'callback_request', 'claim_intake', 'complaint', 'follow_up'
  priority VARCHAR,  -- 'low', 'medium', 'high', 'urgent'
  status VARCHAR,  -- 'open', 'assigned', 'in_progress', 'resolved', 'closed'
  assigned_to VARCHAR,  -- internal staff member ID
  cms_ticket_id VARCHAR,  -- Salesforce case ID if synced
  created_at TIMESTAMP,
  resolved_at TIMESTAMP,
  updated_at TIMESTAMP,
  INDEX (customer_id),
  INDEX (status),
  INDEX (created_at DESC)
);

-- Campaigns (policy renewals, claim follow-ups)
CREATE TABLE campaigns (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  type VARCHAR,  -- 'renewal', 'claim_followup', 'upsell'
  target_policy_type VARCHAR,  -- filter: health, life, motor
  target_count INT,
  status VARCHAR,  -- 'draft', 'scheduled', 'running', 'completed', 'paused'
  scheduled_start_at TIMESTAMP,
  scheduled_end_at TIMESTAMP,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  agent_ids JSONB,  -- array of agent IDs to assign
  prompt_template TEXT,  -- customizable for campaign
  max_calls_per_agent INT DEFAULT 20,
  max_calls_per_minute INT DEFAULT 10,
  created_by VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  INDEX (status),
  INDEX (scheduled_start_at)
);

-- Campaign Calls (link between campaigns and calls)
CREATE TABLE campaign_calls (
  id UUID PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns,
  call_id UUID REFERENCES calls,
  customer_id UUID REFERENCES customers,
  scheduled_at TIMESTAMP,
  attempted_at TIMESTAMP,
  completed_at TIMESTAMP,
  outcome VARCHAR,  -- 'completed', 'no_answer', 'failed', 'blacklisted'
  created_at TIMESTAMP
);

-- Agent Sessions (availability tracking)
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY,
  agent_id VARCHAR REFERENCES agents,
  session_started_at TIMESTAMP,
  session_ended_at TIMESTAMP,
  status VARCHAR,  -- 'active', 'on_break', 'offline'
  calls_handled INT DEFAULT 0,
  avg_call_duration_seconds FLOAT,
  created_at TIMESTAMP
);

-- Audit Log (for compliance)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  entity_type VARCHAR,  -- 'call', 'ticket', 'campaign', 'customer'
  entity_id VARCHAR,
  action VARCHAR,  -- 'created', 'updated', 'deleted', 'exported'
  actor_id VARCHAR,
  actor_type VARCHAR,  -- 'user', 'system', 'api'
  changes JSONB,
  created_at TIMESTAMP,
  INDEX (entity_type, entity_id),
  INDEX (created_at DESC)
);
```

### 3.2 Redis Schema (Caching & State)

```
-- Customer cache (hot data)
customer:{customerId} → JSON (name, phone, policy_ids, language)
TTL: 1 hour

-- Agent availability
agent-available:{agentId} → { calls_active: N, status: "active"|"break" }
TTL: Real-time (subscribe to updates)

-- Campaign job queue
bull:campaigns:* → Job entries (per Bull conventions)

-- Call session state
call-session:{callId} → { roomName, participantId, tokens, startedAt }
TTL: Until call ends + 1 hour

-- Rate limits
ratelimit:outbound-calls:{agentId}:{date} → count
TTL: 24 hours
```

---

## 4. API Surface

### 4.1 Authentication & Authorization

```
Header: Authorization: Bearer <JWT>
JWT claims: { userId, email, workspace_id, roles: ['admin', 'agent', 'supervisor'] }

Scopes:
- calls:read, calls:create, calls:update
- customers:read, customers:sync
- agents:read, agents:manage
- campaigns:create, campaigns:manage, campaigns:execute
- tickets:read, tickets:create, tickets:close
- analytics:read
- system:admin
```

### 4.2 Call Management APIs

```
POST /api/calls/inbound/start
{
  "agentId": "agent_reception",
  "customerId": "cust_12345",  -- optional; will lookup by phone if not provided
  "channel": "web" | "sip"
}
Response: { call, livekit: { wsUrl, token, roomName } }

POST /api/calls/{id}/end
{ "status": "completed" | "failed", "notes": "..." }

GET /api/calls
Query: { agentId, customerId, status, startDate, endDate, limit: 100 }
Response: { calls: [...], total, hasMore }

GET /api/calls/{id}/events
Query: { type: "transcript" | "tool_call" | "error", limit: 50 }
Response: { events: [...] }

POST /api/calls/{id}/note
{ "text": "..." }
```

### 4.3 Customer & CMS Sync APIs

```
GET /api/customers
Query: { search: "name|phone", limit: 50, offset: 0 }
Response: { customers: [...], total }

GET /api/customers/{id}
Response: { customer, policies: [...], tickets: [...], calls: [...] }

POST /api/sync/customers
{ "source": "salesforce", "filter": { "type": "health" } }
Response: { job_id, status: "queued" }

GET /api/sync/jobs/{jobId}
Response: { status: "running" | "completed" | "failed", synced: N, errors: [...] }
```

### 4.4 Campaign APIs

```
POST /api/campaigns
{
  "name": "Q3 Health Renewal",
  "type": "renewal",
  "targetPolicyType": "health",
  "scheduledStartAt": "2026-07-01T00:00:00Z",
  "maxCallsPerAgent": 20,
  "maxCallsPerMinute": 10,
  "agentIds": ["agent_1", "agent_2"],
  "promptTemplate": "Custom prompt for this campaign..."
}
Response: { campaign }

GET /api/campaigns
Query: { status: "running" | "scheduled", limit: 50 }

PATCH /api/campaigns/{id}
{ "status": "paused" | "resume" | "cancelled" }

GET /api/campaigns/{id}/calls
Query: { outcome: "completed" | "no_answer", limit: 100 }
Response: { calls: [...], stats: { total, completed, failed, noAnswer } }

POST /api/campaigns/{id}/execute
Response: { job_id, queued_call_count: N }
```

### 4.5 Ticket APIs

```
GET /api/tickets
Query: { status, customerId, assignedTo, limit: 50 }

POST /api/tickets
{
  "callId": "call_xyz",
  "title": "Policy Renewal Request",
  "category": "callback_request",
  "priority": "high",
  "description": "Extracted from call transcript"
}
Response: { ticket, cms_ticket_id: "Salesforce case ID if synced" }

PATCH /api/tickets/{id}
{ "status": "assigned", "assignedTo": "staff_id", "notes": "..." }

POST /api/tickets/{id}/sync-to-cms
Response: { cmsTicketId, status: "synced" }
```

### 4.6 Agent APIs

```
GET /api/agents
Response: { agents: [...] }

GET /api/agents/{id}/availability
Response: {
  agentId, status: "active" | "break" | "offline",
  callsActive: N, callsCompleted: N,
  avgCallDuration: seconds
}

POST /api/agents/{id}/availability
{ "status": "active" | "break" | "offline" }
```

### 4.7 Analytics APIs

```
GET /api/analytics/calls
Query: { period: "today" | "week" | "month", agentId, status }
Response: {
  totalCalls, inbound, outbound, completed, abandoned,
  avgDuration, avgWaitTime, avgCustomerSatisfaction
}

GET /api/analytics/campaigns/{id}
Response: {
  name, totalScheduled, completed, noAnswer, failed, escalated,
  conversionRate, avgOutcome, topReasons
}
```

---

## 5. MVP Feature Priorities

### Phase 1: Inbound Only (v0.1) — 4 weeks

**Goal:** Single agent, WebRTC inbound calls, basic ticket auto-gen, CMS customer lookup.

- [ ] PostgreSQL setup with `calls`, `call_events`, `customers`, `tickets` tables
- [ ] LiveKit room creation + browser WebRTC join
- [ ] Agent session (STT→Whisper, LLM→Gemma 4B, TTS→Google)
- [ ] Simulated call API still available (for testing without WebRTC)
- [ ] Customer lookup from Redis cache (batch sync hourly)
- [ ] Ticket auto-generation from call transcript
- [ ] Call history page + search
- [ ] Error handling + retry for model timeouts
- [ ] Docker Compose: app, livekit, worker, postgres, redis

**Not in MVP:** Campaigns, outbound calls, multi-agent, fine-tuning, SIP, workflows.

### Phase 2: Multi-Agent + Campaigns (v0.2) — 6 weeks

- [ ] Agent availability tracking + assignment logic
- [ ] Bull job queue for campaign execution
- [ ] Outbound call support (SIP from LiveKit)
- [ ] Campaign CRUD + scheduling API
- [ ] Campaign execution: iterate customers, throttle calls, track outcomes
- [ ] Ticket assignment + CMS sync (push to Salesforce)
- [ ] Agent dashboard + analytics
- [ ] Multi-language support (English fallback)

### Phase 3: Data Enrichment + Claim Follow-ups (v0.3) — 4 weeks

- [ ] CMS data enrichment: pull policy details, claims history
- [ ] Custom agent prompt per customer (personalization)
- [ ] Claim follow-up campaign type
- [ ] Transcript post-processing (NER for names/policies, intent detection)
- [ ] Knowledge base (PDF/FAQ ingestion → RAG)
- [ ] Warm transfer workflow (escalate to licensed agent)

### Phase 4: Production Hardening (v0.4) — 4 weeks

- [ ] Multi-tenant auth + workspace isolation
- [ ] RBAC (admin, supervisor, agent, auditor)
- [ ] Call recording retention policies + PII redaction
- [ ] Audit log for all entity changes
- [ ] Rate limits + DDoS protection
- [ ] Worker health + auto-scaling (Kubernetes)
- [ ] Monitoring + alerting (Prometheus, DataDog)
- [ ] Database migration strategy + backup

---

## 6. Integration Points

### 6.1 CMS API (Salesforce / Custom)

**Data flow:**
1. Hourly job: `GET /api/salesforce/customers` → filter by policy renewal date
2. Upsert into PostgreSQL `customers`, `policies`
3. Push hot data to Redis cache
4. If webhook available: listen for customer updates → invalidate cache, refresh

**Example: Salesforce**
```json
GET https://instance.salesforce.com/services/data/v61.0/sobjects/Account
{
  "Id": "001Xx...",
  "Name": "Ram Poudel",
  "Phone": "+977-1-...",
  "Industry": "Insurance"
}
```

**Example: Custom API**
```json
GET https://cms.example.com/api/customers?type=health&renewalDate=2026-07-01
{
  "customers": [
    {
      "id": "cust_123",
      "name": "...",
      "phone": "...",
      "policyId": "pol_456",
      "renewalDate": "2026-07-01"
    }
  ]
}
```

### 6.2 WebRTC (Browser ↔ LiveKit)

- Browser: `livekit-client` v2.x (already in `package.json`)
- Worker: `livekit-agents` Python SDK
- Signaling: LiveKit HTTP API for room/token creation

### 6.3 Gemma 4B (vLLM / Ollama)

- vLLM: OpenAI-compatible endpoint `/v1/chat/completions`
- Ollama: `/api/chat` (compatible with openai-python library)
- Retry: if latency > 3s or error, fall back to Ollama then templated response

### 6.4 Nepali STT/TTS

- STT: Whisper (local) → Google (fallback)
  - Whisper config: `WHISPER_MODEL_PATH`, `WHISPER_CPP_BIN`
  - Google config: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_STT_LANGUAGE_CODES=ne-NP,en-US`
- TTS: Google (primary) → Piper (fallback)
  - Google config: `GOOGLE_TTS_LANGUAGE_CODE=ne-NP`, `GOOGLE_TTS_MODEL=gemini-2.5-flash-tts`, voice=`Kore`
  - Piper config: `PIPER_BIN`, `PIPER_VOICE_PATH`

---

## 7. Open Questions & Resolution Plan

### Q1: How does customer data flow from CMS? Polling? Webhooks?

**Answer:** Hybrid approach.

**Phase 1:** Bull job `sync-customers` runs hourly. Fetches all active policies from CMS, upserts into PostgreSQL, refreshes Redis.

**Phase 2:** If CMS supports webhooks (e.g., Salesforce Change Data Capture), listen for updates → invalidate cache immediately. Fallback to polling every 15 min for hot customers.

**Phase 3:** Implement CMS API versioning to handle schema changes.

---

### Q2: Are tickets created in the CMS or in LipiVoice DB?

**Answer:** Dual-write pattern.

1. **Primary creation:** In LipiVoice PostgreSQL `tickets` table (owned by LipiVoice)
2. **Auto-sync to CMS:** Async job pushes ticket to Salesforce Case API if `cmsTicketId` not set
3. **Bidirectional:** If external team creates case in Salesforce, webhook → upsert into LipiVoice (avoid duplication via unique constraint on `cms_ticket_id`)

**Rationale:** LipiVoice remains source of truth for call-originated tickets; CMS is read replica + external tracking.

---

### Q3: Call recording storage (local files, S3-compatible, database)?

**Answer:** Tiered approach.

- **Phase 1 (MVP):** Local disk (`/var/lib/lipivoice/recordings/{callId}.wav`)
- **Phase 2:** S3-compatible (`minio://` or AWS S3) with bucket versioning
- **Retention:** 30 days hot (searchable), 1 year cold (archive), PII redaction before archival
- **Recording flow:** LiveKit server records to local disk → async job transcodes (MP3) → uploads to S3 → delete local

---

### Q4: Agent authentication & multi-tenancy?

**Answer:** JWT-based + workspace isolation.

**Phase 1:** Single workspace, API key auth for system integrations.

**Phase 2:** OAuth2 + JWT. Each user scoped to workspace(s). Database query includes `workspace_id` in WHERE clause.

**Tables:** `users`, `workspaces`, `workspace_members`, `role_assignments`.

---

## 8. Error Handling & Resilience

### 8.1 Model Failures

| Scenario | Recovery |
|----------|----------|
| STT timeout (>2s) | Fallback to Google STT; if both fail, offer phone keypad input (DTMF) |
| LLM timeout (>3s) | Return templated response (e.g., "Hold for agent"); log error; escalate to human agent |
| TTS timeout (>1s) | Fallback to Piper; if unavailable, use silent waiting + text display |
| VAD false positive (repeated) | Increase min_duration; log pattern; alert ops team |

### 8.2 Database Failures

- Connection pool: 10-20 connections, 30s idle timeout
- Retry: 3 retries, exponential backoff (100ms, 500ms, 2s)
- Circuit breaker: if 5 failures in 1 min, reject queries for 30s; log alert
- Backup: PostgreSQL automatic WAL archival to S3

### 8.3 Network Failures

- WebRTC: ICE candidate gathering (3s timeout), fallback to TURN relay
- CMS API: timeout 5s, retry 2x with backoff
- Redis: if unavailable, operate in degraded mode (no caching, no queue persistence)

---

## 9. Deployment & Scaling

### 9.1 Local Development

```bash
docker compose up -d
# Services: postgres, redis, livekit, lipivoice-app, livekit-worker

npm run dev:server  # on host (or in Docker)
npm run dev         # Vite SPA
```

### 9.2 Production Deployment

**Infrastructure:**
- **App servers:** Node.js (2-4 instances, load-balanced)
- **Workers:** Python LiveKit agents (2-8 instances, auto-scaled by call volume)
- **Database:** PostgreSQL 15+ (managed RDS or self-hosted with HA)
- **Cache:** Redis (managed or Sentinel mode for HA)
- **Media server:** LiveKit (1-2 instances, can auto-scale)
- **ML inference:** vLLM (GPU instance, A100/L40S)
- **Job queue:** Bull workers (1-4 instances)

**Scaling:**
- **Concurrent calls:** Scale by LiveKit agent worker pool size (1 agent worker ≈ 10-20 concurrent calls on GPU)
- **Campaign throughput:** Scale Bull workers + throttle via `maxCallsPerMinute`
- **Database:** Read replicas for analytics; write to primary

### 9.3 Kubernetes Deployment (Phase 3+)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lipivoice-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: lipivoice-app
  template:
    metadata:
      labels:
        app: lipivoice-app
    spec:
      containers:
      - name: app
        image: lipivoice-app:latest
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: lipivoice-secrets
              key: database-url
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        readinessProbe:
          httpGet:
            path: /api/health
            port: 8787
          initialDelaySeconds: 5
          periodSeconds: 10
```

---

## 10. Security Considerations

1. **PII Handling:** Encrypt call recordings at rest; redact names/phone numbers before logging
2. **Rate Limiting:** Auth-aware rate limits (e.g., 100 calls/min per workspace)
3. **API Keys:** Rotate every 90 days; use HashiCorp Vault or AWS Secrets Manager
4. **Network:** TLS 1.3 for all external communication; mTLS between internal services
5. **Audit Log:** All calls, tickets, campaigns logged with user + timestamp
6. **GDPR/CCPA:** Customer data retention policy; right-to-delete implementation

---

## 11. Monitoring & Observability

### 11.1 Key Metrics

```
Calls:
- active_calls (gauge)
- calls_completed_total (counter)
- call_duration_seconds (histogram)
- call_failure_rate (ratio)

Models:
- stt_latency_ms (histogram)
- llm_latency_ms (histogram)
- tts_latency_ms (histogram)
- model_error_rate (ratio)

Campaigns:
- campaign_calls_queued (gauge)
- campaign_completion_rate (ratio)
- campaign_avg_outcome (enum: completed, no_answer, failed)

Infrastructure:
- postgres_connections (gauge)
- redis_memory_usage (gauge)
- vllm_gpu_utilization (gauge)
```

### 11.2 Alerts

```
- call_failure_rate > 5% for 5 min → page on-call engineer
- llm_latency > 5s → fallback mode + alert
- postgres connection pool > 80% → scale up
- campaign not progressing for 30 min → pause + investigate
```

---

## 12. Acceptance Criteria

### MVP (Phase 1) Complete When:

1. [ ] Single agent can receive inbound WebRTC call in browser
2. [ ] Call records (id, duration, transcript, events) persist in PostgreSQL
3. [ ] Customer lookup from CMS (via Redis cache) succeeds for 99% of calls
4. [ ] Ticket auto-generated from call transcript within 30s of call end
5. [ ] Call recording stored + transcribed within 5 min
6. [ ] Fallback models work: Whisper → Google STT, Ollama → vLLM LLM, Piper → Google TTS
7. [ ] Simulated call + WebRTC call both work (test both paths)
8. [ ] No PII leaks in logs; recordings encrypted at rest
9. [ ] Docker Compose local env with postgres, redis, livekit, app passes health checks
10. [ ] API endpoints documented (OpenAPI / Swagger)

---

## Appendix: File Paths & Implementation Checklist

### New Directories to Create

```
services/
├── job-worker/          -- Bull job queue
├── speech-processing/   -- Whisper inference server (optional Phase 1.5)
├── livekit-worker/      -- Python LiveKit agent (already started)
└── models/              -- Model binaries (Gemma 4B weights, Whisper, Piper)

src/server/
├── runtimes/            -- (existing, expand for Whisper runner)
├── jobs/                -- Bull queue definitions + handlers
├── cms/                 -- CMS sync + client
├── tickets/             -- Ticket generation logic
└── campaigns/           -- Campaign orchestration

migrations/              -- PostgreSQL migration files (Alembic-style or raw SQL)
```

### Implementation Checklist

- [ ] PostgreSQL schema + migrations
- [ ] Bull job queue setup
- [ ] CMS sync job (`sync-customers`)
- [ ] Ticket auto-generation from call transcript
- [ ] Customer cache Redis integration
- [ ] Campaign CRUD API
- [ ] Agent availability tracking
- [ ] Worker auto-scaling logic
- [ ] Error handling + fallbacks
- [ ] Monitoring + observability (prometheus metrics)
- [ ] Docker Compose for full stack
- [ ] Kubernetes Helm charts (Phase 3+)
- [ ] E2E tests (Playwright: browser call flow)
- [ ] Load testing (k6 or locust: 50+ concurrent calls)

---

## Appendix: Configuration Reference

### Environment Variables (Phase 1)

```bash
# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/lipivoice

# Redis
REDIS_URL=redis://localhost:6379

# LiveKit
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=lipivoice-receptionist

# LLM
VLLM_BASE_URL=http://vllm:8000/v1
VLLM_MODEL=gemma-4-finetuned-indic-4b
OLLAMA_BASE_URL=http://ollama:11434  # fallback

# STT
WHISPER_MODEL_PATH=/models/ggml-base.en.bin
WHISPER_CPP_BIN=/usr/local/bin/whisper-cli
GOOGLE_STT_LANGUAGE_CODES=ne-NP,en-US

# TTS
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-service-account.json
GOOGLE_TTS_LANGUAGE_CODE=ne-NP
GOOGLE_TTS_MODEL=gemini-2.5-flash-tts
GOOGLE_TTS_VOICE_NAME=Kore
PIPER_BIN=/usr/local/bin/piper
PIPER_VOICE_PATH=/models/ne_NP-noa-medium.onnx  # fallback

# CMS
CMS_API_BASE_URL=https://instance.salesforce.com
CMS_API_KEY=...
CMS_SYNC_INTERVAL_MINUTES=60

# Worker
LIPIVOICE_WORKER_API_KEY=...
WORKER_MAX_CONCURRENT_CALLS=20

# App
PORT=8787
NODE_ENV=production
JWT_SECRET=...
```

---

## Summary: MVP Scope

**MVP (Phase 1) = Single agent, inbound WebRTC calls, CMS customer lookup, basic ticket generation, 2-4 week sprint.**

End-to-end user flow:
1. Caller dials or opens browser → lands in WebRTC call
2. Agent receives call → greeting in Nepali (Google TTS)
3. Caller speaks → transcribed (Whisper/Google STT)
4. LLM generates response (Gemma 4B via vLLM) → synthesized (Google TTS)
5. Customer lookup from CMS (Redis cache) enriches context
6. Call ends → ticket auto-generated → stored in PostgreSQL
7. Agent/supervisor reviews call + transcript in dashboard

Success metric: 100 calls/day, 99% completion rate, < 2s transcription latency.

