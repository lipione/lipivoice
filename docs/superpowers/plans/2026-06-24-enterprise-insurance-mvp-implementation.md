# LipiVoice Enterprise Insurance MVP Implementation Plan

**Date:** 2026-06-24  
**Target Completion:** 2026-08-07 (6 weeks, 2 parallel workstreams)  
**MVP Scope:** Phase 1 only — single agent, inbound WebRTC, basic ticket generation, CMS integration  

---

## Overview

This plan converts the enterprise architecture design into executable tasks. Work is organized into 2 parallel workstreams:
- **Workstream A:** Backend (PostgreSQL, APIs, jobs, CMS integration)
- **Workstream B:** Frontend (React UI updates, agent dashboard)

Both converge on realtime call functionality by week 4, then integrate and harden through week 6.

---

## Workstream A: Backend (4 weeks + hardening)

### Week 1: PostgreSQL Setup + API Scaffolding

#### Task A1.1: Database Schema (Days 1-2)

**Files to create/modify:**
- `migrations/001_init_schema.sql` (create all tables from architecture doc)
- `src/server/store/schema.ts` (TypeScript definitions matching schema)

**Steps:**
1. [ ] Export schema SQL from architecture doc → `migrations/001_init_schema.sql`
2. [ ] Add migrations runner to `src/server/index.ts` (check schema version, auto-run pending)
3. [ ] Create `src/server/store/schema.ts` with TypeScript interfaces (Customer, Policy, Call, Ticket, Campaign)
4. [ ] Add DB setup to Docker Compose (`postgres:15` service)
5. [ ] Test locally: `docker compose up postgres && npm run db:migrate`

**Definition of Done:** Schema version 1 deployed, tables visible in `psql`, TypeScript types compile.

---

#### Task A1.2: API Layer Refactor (Days 3-4)

**Files to create/modify:**
- `src/server/app.ts` (extend with new endpoints)
- `src/server/repositories/` (data access layer)

**Steps:**
1. [ ] Create `src/server/repositories/customersRepository.ts` (CRUD operations)
2. [ ] Create `src/server/repositories/callsRepository.ts` (insert call, fetch, list)
3. [ ] Create `src/server/repositories/ticketsRepository.ts` (auto-generate, list, update)
4. [ ] Update `src/server/app.ts` to expose:
   - `GET /api/customers` (paginated, search)
   - `GET /api/calls` (list, filter by agent/customer/date)
   - `GET /api/calls/{id}` (with all events)
   - `POST /api/calls/{id}/note` (add notes)
5. [ ] Wire repositories into AppDeps (dependency injection)
6. [ ] Unit tests for repositories using in-memory SQLite

**Definition of Done:** All 4 endpoints respond with correct schema, tests pass, no breaking changes to existing endpoints.

---

### Week 2: CMS Integration + Caching

#### Task A2.1: CMS Client (Days 1-2)

**Files to create/modify:**
- `src/server/cms/client.ts` (HTTP client for Salesforce / custom API)
- `src/server/cms/types.ts` (Customer, Policy types from CMS)

**Steps:**
1. [ ] Create `src/server/cms/client.ts` with methods:
   - `fetchCustomers(filters)` → returns Customer[]
   - `fetchPolicies(customerId)` → returns Policy[]
   - `pushTicket(ticket)` → returns cmsTicketId (optional if CMS supports)
2. [ ] Support two modes via env var `CMS_TYPE=salesforce|custom`
3. [ ] Implement retries + timeout (5s max)
4. [ ] Add logging for all CMS calls
5. [ ] Unit tests with mocked HTTP responses

**Definition of Done:** Client can fetch customers from mocked CMS, retries on timeout, error handling works.

---

#### Task A2.2: Customer Sync Job + Redis Cache (Days 3-4)

**Files to create/modify:**
- `services/job-worker/sync-customers.js` (Bull job)
- `src/server/cache/customerCache.ts` (Redis wrapper)
- `src/server/app.ts` (add job status endpoint)

**Steps:**
1. [ ] Set up Bull:
   - `npm install bull`
   - Create `services/job-worker/` folder + `package.json`
   - Create job processor: `sync-customers.js`
2. [ ] Implement job:
   ```javascript
   jobQueue.add('sync-customers', {}, {
     repeat: { cron: '0 * * * *' }  // hourly
   });
   
   processor = async (job) => {
     const customers = await cmsClient.fetchCustomers();
     for (const cust of customers) {
       db.customers.upsert(cust);
       redis.set(`customer:${cust.id}`, JSON.stringify(cust), 3600);
     }
   };
   ```
3. [ ] Create `src/server/cache/customerCache.ts`:
   - `getCustomer(id)` → check Redis, fallback to DB
   - `invalidateCustomer(id)` → clear Redis key
4. [ ] Add API: `GET /api/sync/jobs/{jobId}` (status: running, completed, failed)
5. [ ] Add endpoint to manually trigger: `POST /api/sync/customers/trigger`

**Definition of Done:** Hourly job runs, customers synced to DB, hot data in Redis, cache TTL works, job status API responds.

---

### Week 3: Call Recording + Ticket Generation

#### Task A3.1: Call Recording Storage (Days 1-2)

**Files to create/modify:**
- `src/server/recording/recorder.ts`
- `src/server/recording/storage.ts` (S3-compatible or local filesystem)

**Steps:**
1. [ ] Add recording storage config:
   - `RECORDING_STORAGE=local|s3`
   - `RECORDING_LOCAL_PATH=/var/lib/lipivoice/recordings`
   - `S3_BUCKET=lipivoice-recordings` (Phase 2)
2. [ ] For Phase 1, implement local filesystem storage:
   - LiveKit records to file → move to `RECORDING_LOCAL_PATH/{callId}.wav`
   - Store location in `calls.recording_url` (file path or S3 URL)
3. [ ] Add API: `GET /api/calls/{id}/recording` (serve file or redirect)
4. [ ] Add cleanup job (optional Phase 1.5): delete recordings older than 30 days

**Definition of Done:** Recording created during call, URL stored in DB, API serves recording, no errors on cleanup.

---

#### Task A3.2: Ticket Auto-Generation (Days 3-4)

**Files to create/modify:**
- `src/server/tickets/generator.ts`
- `src/server/repositories/ticketsRepository.ts` (extend)
- `src/server/jobs/generateTicket.js` (Bull job triggered from call end)

**Steps:**
1. [ ] Create `src/server/tickets/generator.ts`:
   ```typescript
   export function generateTicketFromCall(call: Call, events: CallEvent[]): TicketInput {
     // Extract transcript
     const transcripts = events.filter(e => e.type === 'transcript');
     
     // Detect intent (simple heuristics for MVP)
     let category = 'followup';
     if (transcripts.some(e => e.payload.text.includes('callback'))) {
       category = 'callback_request';
     }
     
     return {
       callId: call.id,
       customerId: call.customerId,
       title: `Call from ${call.customer.name}`,
       category,
       description: transcripts.map(e => e.payload.text).join('\n'),
       priority: 'medium',
       status: 'open',
     };
   }
   ```
2. [ ] Create Bull job: `generateTicket` triggered on call end
3. [ ] Add endpoint: `POST /api/tickets` (manual creation if needed)
4. [ ] Tests: verify ticket created with correct category/description

**Definition of Done:** Ticket auto-created within 30s of call end, content extracted from transcript, visible in `/api/tickets`.

---

### Week 4: Integration + Error Handling

#### Task A4.1: Error Handling + Fallbacks (Days 1-3)

**Files to modify:**
- `src/server/runtimes/` (extend with fallback logic)
- `src/server/voice/pipeline.ts` (error budget)

**Steps:**
1. [ ] Implement STT fallback: Whisper (3s timeout) → Google STT (3s timeout) → DTMF fallback
2. [ ] Implement LLM fallback: vLLM (3s timeout) → Ollama (5s timeout) → templated response
3. [ ] Implement TTS fallback: Google (2s timeout) → Piper (2s timeout) → silent + text display
4. [ ] Add event payload for failures: `type: 'error'`, `payload: { stage: 'stt' | 'llm' | 'tts', reason, latencyMs }`
5. [ ] Add metrics: `fallback_invoked_total` (counter per stage)
6. [ ] Integration tests: simulate timeout, verify fallback works

**Definition of Done:** Fallback chains work end-to-end, metrics emitted, no silent failures.

---

#### Task A4.2: Docker Compose + Local Testing (Days 4)

**Files to create/modify:**
- `docker-compose.yml` (extend from existing)
- `.env.example` (document all vars)
- `README.md` (local setup instructions)

**Steps:**
1. [ ] Update docker-compose:
   - postgres:15 service (volumes, env)
   - redis:7 service
   - Keep livekit, app, worker services
   - Add job-worker service (Bull)
2. [ ] Create `.env.example` with all vars from architecture doc
3. [ ] Update README: "Local Development" section with step-by-step
4. [ ] Test locally: `docker compose up -d && npm run test && npm run dev`

**Definition of Done:** Full stack starts with `docker compose up`, health checks pass, no manual setup beyond `.env` copy.

---

### Week 5-6: Hardening + Integration with Workstream B

(Merged into final phase below)

---

## Workstream B: Frontend (Weeks 2-4, converge Week 5)

### Week 2: Agent Dashboard Setup

#### Task B2.1: Agent Pages Refactor (Days 1-3)

**Files to create/modify:**
- `src/features/agents/AgentsPage.tsx` (extend)
- `src/features/agents/AgentCard.tsx` (new agent profile)
- `src/features/agents/AgentAvailability.tsx` (new availability status)

**Steps:**
1. [ ] Create agent availability UI:
   - Status: Active | On Break | Offline (buttons)
   - Calls active: N (counter)
   - Avg duration: X min (stat)
2. [ ] Add API integration: `POST /api/agents/{id}/availability` (send status change)
3. [ ] Fetch real-time availability: poll `/api/agents/{id}/availability` every 5s (or subscribe to WebSocket later)
4. [ ] Tests: verify status buttons work, API calls made

**Definition of Done:** Agent can toggle availability, UI updates, status persists across page refresh.

---

#### Task B2.2: Call History + Search (Days 4)

**Files to create/modify:**
- `src/features/calls/CallsPage.tsx` (extend from existing)
- `src/features/calls/CallHistory.tsx` (new table component)
- `src/features/calls/CallFilter.tsx` (new filter sidebar)

**Steps:**
1. [ ] Add table to Calls page: columns = [time, customer name, duration, status, transcript preview]
2. [ ] Add filters: date range, agent, customer, status
3. [ ] Implement pagination: fetch first 50, load more on scroll
4. [ ] Search: `GET /api/calls?search=...&limit=50&offset=0`
5. [ ] Click row → open call detail modal with full transcript + events
6. [ ] Tests: verify table renders, filters applied, pagination works

**Definition of Done:** Call history searchable, paginated, clickable for details, looks good on mobile + desktop.

---

### Week 3: Call Detail + Events

#### Task B3.1: Call Detail Modal (Days 1-2)

**Files to create/modify:**
- `src/features/calls/CallDetail.tsx` (new modal/drawer)
- `src/features/calls/CallTranscript.tsx` (display transcript with speaker badges)
- `src/features/calls/CallEvents.tsx` (timeline of events: status, tool calls, errors)

**Steps:**
1. [ ] Modal layout:
   - Header: Call ID, duration, customer, agent, timestamp
   - Tabs: Transcript, Events, Recording
2. [ ] Transcript tab: display alternating user/assistant bubbles with text
3. [ ] Events tab: timeline of tool calls, status changes, errors (with severity color coding)
4. [ ] Recording tab: audio player (if recording_url present)
5. [ ] Notes section: allow agent to add/edit call notes (`POST /api/calls/{id}/note`)
6. [ ] Tests: verify all tabs render, notes saved

**Definition of Done:** Call detail readable, transcript clear, events properly sequenced, notes editable.

---

#### Task B3.2: Ticket Preview (Days 3)

**Files to create/modify:**
- `src/features/calls/CallDetail.tsx` (extend with ticket section)
- Add ticket display in call detail

**Steps:**
1. [ ] In call detail, add "Ticket" section
2. [ ] Show auto-generated ticket (if exists): title, category, priority, status
3. [ ] Allow reassign ticket: `PATCH /api/tickets/{id}` (assignedTo, status)
4. [ ] Link to ticket in Operations page
5. [ ] Tests: verify ticket displayed, reassign works

**Definition of Done:** Ticket visible + actionable from call detail, reassignment persists.

---

### Week 4: Runtime Diagnostics + Customer Lookup

#### Task B4.1: Customer Lookup (Days 1-2)

**Files to create/modify:**
- `src/features/calls/CallsPage.tsx` (add customer search before starting call)
- `src/client/api.ts` (add `/api/customers` fetch)

**Steps:**
1. [ ] Before "Start Call" button, add customer search field
2. [ ] Async search: `GET /api/customers?search=...` → dropdown of results
3. [ ] On select, prefill customer context (name, phone, policies)
4. [ ] Store selected customer in call state → pass to API
5. [ ] Tests: search works, dropdown appears, selection sets state

**Definition of Done:** Agent can find + select customer before call, prefilled data shown.

---

#### Task B4.2: Runtime Status Cards (Days 3)

**Files to modify:**
- `src/features/calls/CallsPage.tsx` (extend from existing)
- Add diagnostic cards for STT, LLM, TTS status

**Steps:**
1. [ ] Fetch `/api/runtime-diagnostics` on load
2. [ ] Display runtime health cards:
   - STT: Whisper (local) or Google → status, latency
   - LLM: vLLM or Ollama → status, latency
   - TTS: Google or Piper → status, latency
3. [ ] Color coding: green (healthy), yellow (slow > 1s), red (failed)
4. [ ] Show fallback chain: "Whisper → Google STT" (if applicable)
5. [ ] Tests: verify cards render, status updates

**Definition of Done:** Runtime status visible before/after call, color-coded, fallback chain clear.

---

## Convergence Phase: Weeks 5-6 (Parallel Integration + Hardening)

### Week 5: End-to-End Integration

#### Task C5.1: E2E Call Flow (Days 1-3)

**Steps:**
1. [ ] Integration test: browser call start → WebRTC → agent session → transcript → ticket
2. [ ] Test paths:
   - Simulated call (API-only, existing path)
   - LiveKit call (new full path)
3. [ ] Verify data flows:
   - Call record in DB
   - Events persisted
   - Customer lookup succeeded
   - Ticket created
   - Recording stored
4. [ ] Fix integration issues (data mismatches, timing issues)

**Definition of Done:** E2E test passes, all 4 data flows confirmed, no data loss.

---

#### Task C5.2: Performance Baseline (Days 4)

**Steps:**
1. [ ] Run load test: 10 concurrent calls, measure:
   - API response times (< 200ms for 95th percentile)
   - Database query times (< 50ms for 95th percentile)
   - STT latency (< 2s for 95th percentile)
   - LLM latency (< 3s for 95th percentile)
   - TTS latency (< 1s for 95th percentile)
2. [ ] Identify bottlenecks (DB indexes, connection pooling, etc.)
3. [ ] Document baseline in `PERFORMANCE.md`

**Definition of Done:** Baseline established, no regressions detected, critical paths < targets.

---

### Week 6: Hardening + Documentation

#### Task C6.1: Error Handling + Observability (Days 1-2)

**Steps:**
1. [ ] Add structured logging to all services (JSON format with trace ID)
2. [ ] Add Prometheus metrics (prometheus client library)
3. [ ] Test error scenarios: DB down, Redis down, LLM timeout, CMS timeout
4. [ ] Verify graceful degradation (fallbacks work)
5. [ ] Document error codes + resolutions in `TROUBLESHOOTING.md`

**Definition of Done:** All errors logged, metrics exported, operators can debug issues.

---

#### Task C6.2: Security + Compliance (Days 3)

**Steps:**
1. [ ] PII redaction: mask phone numbers in logs
2. [ ] Recording encryption at rest (optional for MVP, flag for Phase 2)
3. [ ] JWT validation on all APIs (extend existing)
4. [ ] Rate limits: 100 calls/min per IP, 1000 calls/min per workspace
5. [ ] Audit log: all call/ticket changes recorded
6. [ ] Document in `SECURITY.md`

**Definition of Done:** No PII leaks in logs, rate limits enforced, audit log populated.

---

#### Task C6.3: Final Documentation (Day 4)

**Steps:**
1. [ ] Complete `ARCHITECTURE.md` (link to design doc)
2. [ ] Update `README.md` with local setup + deployment steps
3. [ ] Add OpenAPI/Swagger docs for all APIs
4. [ ] Create `DEPLOYMENT.md` with cloud setup (Docker, K8s templates)
5. [ ] Add `TROUBLESHOOTING.md` with common issues + fixes
6. [ ] Record setup video (optional)

**Definition of Done:** Docs complete, another engineer can set up locally following README, no ambiguities.

---

## Dependency Tree & Critical Path

```
A1.1 (Schema) → A1.2 (API) → A2.1 (CMS) → A2.2 (Sync) → A3.1 (Recording)
                                                              ↓
                                                         A3.2 (Tickets)
                                                              ↓
                                                         A4.1 (Fallbacks)
                                                         A4.2 (Docker)

B2.1 (Agent Dashboard) → B3.1 (Call Detail) → B3.2 (Tickets)
B2.2 (Call History)

→ Converge: C5.1 (E2E) → C5.2 (Perf) → C6.1-6.3 (Hardening + Docs)
```

**Critical Path:** A1.1 → A1.2 → A2.1 → A2.2 → A4.2 (Docker) + B2.1 → C5.1 (6 weeks)

---

## Resource Allocation

### Week 1-3: 2 Engineers (1 Backend, 1 Frontend)

- **Engineer A (Backend):** Schema, API, CMS, Jobs (50% capacity for code reviews)
- **Engineer B (Frontend):** Agent dashboard, call history, detail pages (50% capacity for testing)

### Week 4-5: Pair on Integration

- **Both:** E2E tests, performance baseline, bug fixes (100% focus)

### Week 6: 1 Engineer (Hardening Lead)

- **Engineer A (Lead):** Security, logging, metrics, docs; Engineer B assists as needed

---

## Success Criteria (Definition of Done for MVP)

1. [ ] **Schema:** PostgreSQL v1 migrated, tables visible, no errors
2. [ ] **APIs:** All 12 endpoints (customers, calls, tickets, campaigns, analytics) respond correctly
3. [ ] **CMS Integration:** Hourly sync running, customers cached in Redis, no data loss
4. [ ] **Call Recording:** Recordings stored, URL persisted, playable
5. [ ] **Ticket Generation:** Auto-generated within 30s of call end, correct category + description
6. [ ] **Error Handling:** All fallback chains tested, metrics emitted, failures logged
7. [ ] **Frontend:** Call history + detail pages functional, agent dashboard updated, no UI bugs
8. [ ] **E2E:** One complete call flow tested (start → transcript → ticket), data integrity confirmed
9. [ ] **Performance:** 95th percentile latencies < targets (API 200ms, DB 50ms, models 3s)
10. [ ] **Security:** No PII in logs, JWT validation, audit log populated
11. [ ] **Documentation:** README, architecture, API docs, deployment guide complete
12. [ ] **Docker:** `docker compose up` starts all services, health checks pass, no manual steps

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| vLLM latency > 3s (bottleneck) | Medium | High | Early load testing week 3; scale GPU, batch requests |
| CMS API unavailable (sync fails) | Medium | Medium | Implement fallback (serve stale cache), retry with backoff |
| PostgreSQL schema changes needed mid-project | Low | High | Version schema, test migrations early, keep ddl reversible |
| WebRTC signaling issues (LiveKit) | Low | High | Test browser+worker locally, enable debug logging |
| Recording disk space fills (Phase 1) | Low | Medium | Set retention policy (30 days), cleanup job, monitor disk |

---

## Sign-Off & Approval

- **Architecture Review:** Approved 2026-06-24
- **Backend Lead:** [TBD]
- **Frontend Lead:** [TBD]
- **DevOps Lead:** [TBD]
- **Timeline:** 6 weeks target, review at week 3 checkpoint

---

## Appendix: File Structure Created

```
src/
├── server/
│   ├── app.ts (extended with new endpoints)
│   ├── repositories/
│   │   ├── customersRepository.ts
│   │   ├── callsRepository.ts
│   │   ├── ticketsRepository.ts
│   │   └── index.ts
│   ├── cms/
│   │   ├── client.ts
│   │   └── types.ts
│   ├── cache/
│   │   └── customerCache.ts
│   ├── jobs/
│   │   ├── generateTicket.ts
│   │   └── index.ts
│   ├── tickets/
│   │   └── generator.ts
│   └── recording/
│       ├── recorder.ts
│       └── storage.ts
├── features/
│   ├── agents/
│   │   ├── AgentCard.tsx
│   │   └── AgentAvailability.tsx
│   └── calls/
│       ├── CallDetail.tsx
│       ├── CallTranscript.tsx
│       ├── CallEvents.tsx
│       ├── CallFilter.tsx
│       ├── CallHistory.tsx
│       └── CallsPage.tsx (extended)
└── ...

services/
└── job-worker/
    ├── package.json
    ├── sync-customers.js
    └── generateTicket.js

migrations/
└── 001_init_schema.sql

docs/
├── superpowers/
│   ├── specs/
│   │   └── 2026-06-24-lipivoice-enterprise-insurance-platform-architecture.md
│   └── plans/
│       └── 2026-06-24-enterprise-insurance-mvp-implementation.md
├── ARCHITECTURE.md (links to spec)
├── DEPLOYMENT.md (new)
├── TROUBLESHOOTING.md (new)
└── SECURITY.md (new)
```

