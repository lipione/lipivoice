# LipiVoice White-Label Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove public mentions of third-party model/provider names and present the product as LipiVoice, LipiSense, LipiHear, and LipiCore with Nepali voice names.

**Architecture:** Preserve internal adapter IDs, service credentials, env vars, and runtime implementation names so deployed calls keep working. Change only user-facing labels, seeded display names, docs, and tests. Add a remote DB branding update after deploy because existing SQLite records are not automatically overwritten by seed updates.

**Tech Stack:** React, TypeScript, Express seed data, Vitest, Docker Compose remote deployment.

---

### Task 1: Public Runtime And Voice Labels

**Files:**
- Modify: `src/domain/defaults.ts`
- Modify: `src/features/calls/CallsPage.tsx`
- Modify: `src/features/overview/OverviewPage.tsx`
- Modify: `src/domain/ttsProviders.ts`

- [ ] Update seeded runtime/model/voice display names:
  - `Gemini 2.5 Flash` -> `LipiSense Realtime`
  - `Google Speech-to-Text Nepali` -> `LipiHear Nepali`
  - `Google Gemini TTS Nepali` -> `LipiVoice Nepali`
  - `Piper`/`Whisper`/`Ollama`/`vLLM` public names -> Lipi-branded equivalents.
- [ ] Rename public voice choices to Nepali names while preserving IDs:
  - `voice_google_gemini_kore_ne` -> `Sita`
  - `voice_google_gemini_aoede_ne` -> `Maya`
  - `voice_google_gemini_leda_ne` -> `Anju`
  - `voice_google_gemini_charon_ne` -> `Kiran`
  - `voice_google_gemini_puck_ne` -> `Nabin`
  - `voice_google_gemini_orus_ne` -> `Bikram`
- [ ] Change adapter label mapping in Calls UI so adapter names render as Lipi product names.

### Task 2: Tests And Docs

**Files:**
- Modify: `src/domain/defaults.test.ts`
- Modify: `src/features/calls/CallsPage.test.tsx`
- Modify: `src/features/overview/OverviewPage.test.tsx`
- Modify: `README.md`
- Modify: `services/livekit-worker/README.md`

- [ ] Update assertions that look for old public provider labels.
- [ ] Remove public docs mentions of third-party model/provider brands except internal environment-variable names needed for setup.
- [ ] Keep implementation-specific source code class names and env vars unchanged.

### Task 3: Verify, Deploy, And Update Existing Remote Records

**Commands:**
- `npm test -- --run src/domain/defaults.test.ts src/features/calls/CallsPage.test.tsx src/features/overview/OverviewPage.test.tsx`
- `npm run build`
- `rsync` project to `/data/lipiV`
- `docker compose -f docker-compose.remote.yml --env-file .env build lipiv-app`
- `docker compose -f docker-compose.remote.yml --env-file .env up -d --force-recreate lipiv-app`

- [ ] Update existing remote SQLite records for affected agent/model/voice names using repository APIs or a one-off Node script in the app container.
- [ ] Verify hosted UI shows Lipi-branded runtime/voice labels and no public third-party provider labels in Calls/Overview.
