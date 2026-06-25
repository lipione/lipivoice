# LipiVoice Platform Prototype Design

Date: 2026-05-29

## Goal

Build LipiVoice as a full-platform voice AI prototype inspired by Vapi's agent orchestration model and Voice.ai's broader voice infrastructure model, but with an open-source/local model runtime as the default architecture. The first real integration is browser voice: a user can start a live mic-based AI conversation from the dashboard using local or self-hosted STT, VAD, LLM, and TTS components. Phone calling and carrier-grade deployment are represented through telephony adapters and honest configuration states until external carrier credentials are available.

## Product Scope

LipiVoice will include these product areas:

- Agents: assistant creation, prompt configuration, local model/voice/transcriber settings, tool assignment, knowledge base attachment, recording settings, and call behavior.
- Web Voice Console: a real browser voice test surface with call status, transcript, audio activity, latency, events, and errors.
- Phone Numbers: create/import placeholders, assign agents, show telephony provider setup state, and simulate phone call records until Twilio or another carrier provider is configured.
- Calls: call history, transcript, timeline events, tool calls, failure reasons, recording placeholders, and cost estimates.
- Tools and Webhooks: define API request tools, configure auth/signing, and inspect request/response event logs.
- Voice Lab: test local TTS, stream generated speech, manage voices, maintain pronunciation dictionaries, and create private cloned voice records with consent metadata.
- Knowledge Base: attach FAQs or documents to agents for retrieval-style answers in a later local embedding/vector-search implementation.
- Evals: define mock conversations and checks, run them against an agent, and show pass/fail results with prompt improvement hints.
- Usage and Limits: display minutes, sessions, active phone numbers, concurrent-call limits, local compute estimates, and carrier/provider cost estimates where applicable.
- Security and Compliance Readiness: manage local model runtime settings, optional provider keys for telephony or cloud fallback experiments, webhook signing settings, recording toggles, cloned-voice consent records, and deployment-readiness indicators without claiming actual compliance certification.
- SDK Playground: generate JavaScript/TypeScript snippets for connecting a browser voice session to a LipiVoice agent.

## Design References

Vapi's quickstart emphasizes agent creation, browser/phone calls, tool calls, squads, events, transcripts, and production observability. Voice.ai adds a stronger voice infrastructure layer: TTS, voice cloning, pronunciation dictionaries, credits/concurrency, SDK connection details, event webhooks, and explicit safety/consent positioning.

The LipiVoice implementation differs intentionally from both products by making open-source and self-hosted model runtimes the default. Closed hosted AI APIs are not the default runtime path. Google Cloud TTS is allowed as an optional server-side fallback experiment for Nepali voice coverage, with explicit provider status and no browser-side credentials.

Public references reviewed:

- https://docs.vapi.ai/quickstart/introduction
- https://docs.vapi.ai/quickstart/web
- https://voice.ai/
- https://voice.ai/ai-voice-agents/
- https://voice.ai/voice-cloning
- https://voice.ai/docs/introduction
- https://voice.ai/docs/guides/voice-agents/web
- https://voice.ai/pricing
- https://voice.ai/ethics
- https://github.com/ollama/ollama
- https://docs.vllm.ai/
- https://github.com/ggml-org/whisper.cpp
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/snakers4/silero-vad
- https://github.com/rhasspy/piper
- https://github.com/hexgrad/kokoro
- https://huggingface.co/hexgrad/Kokoro-82M
- https://docs.coqui.ai/en/stable/models/xtts.html
- https://docs.cloud.google.com/text-to-speech/docs/gemini-tts

## Current Implementation Status - 2026-06-02

The first runnable slice is implemented and deployed on the remote GPU server under the remote preset:

- Local preset: Ollama LLM, whisper.cpp STT, Piper TTS, and energy VAD.
- Remote preset: vLLM and Gemini LLM records, `lipi-ml` faster-whisper and Google STT records, Google TTS and `lipi-ml` Piper TTS records, and energy VAD.
- Persistence: SQLite seeded with agents, voices, runtimes, calls, tools, knowledge base records, eval records, and usage records.
- Voice Lab: generates speech through the configured TTS adapter and exposes a provider benchmark catalog.
- Calls: supports API demo calls, simulated text turns with Nepali assistant text, Google TTS audio for selected Google voices, LiveKit web-call room creation, and runtime stack selection.
- LiveKit: room creation, token issue, worker dispatch, browser WebSocket upgrade, and worker `listening` events are deployed. Full hosted browser microphone conversation is still blocked.
- Remote model catalog: reads `/models/tts/manifest.json` in Docker, mapped from `/data/models/lipivoice/tts/manifest.json` on the host.
- Remote Google secrets: mounted read-only from `/data/secrets/lipivoice/google` into `/run/secrets/lipivoice/google`.

Current Nepali TTS provider readiness:

| Provider | Current status | Next implementation work |
| --- | --- | --- |
| Google Cloud TTS | Configured with `GOOGLE_TTS_LANGUAGE_CODE=ne-NP`, `GOOGLE_TTS_MODEL=gemini-2.5-flash-tts`, and `GOOGLE_TTS_VOICE_NE=Kore`; simulated turns can generate MP3 audio through the selected Google voice. | Keep service-account IAM scoped to Vertex AI and speech/TTS permissions; verify live browser calls publish Google TTS audio back through LiveKit. |
| Indic Parler TTS | `license_required` because gated Hugging Face access or token acceptance is still unresolved. | Add accepted HF token, download model files, then wire an inference adapter. |
| OmniVoice | Catalog health is `healthy`; benchmark returns `provider_adapter_not_connected`. | Implement the OmniVoice inference runner and expose generated audio through the benchmark path. |
| Chatterbox Nepali | `license_required` because the Nepali model is gated. | Accept license terms, download with HF token, then wire cloning-capable inference. |
| Coqui VITS / Piper-VITS | `healthy`; benchmark generates WAV audio through the current `lipi-ml` / Piper path. | Train or package a stable custom Nepali voice when production voice quality is required. |

## Architecture

The prototype will use a React and TypeScript dashboard with shadcn/ui components and Tailwind CSS, plus a small local Node backend for persistence, orchestration, WebSocket sessions, and open-source model runtime integration. The backend will coordinate the voice loop locally instead of delegating the full realtime session to an external AI provider.

Realtime browser voice path:

1. Browser captures microphone audio and streams frames to the backend over WebSocket.
2. Backend applies VAD to detect speech turns.
3. STT converts user speech to text.
4. Agent orchestration builds the prompt with system instructions, conversation history, knowledge context, and tool results.
5. Local/self-hosted LLM generates the assistant response.
6. TTS streams audio chunks back to the browser.
7. The UI receives normalized call, transcript, audio, latency, and tool events.

The newer Calls page live-call path uses LiveKit instead of this raw WebSocket path:

1. Browser requests `/api/livekit/web-call/start`.
2. API creates a `web` call record, LiveKit room, browser token, and explicit worker dispatch.
3. Browser joins LiveKit and publishes microphone audio.
4. The Python worker loads agent config from `/api/worker/session-config`.
5. Worker uses Google STT, Gemini on Vertex AI, Google TTS, Silero VAD, and LiveKit turn handling.
6. Worker posts normalized events back through `/api/worker/calls/:id/events`.
7. The current production gap is reliable final transcript and assistant audio emission for live browser input.

Frontend modules:

- `DashboardShell`: sidebar navigation, workspace header, and runtime/environment status.
- `AssistantBuilder`: agent form for prompts, greeting, language, model, voice, transcriber, recording, interruption, tools, and knowledge base.
- `VoiceConsole`: mic permissions, WebSocket connection, call controls, status transitions, audio levels, transcript, and event timeline.
- `CallsView`: searchable call history, call detail, transcript, events, tool calls, and failure/debug fields.
- `ToolsView`: API tool definitions, auth settings, schema fields, timeout/retry settings, and execution logs.
- `VoiceLab`: TTS playground, voice list, pronunciation dictionaries, clone request flow, and consent records.
- `KnowledgeBaseView`: source records and agent attachments.
- `EvalsView`: eval definitions, run history, pass/fail checks, and prompt recommendations.
- `UsageView`: usage totals, estimated local compute, concurrency, installed model health, and phone number counters.
- `SdkPlayground`: copyable client snippets for starting browser voice sessions.

Backend modules:

- `POST /api/realtime/session`: creates a local call session and short-lived WebSocket token for browser audio streaming.
- `GET/POST /api/agents`: reads and writes agent configs.
- `GET/POST /api/voices`: manages built-in, local runtime, and cloned voice records.
- `POST /api/tts/generate`: generates or streams speech through a configured local/open-source TTS runtime.
- `GET /api/tts/providers`: lists current Nepali TTS provider candidates with configured state, health, access model, language support, capabilities, runtime id, and voice id.
- `POST /api/tts/benchmark`: attempts synthesis through a selected provider and returns generated audio or a structured readiness failure.
- `POST /api/voice-clones`: creates consent-gated voice clone requests and tracks status.
- `GET/POST /api/tools`: manages API tool definitions.
- `POST /api/tools/execute`: executes API request tools with logs and timeout handling.
- `GET/POST /api/calls`: stores call records and events.
- `POST /api/calls/simulate`: creates simulated phone call records while telephony is not configured.
- `GET/POST /api/evals` and `POST /api/evals/run`: manages and runs evals.
- `GET /api/usage`: returns usage totals and estimates.
- `GET /api/model-runtimes`: lists configured STT, VAD, LLM, TTS, and embedding runtimes.
- `POST /api/model-runtimes/health`: checks local runtime availability, model load state, and license metadata.

Model runtime adapters:

- `runtime/llm/ollamaAdapter`: local model chat and tool-calling through Ollama.
- `runtime/llm/vllmAdapter`: self-hosted OpenAI API-compatible inference for larger deployments.
- `runtime/stt/whisperCppAdapter`: local/offline Whisper transcription with CPU, Metal, Core ML, or GPU acceleration depending on host support.
- `runtime/stt/fasterWhisperAdapter`: faster Whisper transcription through CTranslate2 for GPU-backed setups.
- `runtime/stt/lipiMlAdapter`: remote `lipi-ml` faster-whisper STT integration.
- `runtime/vad/sileroAdapter`: local voice activity detection.
- `runtime/tts/piperAdapter`: fast local neural TTS.
- `runtime/tts/lipiMlAdapter`: remote `lipi-ml` Piper TTS integration for English and Nepali voices.
- `runtime/tts/googleCloudTtsAdapter`: optional Google Cloud TTS fallback using service-account credentials, Gemini-TTS `model_name`, Nepali `ne-NP`, and MP3 output.
- `runtime/tts/modelCatalog`: manifest-backed health and license status for downloaded TTS candidates such as Indic Parler, OmniVoice, Chatterbox Nepali, and Coqui/Piper-VITS.
- `runtime/tts/kokoroAdapter`: open-weight local TTS with Apache-licensed weights.
- `runtime/tts/coquiAdapter`: optional local multilingual TTS and voice-cloning experiments, subject to model license review.
- `telephony/twilioAdapter`: future phone provider behind a common interface.
- `telephony/simulatedAdapter`: local call simulation when no phone provider is configured.

Core shared modules:

- `events`: normalized event types for call status, transcripts, tool calls, audio activity, runtime/provider errors, and call summaries.
- `validation`: shared validation for agents, tools, voices, evals, model runtimes, licenses, and external credentials.
- `store`: local JSON or SQLite persistence for prototype data.
- `usage`: minute counting, local compute estimates, optional carrier/provider cost estimates, and concurrency counters.
- `modelRegistry`: installed model inventory, runtime health, manifest-backed model catalog status, license metadata, and default model selection.

## Data Model

Core records:

- `Agent`: id, name, greeting, system prompt, language, model runtime id, model asset id, voice id, transcriber runtime id, interruption settings, recording enabled, tool ids, knowledge base ids, and deployment state.
- `Voice`: id, name, runtime id, type, language, gender/style tags, preview URL, privacy, clone status, consent id, and runtime metadata.
- `PronunciationDictionary`: id, name, language, entries, and attached voice/agent ids.
- `KnowledgeBase`: id, name, source type, upload metadata, indexing status, and attached agent ids.
- `Tool`: id, name, description, method, URL, auth mode, headers, parameters, timeout, retry policy, and response schema.
- `Call`: id, channel, direction, agent id, status, started/ended timestamps, duration, cost estimate, recording URL placeholder, failure reason, runtime metadata, and telephony provider metadata when applicable.
- `CallEvent`: id, call id, timestamp, type, actor, payload, and severity.
- `TranscriptSegment`: id, call id, timestamp, role, text, confidence, and final/interim state.
- `Eval`: id, name, agent id, scenario messages, checks, last run result, and history.
- `UsageRecord`: id, timestamp, category, runtime or provider, quantity, unit, estimated cost, and related call/eval id.
- `ExternalCredential`: id, provider, label, configured state, scopes, masked key, and last validation result.
- `ConsentRecord`: id, voice id, speaker name, consent source, captured timestamp, terms version, and audit notes.
- `ModelRuntime`: id, kind, adapter, endpoint, configured state, health status, default model id, concurrency limit, and hardware hints.
- `ModelAsset`: id, runtime id, name, kind, family, version, path or remote tag, license, parameter size, quantization, language support, and installed state.
- `RuntimeHealth`: runtime id, status, checked timestamp, latency, loaded models, hardware acceleration, and error reason.
- `TtsProvider`: id, name, role, access model, adapter, source URL, license, language support, capabilities, hardware hints, configured state, health status, runtime id, and voice id.
- `TtsBenchmarkResult`: provider id/name, text, generated/unavailable status, health status, code, optional base64 audio, MIME type, latency, and timestamp.

## Core Workflows

Create an agent:

1. User opens Agents and creates a new agent.
2. UI validates required name, greeting, and prompt fields.
3. User chooses model, voice, language, transcriber, recording, interruption behavior, tools, and knowledge base attachments.
4. Backend stores the config and returns deployment/configuration state.

Test browser voice:

1. User clicks Start Call in the Web Voice Console.
2. UI requests microphone permission and shows `requesting_mic`.
3. Backend creates a local realtime session and checks VAD, STT, LLM, and TTS runtime health.
4. Browser connects to the session WebSocket and streams mic audio.
5. Backend detects turns, transcribes speech, runs agent orchestration against the local LLM, streams TTS audio, and emits normalized events.
6. UI renders status, audio, transcript, latency, model-runtime, and tool-call events.
7. Call summary and events are persisted when the session ends or fails.

Generate speech:

1. User enters text in Voice Lab.
2. User selects voice, language, and pronunciation dictionary.
3. Backend generates or streams speech through the configured local TTS runtime.
4. UI plays the result and stores a voice sample record.

Benchmark Nepali TTS providers:

1. User opens the Voice Lab provider catalog.
2. UI fetches `/api/tts/providers` and shows current health, access requirements, and capabilities for each provider.
3. User chooses a provider and benchmark text.
4. Backend checks provider health and adapter availability before synthesis.
5. UI plays generated audio when available or shows a structured reason such as `license_required`, `provider_not_installed`, `provider_adapter_not_connected`, or `provider_unavailable`.

Clone a voice:

1. User uploads or records a sample.
2. UI requires consent metadata before submission.
3. Backend creates a private cloned voice record with `pending` or `processing` status.
4. If a local cloning-capable runtime is configured and its license permits the intended use, the adapter submits the clone job; otherwise the UI shows `runtime_not_configured`.

Configure tools:

1. User defines API request fields and auth/signing.
2. Validation checks URL, method, parameters, timeout, and schema.
3. Tool calls during conversations write request/response events.
4. Timeouts and failures are visible in call detail.

Review calls:

1. User opens Calls and filters by status, channel, direction, or agent.
2. User opens a call detail page.
3. UI shows transcript, timeline, tool calls, duration, cost estimate, and runtime/provider failure/debug fields.

Run evals:

1. User creates a scenario and expected checks.
2. Backend runs the scenario against the selected agent logic.
3. UI shows pass/fail checks, failed transcript excerpts, and prompt improvement hints.

## UI Direction

The interface should feel like a serious operational tool rather than a marketing page. Use a dense dashboard layout with a persistent sidebar, restrained color, small clear headings, readable data tables, accessible shadcn/ui primitives, and no nested card-heavy page sections. Key controls should use icons from `lucide-react` where icons are expected, and text labels where commands need clarity.

Primary navigation:

- Overview
- Agents
- Web Voice
- Phone Numbers
- Calls
- Tools
- Voice Lab
- Knowledge Base
- Evals
- Usage
- Settings

## Error Handling

Browser voice states:

- `idle`
- `requesting_mic`
- `connecting`
- `connected`
- `listening`
- `thinking`
- `speaking`
- `disconnected`
- `failed`

Provider and runtime errors must be normalized:

- `invalid_api_key`
- `quota_exceeded`
- `agent_not_deployed`
- `mic_permission_denied`
- `max_concurrent_calls_exceeded`
- `network_failure`
- `provider_not_configured`
- `runtime_not_configured`
- `runtime_unavailable`
- `model_not_installed`
- `model_license_unaccepted`
- `model_load_failed`
- `insufficient_vram_or_memory`
- `tool_timeout`
- `tool_auth_failed`
- `voice_consent_missing`

All failures should write call or system events with structured reasons. User-facing messages should be clear about what is actionable, such as starting Ollama, installing a model, accepting a model license, granting mic permission, reducing concurrency, or configuring telephony.

## Safety and Security

- The default AI path uses local/open-source runtimes and does not require closed AI API keys.
- Optional API keys or service-account files for telephony, Google Cloud TTS, or future external providers stay server-side. Browser clients only receive short-lived LipiVoice session credentials.
- Google service-account JSON files are mounted read-only in deployment and must never be committed to Git.
- Google Nepali TTS must use `ne` or `ne-NP`; `np` is not a Nepali language code. The backend normalizes `ne` to `ne-NP`.
- Model assets store visible license metadata, and the UI must not hide license constraints.
- Hugging Face gated model access must be represented as `license_required` until terms are accepted and tokens are configured.
- Voice cloning requires consent metadata before a clone record can be created.
- Cloned voices default to private.
- Recording is controlled per agent and visible before calls.
- Webhooks support HMAC signing fields and signature verification status.
- Tool logs redact configured secret headers.
- Compliance screens show configuration/readiness state only; they do not claim HIPAA, SOC 2, GDPR, or other certification.
- Phone calling is labeled not configured until a real telephony provider is connected.

## Testing and Verification

Automated tests:

- Validate agent, voice, tool, eval, runtime, and external credential schemas.
- Validate prompt interpolation and default config behavior.
- Validate browser voice status transitions.
- Validate runtime/provider error mapping.
- Validate model runtime health mapping and model license gates.
- Validate tool timeout/auth failure handling.
- Validate usage and cost calculations.
- Validate eval scoring.

UI/component tests:

- Agent form required states and save behavior.
- Voice Console state rendering for idle, connecting, connected, speaking, failed, and disconnected.
- Tool form validation and log rendering.
- Voice clone consent gating.
- Calls detail timeline rendering.

Manual/browser smoke checks:

- Dashboard renders at desktop and mobile widths.
- Navigation works without layout overlap.
- Web Voice Console requests mic permission and handles denial cleanly.
- Simulated call can create a call record and timeline.
- Runtime-not-configured states are visible for local model paths.
- Provider-not-configured states are visible for phone paths.

Completion checks:

- `npm run build`
- `npm run lint`
- focused automated tests once a test runner is added
- browser smoke test for the local app

## Out of Scope for First Implementation

- Production carrier telephony.
- Actual number purchasing or porting.
- Certified compliance workflows.
- Billing/checkout.
- Multi-tenant auth and RBAC.
- Production-grade RAG indexing.
- Public voice marketplace.
- Closed hosted AI model APIs as the default runtime path. Optional cloud fallback adapters may exist, but they must be explicit, server-side, and non-default.
- Real voice clone generation unless a local/open-source cloning runtime is installed and its license permits the intended use.

## Open Implementation Decisions

- Choose local persistence: JSON file for speed or SQLite for migration realism.
- Choose test runner: Vitest is the likely fit for Vite/React.
- Choose backend runtime: Express is simple; Fastify is stricter and faster.
- Choose exact default local model presets for LLM, STT, VAD, TTS, and embeddings beyond the current Ollama, whisper.cpp, Piper, and energy VAD defaults.
- Choose runtime bootstrap strategy for local contributors: user-installed local services, Docker Compose, or managed local scripts.
- Choose whether the first implementation depends on Ollama being installed or includes a no-model simulator fallback for UI-only testing.
- Choose final Nepali voice quality path after benchmarking Indic Parler, OmniVoice, Chatterbox Nepali, Google Cloud TTS, and custom Coqui/Piper-VITS training.

Default recommendation: use SQLite, Vitest, Express, Ollama for the first LLM adapter, whisper.cpp or faster-whisper for STT, Silero VAD for turn detection, Piper or Kokoro for the first TTS adapter, and simulated telephony behind explicit provider-not-configured states.
