# LipiVoice Realtime Worker

Runs the realtime worker for LipiVoice web-call sessions.

## Setup

```bash
cd services/livekit-worker
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with realtime service, LipiVoice, and self-hosted runtime endpoints.

The call worker is configured for the Lipi stack end to end:

- STT: self-hosted LipiML native `/stt` by default, or an explicit OpenAI-compatible transcription endpoint.
- LLM: self-hosted vLLM or another OpenAI-compatible chat endpoint.
- TTS: self-hosted LipiML native `/tts` by default, or an explicit OpenAI-compatible speech endpoint.

Live LLM routing is controlled by:

- `LIPIVOICE_LLM_BACKEND` (default `vllm`; Google backends are intentionally unsupported).
- `VLLM_BASE_URL` and `VLLM_MODEL`.
- `SELF_HOSTED_STT_ADAPTER=lipi_ml` and `SELF_HOSTED_STT_BASE_URL=http://lipi-ml:5001`.
- `SELF_HOSTED_TTS_ADAPTER=lipi_ml`, `SELF_HOSTED_TTS_BASE_URL=http://lipi-ml:5001`, and `SELF_HOSTED_TTS_VOICE`.
- Use `SELF_HOSTED_STT_ADAPTER=openai_compatible` or `SELF_HOSTED_TTS_ADAPTER=openai_compatible` only when the speech service exposes `/v1/audio/*` endpoints.

Current hosted state:

- Realtime dispatch reaches this worker.
- The worker posts `worker_started` and `listening` events to LipiVoice.
- Browser participants connect through `wss://ai.silverlining.com.np/voice/livekit`.
- Realtime agent audio is attached by the Calls UI, and final user/assistant transcript events are posted back to LipiVoice when emitted by the worker.
- The worker can call demo business tools for customer lookup, callback scheduling, transfer queueing, and supervisor escalation.

## Business Tools

The Python worker exposes realtime function tools and proxies them to worker-only LipiVoice API routes:

- `lookup_customer` -> `POST /api/worker/calls/:id/tools/customer-lookup`
- `schedule_callback` -> `POST /api/worker/calls/:id/tools/schedule-callback`
- `transfer_call` -> `POST /api/worker/calls/:id/tools/transfer-call`
- `create_escalation` -> `POST /api/worker/calls/:id/tools/create-escalation`

Each route requires `x-lipivoice-worker-key` when `LIPIVOICE_WORKER_API_KEY` is set. The app records every successful tool invocation as a `tool_call` event, so operators can review actions in the Calls page Call log tab.

The current implementation is deterministic demo data. Replace `executeWorkerBusinessTool` in `src/server/app.ts` with adapters for CRM, calendar, SIP transfer, or ticketing systems when those integrations are ready.

## Voice selection behavior

- The worker resolves the active `voiceId` from `GET /api/worker/session-config` and passes the mapped self-hosted voice id to the TTS endpoint.
- Supported default IDs include `voice_lipi_ml_ne`, `voice_piper_ne_sita`, `voice_piper_ne_maya`, `voice_coqui_ne_anju`, `voice_coqui_ne_kiran`, `voice_fastpitch_ne_nabin`, and `voice_fastpitch_ne_bikram`.

If the selected voice is not in this map, the worker falls back to `SELF_HOSTED_TTS_VOICE`.

## Run

```bash
. .venv/bin/activate
python agent.py dev
```

The worker registers as `lipivoice-receptionist` and expects explicit dispatch metadata:

```json
{"callId":"call_id","agentId":"agent_reception"}
```

## Remote Deployment Notes

Remote compose service: `lipiv-livekit-worker`.

Required remote environment:

- `LIVEKIT_URL=ws://lipiv-livekit:7880`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_AGENT_NAME=lipivoice-receptionist`
- `LIPIVOICE_API_BASE_URL=http://lipiv-app:8787`
- `LIPIVOICE_WORKER_API_KEY`
- `LIPIVOICE_LLM_BACKEND=vllm`
- `VLLM_BASE_URL`
- `VLLM_MODEL`
- `SELF_HOSTED_STT_BASE_URL`
- `SELF_HOSTED_TTS_BASE_URL`

## Test

```bash
cd services/livekit-worker
. .venv/bin/activate
pytest -q
```
