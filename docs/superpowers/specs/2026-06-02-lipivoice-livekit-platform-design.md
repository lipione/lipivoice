# LipiVoice LiveKit Platform Design

## Objective

Build LipiVoice into a Dograh/Vapi-style voice agent platform for Nepali-first insurance reception calls, using LiveKit Agents as the realtime voice runtime and the existing LipiVoice TypeScript app as the product control plane.

The first shippable milestone is:

> A user can open LipiVoice, start a simulated web call, speak Nepali to the Lipi Insurance receptionist, hear a Google Nepali voice response, interrupt naturally, and see transcript, status, runtime, and tool events saved in Calls.

## Source Projects Studied

Dograh is the reference for product shape:

- Agent/workflow control plane
- Calls dashboard and transcript UI
- Phone numbers and telephony configuration
- Tooling, knowledge, campaigns, SDK/API surface
- Publish/version lifecycle

LiveKit Agents is the reference for realtime runtime:

- WebRTC room media
- Python `AgentServer` workers
- `AgentSession` for STT, VAD, LLM, TTS, interruptions, turn detection, events, and metrics
- SIP telephony, DTMF, answering machine detection, and warm transfer
- Provider plugin model for Google, OpenAI-compatible LLMs, Deepgram, Sarvam, Silero, turn detection, and other runtimes
- Conversation test/eval patterns

## Architecture

LipiVoice will use a split architecture.

The TypeScript app remains the source of truth for configuration and product UI. It owns agents, voices, model runtimes, calls, call events, tools, knowledge bases, eval definitions, and user-facing pages.

LiveKit provides the realtime media layer. Browser calls and phone calls join LiveKit rooms instead of streaming raw audio chunks to `/api/realtime`.

A new Python worker service runs LiveKit Agents. It loads selected agent configuration from the LipiVoice API, creates an `AgentSession`, connects STT/LLM/TTS providers, handles turn taking and interruptions, executes or proxies tools, and emits normalized events back to LipiVoice.

Remote model resources remain first-class:

- LLM: remote vLLM or other OpenAI-compatible endpoint
- STT: Lipi ML/faster-whisper, Google STT, or Sarvam where configured
- TTS: Google TTS/Gemini TTS for Nepali voice first, with Lipi ML/Piper fallback
- VAD/turn detection: Silero plus LiveKit multilingual turn detector

## Core Components

### LipiVoice API

Responsibilities:

- Issue LiveKit browser tokens
- Create simulated call sessions
- Dispatch or configure LiveKit worker jobs
- Persist call lifecycle records
- Persist normalized call events
- Expose agent, tool, runtime, and voice config to the Python worker
- Provide runtime health diagnostics

### LiveKit Worker

Responsibilities:

- Run `AgentServer`
- Join LiveKit rooms
- Start `AgentSession`
- Build an insurance receptionist `Agent`
- Configure STT, LLM, TTS, VAD, turn detection, and interruption behavior
- Send status, transcript, tool, audio metadata, latency, and failure events to LipiVoice
- Support manual web calls first, then SIP calls

### Calls UI

Responsibilities:

- Provide Vapi-like call configuration and transcript layout
- Start/end simulated web calls
- Show active call state
- Show transcript and debug events
- Show runtime/provider cards for STT, LLM, TTS, voice, latency, and estimated cost
- Keep existing Call/CallEvent data visible after sessions end

### Insurance Receptionist Agent

Responsibilities:

- Speak Nepali by default using Devanagari
- Switch to English when the caller clearly uses English
- Handle quote, policy, claim, billing, document, hours, and callback intents
- Ask one question at a time
- Collect name, phone number, insurance type, and policy or claim number when relevant
- Avoid inventing premiums, claim approvals, policy coverage, or legal/regulated decisions
- Arrange licensed-agent or claims-handler follow-up when needed
- Confirm next step before ending

### Workflow And Tools

Initial scope keeps workflows simple and tool-backed. The first build should improve tool schemas, execution events, and receptionist tools before adding a visual graph editor.

Later workflow scope:

- Start node
- Prompt node
- Tool node
- Condition node
- Handoff node
- End-call node
- Draft/published/archive versions
- Workflow run and run-step records

## Data Flow

### Simulated Web Call

1. Browser asks LipiVoice API to start a simulated call for an agent.
2. API creates a `Call` record with channel `web` and status `connected`.
3. API creates or selects a LiveKit room.
4. API returns a LiveKit token and call id.
5. Browser joins the room and publishes microphone audio.
6. Python worker joins the room as the agent participant.
7. Worker starts `AgentSession`.
8. Worker sends call events to LipiVoice API.
9. Browser renders transcript/status from persisted events or realtime event stream.
10. Ending the call updates `Call.endedAt`, duration, status, and failure reason if any.

### Phone Call

1. SIP inbound call enters a LiveKit room.
2. LiveKit dispatches the named worker.
3. Worker loads the assigned LipiVoice agent based on phone number or dispatch metadata.
4. Conversation events are persisted the same way as simulated web calls.
5. Transfers, DTMF, voicemail, and hangup events become normalized `CallEvent` records.

## Error Handling

Runtime failures must be visible and recoverable.

- Missing LiveKit config returns a clear `livekit_not_configured` error.
- Missing model config returns the existing `runtime_not_configured` style error with provider details.
- STT, LLM, and TTS failures become separate runtime events with provider id, model id, and latency if available.
- Worker disconnect marks the call `failed` or `disconnected` depending on whether a failure was reported.
- Tool execution failures are recorded as tool events and returned to the agent as safe tool errors.
- The UI must never show only `processing_failed` without the underlying stage when stage information is available.

## Testing Strategy

Use layered tests.

- Unit tests for config mapping, token creation, event normalization, and API persistence
- React tests for Calls UI start/end, transcript rendering, runtime cards, and failure states
- Worker tests for prompt construction, provider selection, and event emission
- Eval-style tests for receptionist behavior:
  - Nepali greeting
  - quote intake
  - claim intake without approval hallucination
  - callback collection
  - licensed-agent escalation
  - final next-step confirmation

End-to-end verification requires:

- Local app opens in browser
- Simulated call starts
- Microphone permissions work
- Agent speaks back
- Transcript appears
- Call events persist

## Phased Delivery

### Phase 1: Stabilize Existing WebVoice And Calls

- Diagnose current `processing_failed`
- Add stage-specific runtime errors
- Finish Calls UI
- Ensure simulated calls persist events
- Add runtime diagnostics for remote vLLM, Lipi ML, and Google TTS

### Phase 2: Insurance Receptionist

- Harden Nepali-first receptionist prompt
- Add receptionist tools
- Add eval cases
- Confirm Google Nepali TTS path

### Phase 3: LiveKit Web Call Runtime

- Add LiveKit config
- Add token/session API
- Add Python worker service
- Connect browser to LiveKit room
- Persist worker events
- Replace raw web socket path for the primary simulated call flow

### Phase 4: Automated Simulation

- Add scripted caller simulation
- Store simulated transcript and eval results
- Support Nepali and English test scripts

### Phase 5: Telephony

- Add LiveKit SIP configuration
- Map phone numbers to agents
- Support inbound calls
- Add outbound calls
- Add DTMF, AMD, and warm transfer

### Phase 6: Workflow Layer

- Add workflow definitions and versions
- Add workflow run records
- Add tool, condition, handoff, and end-call steps
- Add visual editor after runtime is stable

### Phase 7: Knowledge Base

- Add ingestion and embeddings
- Add knowledge search tool
- Add grounded answer behavior
- Persist knowledge references in events

### Phase 8: Production Hardening

- Add auth/workspaces
- Add secrets management
- Add audit logs
- Add recording retention and PII redaction
- Add rate limits
- Add worker health and deployment docs

## Initial Non-Goals

- No full workflow visual editor before LiveKit web calls work.
- No campaigns before one-call simulation and telephony are stable.
- No fine-tuning before evals prove prompt/tool gaps.
- No multi-tenant billing until the single-workspace runtime path is reliable.
- No custom telephony media server; use LiveKit SIP.

## Acceptance Criteria For First Milestone

- The app can start a simulated web call for `agent_reception`.
- The browser and worker communicate through LiveKit.
- The caller can speak Nepali and receive a spoken Nepali response.
- Google TTS is used when configured for the selected voice.
- The agent can be interrupted naturally.
- Transcript entries persist to `CallEvent`.
- Status changes persist to `CallEvent`.
- Runtime/provider metadata is visible in the Calls UI.
- Failures identify the failing stage: LiveKit, STT, LLM, TTS, tool, or persistence.
