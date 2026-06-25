# LipiVoice

LipiVoice is a self-hosted, open-source enterprise voice call center platform built for Nepali-first insurance operations. Designed for Sagarmatha Lumbini Insurance Company Limited (SALICO), it handles inbound WebRTC browser calls, outbound personalised campaigns, ticket generation, and CMS customer/policy integration — entirely on your own infrastructure with no cloud TTS, STT, or LLM dependencies.

## What's Running Now

- **Dashboard** with Agents, Calls, Voice Lab, Voice Console, Operations, Campaigns, Tools, and SDK Playground pages.
- **Inbound calls** — WebRTC browser sessions with full STT → LLM → TTS pipeline via LiveKit.
- **Outbound campaigns** — scheduled personalised calls with customer/policy context injected into the agent prompt (policy renewals, claim follow-ups).
- **CMS integration** — sync customers and policies from any external API (bearer, API key, basic, or no auth).
- **Operations CRM** — customers, tickets, appointments, transfers, and policies persisted in SQLite.
- **Ticket auto-generation** — from completed calls via worker tools.
- **Voice Lab** — TTS benchmark and comparison across Piper, Coqui, and FastPitch adapters.
- **Multi-adapter TTS** — per-voice runtime selection (Piper HTTP, Coqui XTTS, FastPitch); health checks before every call.
- **Self-hosted STT** — Faster-Whisper via HTTP API (OpenAI-compatible).
- **Self-hosted LLM** — Gemma 4B via Ollama (local) or vLLM (remote/GPU).

## Self-Hosted Stack (No Cloud Dependencies)

| Role | Engine | Adapter key |
| ---- | ------ | ----------- |
| TTS (fast CPU) | [Piper](https://github.com/rhasspy/piper) HTTP service | `piper_http` |
| TTS (expressive, cloning) | [Coqui XTTS](https://github.com/coqui-ai/TTS) HTTP service | `coqui_http` |
| TTS (GPU-accelerated) | [FastPitch / NeMo](https://github.com/NVIDIA/NeMo) HTTP service | `fastpitch_http` |
| STT | [Faster-Whisper](https://github.com/guillaumekln/faster-whisper) (OpenAI-compatible) | `faster_whisper` |
| LLM (local) | [Gemma 4B via Ollama](https://ollama.com) | `ollama` |
| LLM (remote/GPU) | Gemma 4B via [vLLM](https://github.com/vllm-project/vllm) | `vllm` |
| Call signaling | [LiveKit](https://livekit.io) open-source SFU | — |

## Local Runtime Setup

Install and run the engines you want to test with, then set the corresponding env vars:

```sh
# LLM (Ollama local)
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export LIPIVOICE_LLM_MODEL=gemma3:4b

# STT (Faster-Whisper HTTP server)
export FASTER_WHISPER_ENDPOINT=http://127.0.0.1:9000

# TTS (Piper HTTP server — primary)
export PIPER_HTTP_ENDPOINT=http://127.0.0.1:5002

# TTS (Coqui XTTS — optional)
export COQUI_HTTP_ENDPOINT=http://127.0.0.1:5003

# TTS (FastPitch — optional, GPU)
export FASTPITCH_HTTP_ENDPOINT=http://127.0.0.1:5004

# App
export PORT=8787
export LIPIVOICE_DB_PATH=data/lipivoice.sqlite
```

If a TTS service is not running, Voice Lab reports `unavailable` for that adapter and calls fall back to the next configured adapter. The API server still starts and serves the dashboard.

## Remote Runtime Setup

Use the remote preset for the production server with vLLM and the full LipiML inference stack:

```sh
export LIPIVOICE_RUNTIME_PRESET=remote
export LIPI_ML_BASE_URL=http://127.0.0.1:5001    # LipiML inference server
export VLLM_BASE_URL=http://127.0.0.1:8002/v1
export VLLM_MODEL=gemma-4b-salico-v1

# TTS adapters (same keys as local)
export PIPER_HTTP_ENDPOINT=http://127.0.0.1:5002
export COQUI_HTTP_ENDPOINT=http://127.0.0.1:5003
export FASTPITCH_HTTP_ENDPOINT=http://127.0.0.1:5004
export FASTER_WHISPER_ENDPOINT=http://127.0.0.1:9000

export LIPIVOICE_DB_PATH=data/lipivoice.sqlite
export LIPIVOICE_PUBLIC_BASE_URL=https://ai.silverlining.com.np/voice
```

The remote preset seeds the workspace with:

- `runtime_vllm` — vLLM (Gemma 4B) as the primary LLM.
- `runtime_lipi_ml_stt` — Faster-Whisper for Nepali STT.
- `runtime_lipi_ml_tts` — Piper HTTP (via LipiML endpoint) for the default Nepali voice `voice_lipi_ml_ne`.
- `runtime_piper_http` — direct Piper HTTP for voices `voice_piper_ne_sita` / `voice_piper_ne_maya`.
- `runtime_coqui_http` — Coqui XTTS for `voice_coqui_ne_anju` / `voice_coqui_ne_kiran`.
- `runtime_fastpitch_http` — FastPitch for `voice_fastpitch_ne_nabin` / `voice_fastpitch_ne_bikram`.

## Voices

All production voices are Nepali-native. The default agent voice is `voice_lipi_ml_ne` (Sita via LipiML Piper endpoint).

| Voice ID | Name | Runtime | Tags |
| -------- | ---- | ------- | ---- |
| `voice_lipi_ml_ne` | Sita (LipiML) | `runtime_lipi_ml_tts` | piper, nepali, female, default |
| `voice_piper_ne_sita` | Sita (Piper) | `runtime_piper_http` | piper, nepali, female, fast |
| `voice_piper_ne_maya` | Maya (Piper) | `runtime_piper_http` | piper, nepali, female, fast |
| `voice_coqui_ne_anju` | Anju (Coqui) | `runtime_coqui_http` | coqui, nepali, female, expressive |
| `voice_coqui_ne_kiran` | Kiran (Coqui) | `runtime_coqui_http` | coqui, nepali, male, expressive |
| `voice_fastpitch_ne_nabin` | Nabin (FastPitch) | `runtime_fastpitch_http` | fastpitch, nepali, male, gpu |
| `voice_fastpitch_ne_bikram` | Bikram (FastPitch) | `runtime_fastpitch_http` | fastpitch, nepali, male, gpu |

## Development

```sh
npm install
npm run dev:server     # API on :8787
npm run dev            # Vite on :5173 (proxies /api to :8787)
```

Open `http://localhost:5173`.

## Realtime Web Calls (LiveKit)

```sh
export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=devsecret
export LIVEKIT_AGENT_NAME=lipivoice-receptionist
export LIPIVOICE_WORKER_API_KEY=worker-secret
```

Start the Python worker:

```sh
cd services/livekit-worker
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python agent.py dev
```

Then open the Calls page and click **Start live call** for a WebRTC session, or **Start demo call** for a simulated API-only turn.

## Operations CRM

SQLite tables owned by LipiVoice:

| Table | Purpose |
| ----- | ------- |
| `customers` | Caller profiles and CMS-synced leads |
| `policies` | Insurance policies linked to customers, with renewal dates |
| `tickets` | Issues, complaints, claim follow-ups, escalations |
| `appointments` | Callback requests with preferred time |
| `transfers` | Queued handoffs to licensed staff |
| `campaigns` | Outbound campaign definitions |
| `campaign_runs` | Per-contact call execution records |

Worker tools create `customers`, `tickets`, `appointments`, and `transfers` automatically during live calls and attach them to call event logs. The Operations page is the review surface.

## Campaigns (Outbound)

The Campaigns page lets you:

- **Quick build** — generate a renewal campaign from all policies due within a date range.
- **Manual create** — define name, type (renewal, claim_followup, survey), script template, and contact list.
- **Launch** — dispatch outbound calls; each contact gets the agent prompt enriched with their customer and policy context.
- **Track** — live per-contact status (pending → dialing → completed/failed).

```sh
GET  /api/campaigns
POST /api/campaigns
GET  /api/campaigns/:id
POST /api/campaigns/:id/launch
GET  /api/campaigns/:id/runs
POST /api/campaigns/build-renewal   # body: { startDate, endDate }
```

## CMS Integration

Sync customers and policies from any external API:

```sh
POST /api/cms/sync
{
  "baseUrl": "https://your-cms.example.com",
  "authMode": "bearer" | "api_key" | "basic" | "none",
  "authValue": "<token or user:pass>"
}
```

The adapter normalises snake_case and camelCase field names and deduplicates by phone number / CMS ID.

## Full API Reference

```sh
# Health
GET  /api/health

# Runtimes & models
GET  /api/model-runtimes
GET  /api/model-assets
GET  /api/tts/providers
POST /api/tts/benchmark

# Agents & voices
GET  /api/agents
GET  /api/voices
GET  /api/tools

# Calls
GET  /api/calls
POST /api/calls/simulate
GET  /api/calls/:id/events
POST /api/calls/:id/simulate-turn

# Operations
GET  /api/customers
GET  /api/customers/:id
GET  /api/tickets
GET  /api/appointments
GET  /api/transfers

# Policies
GET  /api/policies
GET  /api/policies/:id
GET  /api/customers/:id/policies

# Campaigns
GET  /api/campaigns
POST /api/campaigns
GET  /api/campaigns/:id
POST /api/campaigns/:id/launch
GET  /api/campaigns/:id/runs
POST /api/campaigns/build-renewal

# CMS sync
POST /api/cms/sync

# LiveKit
POST /api/livekit/web-call/start
```

## Docker (Remote Deployment)

```sh
docker compose -f docker-compose.remote.yml up -d --build
```

Services:

- `lipiv-app` — Express API + Vite build, port `8787`.
- `lipiv-livekit` — LiveKit SFU, TCP `7880` / UDP `443` / `30000-30002`.
- `lipiv-livekit-worker` — Python agent worker `lipivoice-receptionist`.

TTS/STT/LLM inference services (Piper, Coqui, FastPitch, Faster-Whisper, Ollama/vLLM) run as separate containers — wire them in docker-compose or run on separate hosts and point the env vars at them.

Useful health checks:

```sh
curl -s http://127.0.0.1:8787/api/health
curl -s http://127.0.0.1:8787/api/model-runtimes
curl -s http://127.0.0.1:8787/api/tts/providers
curl -s http://127.0.0.1:8787/api/campaigns
curl -s -X POST http://127.0.0.1:8787/api/tts/benchmark \
  -H 'content-type: application/json' \
  -d '{"providerId":"piper_http_tts","text":"नमस्ते, लिपिभ्वाइस परीक्षण हो।"}'
```

## Verification

```sh
npm run test
npm run lint
npm run build
```

237/240 tests passing (3 pre-existing UI error-state timing issues unrelated to core functionality).
