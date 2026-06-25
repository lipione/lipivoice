# LipiVoice Operations CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build LipiVoice-owned customer, ticket, appointment, and transfer/escalation persistence so agent tools create real internal operations records instead of demo-only IDs.

**Architecture:** Add typed domain records and SQLite JSON repositories following the existing agents/calls/tools repository pattern. Expose REST APIs for operations lists and detail creation, update worker tool handlers to create/link records and still append `tool_call` events, then add a simple Operations UI page for reviewing Customers, Tickets, Appointments, and Escalations. Keep the schema SQLite-first and migration-safe for later Postgres migration.

**Tech Stack:** TypeScript, Zod, Express, better-sqlite3, React, Vitest, Supertest, Docker Compose remote deployment.

---

### Task 1: Domain And Persistence

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/schemas.ts`
- Modify: `src/domain/defaults.ts`
- Modify: `src/server/store/database.ts`
- Modify: `src/server/store/repositories.ts`
- Test: `src/server/store/repositories.test.ts`

- [x] Add `Customer`, `Ticket`, `Appointment`, and `TransferRecord` types.
- [x] Add matching Zod schemas.
- [x] Add empty arrays to workspace seed output.
- [x] Add SQLite JSON tables: `customers`, `tickets`, `appointments`, `transfers`.
- [x] Add repositories with `list`, `get`, `save`, `insertMissing`, and convenience create/update where needed.
- [x] Add repository tests for create/list/update and call/customer linkage.

### Task 2: Operations API

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts`

- [x] Add list routes: `GET /api/customers`, `/api/tickets`, `/api/appointments`, `/api/transfers`.
- [x] Add create/update routes for tickets and customers sufficient for UI and tools.
- [x] Add tests that create a customer and ticket through API and verify persistence.

### Task 3: Worker Tool Persistence

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts`

- [x] Change `customer-lookup` to return existing customer or create a placeholder lead if lookup details are enough.
- [x] Change `schedule-callback` to create an appointment record.
- [x] Change `transfer-call` to create a transfer record.
- [x] Change `create-escalation` to create a ticket record with `type: "complaint"` or `type: "other"` and priority.
- [x] Keep `tool_call` events, but include created `customerId`, `ticketId`, `appointmentId`, or `transferId`.

### Task 4: Operations UI

**Files:**
- Create: `src/features/operations/OperationsPage.tsx`
- Create: `src/features/operations/OperationsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify navigation shell file used by `src/App.tsx`

- [x] Add an Operations page with tabs/sections for Customers, Tickets, Appointments, and Escalations.
- [x] Fetch the four API lists and render dense tables/cards.
- [x] Add empty states and error states.
- [x] Add navigation entry named `Operations`.

### Task 5: Verification And Deployment

**Commands:**
- `npm test -- --run src/server/store/repositories.test.ts src/server/app.test.ts src/features/operations/OperationsPage.test.tsx`
- `npm run build`
- `rsync` to `/data/lipiV`
- `docker compose -f docker-compose.remote.yml --env-file .env build lipiv-app`
- `docker compose -f docker-compose.remote.yml --env-file .env up -d --force-recreate lipiv-app`

- [x] Confirm `/api/health` passes.
- [x] Smoke test worker tool endpoints create operations records.
- [x] Verify hosted Operations page renders records.
