# LipiVoice LiveKit Web Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable milestone: a LiveKit-backed simulated web call with a Nepali-first Lipi Insurance receptionist, Google Nepali voice output, interruptible WebRTC audio, and persisted call events.

**Architecture:** Keep the TypeScript app as the control plane and persistence layer. Add LiveKit token/session APIs, a browser LiveKit client wrapper, and a Python LiveKit Agents worker that loads LipiVoice agent config and posts normalized events back to the TypeScript API.

**Tech Stack:** Vite, React, Express, SQLite, Vitest, LiveKit JS server SDK, LiveKit JS client SDK, Python 3.11+, `livekit-agents`, `livekit-plugins-openai`, `livekit-plugins-google`, `livekit-plugins-silero`, `livekit-plugins-turn-detector`.

---

## Scope Check

The approved design covers multiple independent subsystems. This plan covers only the first executable milestone: LiveKit-backed simulated web calls. Separate plans should handle SIP telephony, workflow graph/versioning, knowledge indexing, campaigns, auth, and production hardening.

## External References

- LiveKit JS server SDK v2 uses async `AccessToken.toJwt()` and `RoomServiceClient` for room management: https://docs.livekit.io/reference/server-sdk-js/
- LiveKit browser clients connect with `new Room()` and `room.connect(wsUrl, token)`: https://docs.livekit.io/intro/basics/connect/
- LiveKit explicit agent dispatch uses `AgentDispatchClient.createDispatch(roomName, agentName, { metadata })`: https://docs.livekit.io/agents/build/dispatch/
- LiveKit Agents Python examples for `AgentServer`, `AgentSession`, front desk behavior, and warm transfer are in `/tmp/livekit-agents/examples`.

## File Structure

Create:

- `src/server/livekit/service.ts` - LiveKit room, token, dispatch, and configuration helpers.
- `src/server/livekit/service.test.ts` - unit tests for LiveKit helper behavior with fake SDK clients.
- `src/client/livekitCall.ts` - browser LiveKit room connection wrapper with microphone publish and cleanup.
- `src/client/livekitCall.test.ts` - reducer/wrapper tests using fake room objects.
- `services/livekit-worker/requirements.txt` - Python worker dependencies.
- `services/livekit-worker/.env.example` - worker environment reference.
- `services/livekit-worker/lipivoice_client.py` - worker HTTP client for LipiVoice config and event ingestion.
- `services/livekit-worker/agent.py` - LiveKit Agents worker entrypoint.
- `services/livekit-worker/test_lipivoice_client.py` - Python unit tests for event payload mapping.
- `services/livekit-worker/README.md` - run instructions for the worker.

Modify:

- `package.json` and `package-lock.json` - add LiveKit JS dependencies.
- `src/server/config.ts` and `src/server/config.test.ts` - add LiveKit and worker API key config.
- `src/server/app.ts` and `src/server/app.test.ts` - add LiveKit session APIs, worker config endpoint, and event ingestion endpoint.
- `src/domain/defaults.ts` and `src/domain/defaults.test.ts` - harden receptionist defaults and seed receptionist tools/evals.
- `src/features/calls/CallsPage.tsx` and `src/features/calls/CallsPage.test.tsx` - connect the Calls UI to LiveKit sessions and show LiveKit/runtime state.
- `README.md` - add local run instructions for TS app, LiveKit, and worker.

---

### Task 1: Add LiveKit Packages And Server Config

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/server/config.ts`
- Modify: `src/server/config.test.ts`

- [ ] **Step 1: Install JS SDK dependencies**

Run:

```bash
npm install livekit-server-sdk livekit-client --save
```

Expected: `package.json` includes `livekit-client` and `livekit-server-sdk`.

- [ ] **Step 2: Write failing config tests**

Add tests to `src/server/config.test.ts`:

```ts
it("loads LiveKit configuration from environment", () => {
  const config = loadServerConfig({
    LIVEKIT_URL: "wss://voice.example.com",
    LIVEKIT_API_KEY: "devkey",
    LIVEKIT_API_SECRET: "devsecret",
    LIVEKIT_AGENT_NAME: "lipivoice-receptionist",
    LIPIVOICE_WORKER_API_KEY: "worker-secret",
  });

  expect(config.livekitWsUrl).toBe("wss://voice.example.com");
  expect(config.livekitApiUrl).toBe("https://voice.example.com");
  expect(config.livekitApiKey).toBe("devkey");
  expect(config.livekitApiSecret).toBe("devsecret");
  expect(config.livekitAgentName).toBe("lipivoice-receptionist");
  expect(config.workerApiKey).toBe("worker-secret");
});

it("derives a local LiveKit HTTP API URL from a ws URL", () => {
  const config = loadServerConfig({
    LIVEKIT_URL: "ws://127.0.0.1:7880",
  });

  expect(config.livekitWsUrl).toBe("ws://127.0.0.1:7880");
  expect(config.livekitApiUrl).toBe("http://127.0.0.1:7880");
});
```

- [ ] **Step 3: Run config tests and verify failure**

Run:

```bash
npm run test -- src/server/config.test.ts
```

Expected: FAIL because `ServerConfig` does not include LiveKit fields.

- [ ] **Step 4: Add config fields**

Update `ServerConfig` in `src/server/config.ts`:

```ts
export interface ServerConfig {
  port: number;
  databasePath: string;
  runtimePreset: "local" | "remote";
  ollamaBaseUrl: string;
  ollamaModel: string;
  vllmBaseUrl: string;
  vllmModel: string;
  lipiMlBaseUrl: string;
  ttsModelManifestPath: string;
  googleTtsCredentialsPath: string;
  googleTtsLanguageCode: string;
  googleTtsModel: string;
  googleTtsVoiceName: string;
  whisperCppBin: string;
  whisperModelPath: string;
  piperBin: string;
  piperVoicePath: string;
  livekitWsUrl: string;
  livekitApiUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitAgentName: string;
  workerApiKey: string;
}
```

Add fields in `loadServerConfig`:

```ts
const livekitWsUrl = trimTrailingSlash(env.LIVEKIT_URL ?? "");

return {
  port: parsePort(env.PORT),
  databasePath: env.LIPIVOICE_DB_PATH ?? "data/lipivoice.sqlite",
  runtimePreset: parseRuntimePreset(env.LIPIVOICE_RUNTIME_PRESET),
  ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaModel: env.LIPIVOICE_LLM_MODEL ?? "llama3.2:3b",
  vllmBaseUrl: env.VLLM_BASE_URL ?? "",
  vllmModel: env.VLLM_MODEL ?? env.LIPIVOICE_LLM_MODEL ?? "gemma-4",
  lipiMlBaseUrl: env.LIPI_ML_BASE_URL ?? "",
  ttsModelManifestPath: env.LIPIVOICE_TTS_MODEL_MANIFEST ?? "",
  googleTtsCredentialsPath: env.GOOGLE_TTS_CREDENTIALS_PATH ?? env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  googleTtsLanguageCode: normalizeGoogleLanguageCode(env.GOOGLE_TTS_LANGUAGE_CODE ?? "ne-NP"),
  googleTtsModel: env.GOOGLE_TTS_MODEL ?? "",
  googleTtsVoiceName: resolveGoogleTtsVoiceName(env),
  whisperCppBin: env.WHISPER_CPP_BIN ?? "",
  whisperModelPath: env.WHISPER_MODEL_PATH ?? "",
  piperBin: env.PIPER_BIN ?? "",
  piperVoicePath: env.PIPER_VOICE_PATH ?? "",
  livekitWsUrl,
  livekitApiUrl: trimTrailingSlash(env.LIVEKIT_API_URL ?? deriveLiveKitApiUrl(livekitWsUrl)),
  livekitApiKey: env.LIVEKIT_API_KEY ?? "",
  livekitApiSecret: env.LIVEKIT_API_SECRET ?? "",
  livekitAgentName: env.LIVEKIT_AGENT_NAME ?? "lipivoice-receptionist",
  workerApiKey: env.LIPIVOICE_WORKER_API_KEY ?? "",
};
```

Add helpers:

```ts
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveLiveKitApiUrl(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) {
    return `https://${wsUrl.slice("wss://".length)}`;
  }

  if (wsUrl.startsWith("ws://")) {
    return `http://${wsUrl.slice("ws://".length)}`;
  }

  return "";
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- src/server/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server/config.ts src/server/config.test.ts
git commit -m "feat: add livekit server configuration"
```

---

### Task 2: Add LiveKit Server Service

**Files:**
- Create: `src/server/livekit/service.ts`
- Create: `src/server/livekit/service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `src/server/livekit/service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createLiveKitService, isLiveKitConfigured } from "./service";

const configured = {
  livekitWsUrl: "ws://127.0.0.1:7880",
  livekitApiUrl: "http://127.0.0.1:7880",
  livekitApiKey: "key",
  livekitApiSecret: "secret",
  livekitAgentName: "lipivoice-receptionist",
};

describe("isLiveKitConfigured", () => {
  it("requires URL, API key, API secret, and agent name", () => {
    expect(isLiveKitConfigured(configured)).toBe(true);
    expect(isLiveKitConfigured({ ...configured, livekitApiKey: "" })).toBe(false);
  });
});

describe("createLiveKitService", () => {
  it("creates a room, dispatches an agent, and returns a browser token", async () => {
    const createRoom = vi.fn().mockResolvedValue({ name: "room" });
    const createDispatch = vi.fn().mockResolvedValue({ id: "dispatch_1" });
    const createToken = vi.fn().mockResolvedValue("jwt-token");
    const service = createLiveKitService(configured, {
      roomClient: { createRoom },
      dispatchClient: { createDispatch },
      createToken,
    });

    const result = await service.startWebCall({
      callId: "call_1",
      agentId: "agent_reception",
      participantIdentity: "caller_call_1",
    });

    expect(createRoom).toHaveBeenCalledWith({
      name: "lipivoice-call-call_1",
      emptyTimeout: 300,
      maxParticipants: 4,
    });
    expect(createDispatch).toHaveBeenCalledWith(
      "lipivoice-call-call_1",
      "lipivoice-receptionist",
      {
        metadata: JSON.stringify({ callId: "call_1", agentId: "agent_reception" }),
      },
    );
    expect(createToken).toHaveBeenCalledWith({
      roomName: "lipivoice-call-call_1",
      participantIdentity: "caller_call_1",
    });
    expect(result).toEqual({
      wsUrl: "ws://127.0.0.1:7880",
      roomName: "lipivoice-call-call_1",
      participantIdentity: "caller_call_1",
      token: "jwt-token",
      dispatchId: "dispatch_1",
    });
  });
});
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
npm run test -- src/server/livekit/service.test.ts
```

Expected: FAIL because `src/server/livekit/service.ts` does not exist.

- [ ] **Step 3: Implement service**

Create `src/server/livekit/service.ts`:

```ts
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

export interface LiveKitServiceConfig {
  livekitWsUrl: string;
  livekitApiUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitAgentName: string;
}

export interface LiveKitWebCall {
  wsUrl: string;
  roomName: string;
  participantIdentity: string;
  token: string;
  dispatchId: string | null;
}

interface RoomClient {
  createRoom(options: { name: string; emptyTimeout: number; maxParticipants: number }): Promise<unknown>;
}

interface DispatchClient {
  createDispatch(
    roomName: string,
    agentName: string,
    options: { metadata: string },
  ): Promise<{ id?: string }>;
}

interface TokenInput {
  roomName: string;
  participantIdentity: string;
}

interface LiveKitServiceDeps {
  roomClient?: RoomClient;
  dispatchClient?: DispatchClient;
  createToken?: (input: TokenInput) => Promise<string>;
}

export function isLiveKitConfigured(config: LiveKitServiceConfig): boolean {
  return Boolean(
    config.livekitWsUrl &&
      config.livekitApiUrl &&
      config.livekitApiKey &&
      config.livekitApiSecret &&
      config.livekitAgentName,
  );
}

export function createLiveKitService(config: LiveKitServiceConfig, deps: LiveKitServiceDeps = {}) {
  const roomClient = deps.roomClient ?? new RoomServiceClient(
    config.livekitApiUrl,
    config.livekitApiKey,
    config.livekitApiSecret,
  );
  const dispatchClient = deps.dispatchClient ?? new AgentDispatchClient(
    config.livekitApiUrl,
    config.livekitApiKey,
    config.livekitApiSecret,
  );
  const createToken = deps.createToken ?? ((input: TokenInput) => createParticipantToken(config, input));

  return {
    async startWebCall(input: { callId: string; agentId: string; participantIdentity: string }): Promise<LiveKitWebCall> {
      if (!isLiveKitConfigured(config)) {
        throw new Error("livekit_not_configured");
      }

      const roomName = `lipivoice-call-${input.callId}`;
      await roomClient.createRoom({
        name: roomName,
        emptyTimeout: 300,
        maxParticipants: 4,
      });

      const dispatch = await dispatchClient.createDispatch(roomName, config.livekitAgentName, {
        metadata: JSON.stringify({ callId: input.callId, agentId: input.agentId }),
      });

      return {
        wsUrl: config.livekitWsUrl,
        roomName,
        participantIdentity: input.participantIdentity,
        token: await createToken({ roomName, participantIdentity: input.participantIdentity }),
        dispatchId: dispatch.id ?? null,
      };
    },
  };
}

async function createParticipantToken(config: LiveKitServiceConfig, input: TokenInput): Promise<string> {
  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: input.participantIdentity,
    ttl: 60 * 30,
  });

  token.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return token.toJwt();
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm run test -- src/server/livekit/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/livekit/service.ts src/server/livekit/service.test.ts
git commit -m "feat: add livekit web call service"
```

---

### Task 3: Add LiveKit Session And Worker Event APIs

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests to `src/server/app.test.ts`:

```ts
it("starts a LiveKit web call and returns connection data", async () => {
  const liveKit = {
    startWebCall: vi.fn().mockResolvedValue({
      wsUrl: "ws://127.0.0.1:7880",
      roomName: "lipivoice-call-call_123",
      participantIdentity: "caller_call_123",
      token: "jwt-token",
      dispatchId: "dispatch_1",
    }),
  };
  const { app } = createAppContextForTest(createRemoteWorkspace({
    now: "2026-06-02T00:00:00.000Z",
    vllmEndpoint: "http://vllm.test/v1",
    vllmModel: "gemma-4",
    lipiMlEndpoint: "http://lipi.test",
  }), { liveKit });

  const response = await request(app)
    .post("/api/livekit/web-call/start")
    .send({ agentId: "agent_reception" })
    .expect(201);

  expect(response.body.call.channel).toBe("web");
  expect(response.body.events[0].type).toBe("status");
  expect(response.body.livekit.token).toBe("jwt-token");
  expect(liveKit.startWebCall).toHaveBeenCalledWith({
    callId: response.body.call.id,
    agentId: "agent_reception",
    participantIdentity: `caller_${response.body.call.id}`,
  });
});

it("persists worker events with a worker API key", async () => {
  const { app, repositories } = createAppContextForTest(createRemoteWorkspace({
    now: "2026-06-02T00:00:00.000Z",
    vllmEndpoint: "http://vllm.test/v1",
    vllmModel: "gemma-4",
    lipiMlEndpoint: "http://lipi.test",
  }), { workerApiKey: "worker-secret" });
  const call = repositories.calls.create({
    channel: "web",
    direction: "inbound",
    agentId: "agent_reception",
    status: "connected",
    startedAt: "2026-06-02T00:00:00.000Z",
  });

  await request(app)
    .post(`/api/worker/calls/${call.id}/events`)
    .set("x-lipivoice-worker-key", "worker-secret")
    .send({
      events: [
        {
          type: "transcript",
          actor: "assistant",
          payload: { text: "नमस्ते" },
          severity: "info",
        },
      ],
    })
    .expect(201);

  expect(repositories.callEvents.listForCall(call.id)).toMatchObject([
    {
      type: "transcript",
      actor: "assistant",
      payload: { text: "नमस्ते" },
    },
  ]);
});
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
npm run test -- src/server/app.test.ts
```

Expected: FAIL because `AppDeps` has no `liveKit` or `workerApiKey`, and the endpoints do not exist.

- [ ] **Step 3: Extend `AppDeps`**

In `src/server/app.ts`, add imports:

```ts
import { createLiveKitService, type LiveKitWebCall } from "./livekit/service";
```

Add to `AppDeps`:

```ts
liveKit?: {
  startWebCall(input: {
    callId: string;
    agentId: string;
    participantIdentity: string;
  }): Promise<LiveKitWebCall>;
} | null;
workerApiKey?: string;
```

In `createApp(config)`, pass:

```ts
liveKit: createLiveKitService(config),
workerApiKey: config.workerApiKey,
```

- [ ] **Step 4: Add LiveKit start endpoint**

Add before `/api/health`:

```ts
app.post("/api/livekit/web-call/start", async (request, response, next) => {
  try {
    const agentId = typeof request.body?.agentId === "string" ? request.body.agentId : "";
    const agent = repositories.agents.get(agentId);

    if (!agent) {
      response.status(404).json({ code: "agent_not_found" });
      return;
    }

    if (!deps.liveKit) {
      response.status(409).json({ code: "livekit_not_configured" });
      return;
    }

    const now = currentTimestamp(deps.now);
    const call = repositories.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: agent.id,
      status: "connected",
      startedAt: now,
    });
    const participantIdentity = `caller_${call.id}`;
    const livekit = await deps.liveKit.startWebCall({
      callId: call.id,
      agentId: agent.id,
      participantIdentity,
    });
    const event = repositories.callEvents.append({
      callId: call.id,
      timestamp: now,
      type: "status",
      actor: "system",
      payload: {
        status: "connected",
        transport: "livekit",
        roomName: livekit.roomName,
        participantIdentity,
        dispatchId: livekit.dispatchId,
      },
      severity: "info",
    });

    response.status(201).json({ call, events: [event], livekit });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: Add worker session config endpoint**

Add:

```ts
app.get("/api/worker/session-config", (request, response) => {
  if (!verifyWorkerRequest(request, deps.workerApiKey)) {
    response.status(401).json({ code: "worker_unauthorized" });
    return;
  }

  const callId = typeof request.query.callId === "string" ? request.query.callId : "";
  const call = repositories.calls.get(callId);

  if (!call) {
    response.status(404).json({ code: "call_not_found" });
    return;
  }

  const agent = repositories.agents.get(call.agentId);
  if (!agent) {
    response.status(404).json({ code: "agent_not_found" });
    return;
  }

  const voice = repositories.voices.get(agent.voiceId);
  const runtimes = repositories.runtimes.list();
  const tools = repositories.tools.list().filter((tool) => agent.toolIds.includes(tool.id));

  response.json({
    call,
    agent,
    voice,
    runtimes,
    tools,
    settings: repositories.settings.get(),
  });
});
```

- [ ] **Step 6: Add worker event ingestion endpoint**

Add:

```ts
app.post("/api/worker/calls/:id/events", (request, response) => {
  if (!verifyWorkerRequest(request, deps.workerApiKey)) {
    response.status(401).json({ code: "worker_unauthorized" });
    return;
  }

  const call = repositories.calls.get(request.params.id);
  if (!call) {
    response.status(404).json({ code: "call_not_found" });
    return;
  }

  const rawEvents = Array.isArray(request.body?.events) ? request.body.events : [];
  const now = currentTimestamp(deps.now);
  const events = repositories.transaction(() =>
    rawEvents.map((event) =>
      repositories.callEvents.append({
        callId: call.id,
        timestamp: typeof event.timestamp === "string" ? event.timestamp : now,
        type: callEventType(event.type) ?? "runtime",
        actor: callEventActor(event.actor) ?? "system",
        payload: isRecord(event.payload) ? event.payload : {},
        severity: callEventSeverity(event.severity) ?? "info",
      }),
    ),
  );

  response.status(201).json({ events });
});
```

Add helper functions near existing helper functions:

```ts
function verifyWorkerRequest(request: express.Request, workerApiKey: string | undefined): boolean {
  if (!workerApiKey) {
    return true;
  }

  return request.header("x-lipivoice-worker-key") === workerApiKey;
}

function callEventActor(value: unknown): CallEvent["actor"] | null {
  return value === "system" || value === "user" || value === "assistant" || value === "tool" ? value : null;
}

function callEventSeverity(value: unknown): CallEvent["severity"] | null {
  return value === "info" || value === "warning" || value === "error" ? value : null;
}
```

- [ ] **Step 7: Run API tests**

Run:

```bash
npm run test -- src/server/app.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/app.ts src/server/app.test.ts
git commit -m "feat: add livekit web call APIs"
```

---

### Task 4: Add Browser LiveKit Client Wrapper

**Files:**
- Create: `src/client/livekitCall.ts`
- Create: `src/client/livekitCall.test.ts`

- [ ] **Step 1: Write failing wrapper tests**

Create `src/client/livekitCall.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { connectLiveKitCall } from "./livekitCall";

describe("connectLiveKitCall", () => {
  it("connects to a room, enables microphone, and disconnects cleanly", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const publishTrack = vi.fn().mockResolvedValue(undefined);
    const setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
    const room = {
      connect,
      disconnect,
      localParticipant: {
        publishTrack,
        setMicrophoneEnabled,
      },
      on: vi.fn(),
      off: vi.fn(),
    };

    const call = await connectLiveKitCall({
      wsUrl: "ws://127.0.0.1:7880",
      token: "jwt-token",
      roomFactory: () => room,
    });

    expect(connect).toHaveBeenCalledWith("ws://127.0.0.1:7880", "jwt-token");
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);

    call.close();
    expect(disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run wrapper test and verify failure**

Run:

```bash
npm run test -- src/client/livekitCall.test.ts
```

Expected: FAIL because `src/client/livekitCall.ts` does not exist.

- [ ] **Step 3: Implement wrapper**

Create `src/client/livekitCall.ts`:

```ts
import { Room, RoomEvent } from "livekit-client";

interface LiveKitRoomLike {
  connect(url: string, token: string): Promise<void>;
  disconnect(): void;
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  };
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  off(event: string, handler: (...args: unknown[]) => void): unknown;
}

interface ConnectLiveKitCallInput {
  wsUrl: string;
  token: string;
  roomFactory?: () => LiveKitRoomLike;
  onDisconnected?: () => void;
  onConnectionQualityChanged?: (quality: string) => void;
}

export interface LiveKitCallConnection {
  close(): void;
}

export async function connectLiveKitCall(input: ConnectLiveKitCallInput): Promise<LiveKitCallConnection> {
  const room = input.roomFactory?.() ?? new Room();
  const disconnected = () => input.onDisconnected?.();
  const qualityChanged = (quality: unknown) => input.onConnectionQualityChanged?.(String(quality));

  room.on(RoomEvent.Disconnected, disconnected);
  room.on(RoomEvent.ConnectionQualityChanged, qualityChanged);
  await room.connect(input.wsUrl, input.token);
  await room.localParticipant.setMicrophoneEnabled(true);

  return {
    close() {
      room.off(RoomEvent.Disconnected, disconnected);
      room.off(RoomEvent.ConnectionQualityChanged, qualityChanged);
      room.disconnect();
    },
  };
}
```

- [ ] **Step 4: Run wrapper tests**

Run:

```bash
npm run test -- src/client/livekitCall.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/livekitCall.ts src/client/livekitCall.test.ts
git commit -m "feat: add browser livekit call client"
```

---

### Task 5: Connect Calls UI To LiveKit Sessions

**Files:**
- Modify: `src/features/calls/CallsPage.tsx`
- Modify: `src/features/calls/CallsPage.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests to `src/features/calls/CallsPage.test.tsx`:

```tsx
it("starts a LiveKit web call from the Composer button", async () => {
  const user = userEvent.setup();
  const liveKitStart = vi.fn().mockResolvedValue({
    call: webCall,
    events: [connectedEvent],
    livekit: {
      wsUrl: "ws://127.0.0.1:7880",
      token: "jwt-token",
      roomName: "lipivoice-call-call_web",
      participantIdentity: "caller_call_web",
      dispatchId: "dispatch_1",
    },
  });
  mockApi({
    "/api/calls": [],
    "/api/agents": [agent],
    post: {
      "/api/livekit/web-call/start": liveKitStart,
    },
  });

  render(<CallsPage />);
  await user.click(await screen.findByRole("button", { name: /composer/i }));

  expect(liveKitStart).toHaveBeenCalledWith({ agentId: "agent_reception" });
  expect(await screen.findByText(/lipivoice-call-call_web/i)).toBeInTheDocument();
});
```

Use existing test fixtures from the file. If the current test helper has a different API shape, adapt the mock by preserving the same assertions.

- [ ] **Step 2: Run CallsPage tests and verify failure**

Run:

```bash
npm run test -- src/features/calls/CallsPage.test.tsx
```

Expected: FAIL because the UI still posts to `/api/calls/simulate`.

- [ ] **Step 3: Update CallsPage imports**

Add:

```ts
import { connectLiveKitCall, type LiveKitCallConnection } from "@/client/livekitCall";
```

Add state:

```ts
const liveKitConnectionRef = useRef<LiveKitCallConnection | null>(null);
const [liveKitRoomName, setLiveKitRoomName] = useState<string | null>(null);
```

- [ ] **Step 4: Update start call handler**

Replace the body of `startSimulatedCall` with:

```ts
async function startSimulatedCall() {
  if (!selectedAgentId) return;

  eventRequestIdRef.current += 1;
  setStartState("saving");
  setEventsError(null);
  setEvents([]);

  try {
    liveKitConnectionRef.current?.close();
    liveKitConnectionRef.current = null;

    const result = await postJson<{
      call: CallRecord;
      events: CallEvent[];
      livekit?: {
        wsUrl: string;
        token: string;
        roomName: string;
        participantIdentity: string;
        dispatchId: string | null;
      };
    }>("/api/livekit/web-call/start", {
      agentId: selectedAgentId,
    });

    if (result.livekit) {
      liveKitConnectionRef.current = await connectLiveKitCall({
        wsUrl: result.livekit.wsUrl,
        token: result.livekit.token,
        onDisconnected: () => {
          setEndState("saved");
        },
      });
      setLiveKitRoomName(result.livekit.roomName);
    }

    setCalls((currentCalls) => [
      result.call,
      ...currentCalls.filter((currentCall) => currentCall.id !== result.call.id),
    ]);
    setSelectedCallId(result.call.id);
    setEvents(result.events);
    setIsLoadingEvents(false);
    setEndState("idle");
    setStartState("saved");
  } catch {
    setStartState("failed");
  }
}
```

- [ ] **Step 5: Close LiveKit connection when ending calls**

At the start of `endSelectedCall`, before `setEndState("saving")`, add:

```ts
liveKitConnectionRef.current?.close();
liveKitConnectionRef.current = null;
setLiveKitRoomName(null);
```

Add unmount cleanup:

```ts
useEffect(() => {
  return () => {
    liveKitConnectionRef.current?.close();
    liveKitConnectionRef.current = null;
  };
}, []);
```

- [ ] **Step 6: Render room metadata**

In the header id line, render the LiveKit room when present:

```tsx
<div className="mt-1 truncate font-mono text-sm text-[#858992]">
  {liveKitRoomName ?? (activeCall ? abbreviatedId(activeCall.id) : "No active call")}
</div>
```

- [ ] **Step 7: Run CallsPage tests**

Run:

```bash
npm run test -- src/features/calls/CallsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/calls/CallsPage.tsx src/features/calls/CallsPage.test.tsx
git commit -m "feat: connect calls page to livekit web calls"
```

---

### Task 6: Add Python LiveKit Worker Scaffold

**Files:**
- Create: `services/livekit-worker/requirements.txt`
- Create: `services/livekit-worker/.env.example`
- Create: `services/livekit-worker/README.md`
- Create: `services/livekit-worker/lipivoice_client.py`
- Create: `services/livekit-worker/test_lipivoice_client.py`

- [ ] **Step 1: Create dependency file**

Create `services/livekit-worker/requirements.txt`:

```txt
python-dotenv>=1.0.1
aiohttp>=3.10
pytest>=8.0
pytest-asyncio>=0.24
livekit-agents[openai,google,silero,turn-detector]>=1.5.15
```

- [ ] **Step 2: Create environment example**

Create `services/livekit-worker/.env.example`:

```bash
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_AGENT_NAME=lipivoice-receptionist
LIPIVOICE_API_BASE_URL=http://127.0.0.1:8787
LIPIVOICE_WORKER_API_KEY=worker-secret
VLLM_BASE_URL=http://127.0.0.1:8000/v1
VLLM_MODEL=gemma-4
OPENAI_API_KEY=not-needed-for-local-vllm
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-service-account.json
GOOGLE_TTS_LANGUAGE_CODE=ne-NP
GOOGLE_TTS_MODEL=gemini-2.5-flash-tts
GOOGLE_TTS_VOICE_NAME=Kore
GOOGLE_STT_LANGUAGE_CODES=ne-NP,en-US
```

- [ ] **Step 3: Write failing Python client tests**

Create `services/livekit-worker/test_lipivoice_client.py`:

```py
import pytest

from lipivoice_client import normalize_event


def test_normalize_event_defaults_timestamp_and_severity():
    event = normalize_event(
        {
            "type": "transcript",
            "actor": "assistant",
            "payload": {"text": "नमस्ते"},
        },
        timestamp="2026-06-02T00:00:00.000Z",
    )

    assert event == {
        "timestamp": "2026-06-02T00:00:00.000Z",
        "type": "transcript",
        "actor": "assistant",
        "payload": {"text": "नमस्ते"},
        "severity": "info",
    }


def test_normalize_event_falls_back_to_runtime_event_for_unknown_type():
    event = normalize_event(
        {
            "type": "unknown",
            "actor": "agent",
            "payload": {"stage": "llm"},
            "severity": "bad",
        },
        timestamp="2026-06-02T00:00:00.000Z",
    )

    assert event == {
        "timestamp": "2026-06-02T00:00:00.000Z",
        "type": "runtime",
        "actor": "system",
        "payload": {"stage": "llm"},
        "severity": "info",
    }
```

- [ ] **Step 4: Run Python client tests and verify failure**

Run:

```bash
cd services/livekit-worker
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pytest -q
```

Expected: FAIL because `lipivoice_client.py` does not exist.

- [ ] **Step 5: Implement LipiVoice client**

Create `services/livekit-worker/lipivoice_client.py`:

```py
from __future__ import annotations

import datetime as dt
from typing import Any

import aiohttp

VALID_TYPES = {"status", "transcript", "tool_call", "audio", "runtime", "error"}
VALID_ACTORS = {"system", "user", "assistant", "tool"}
VALID_SEVERITIES = {"info", "warning", "error"}


def iso_now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_event(raw: dict[str, Any], *, timestamp: str | None = None) -> dict[str, Any]:
    event_type = raw.get("type")
    actor = raw.get("actor")
    severity = raw.get("severity")
    payload = raw.get("payload")

    return {
        "timestamp": timestamp or iso_now(),
        "type": event_type if event_type in VALID_TYPES else "runtime",
        "actor": actor if actor in VALID_ACTORS else "system",
        "payload": payload if isinstance(payload, dict) else {},
        "severity": severity if severity in VALID_SEVERITIES else "info",
    }


class LipiVoiceClient:
    def __init__(self, *, base_url: str, worker_api_key: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.worker_api_key = worker_api_key

    def headers(self) -> dict[str, str]:
        if not self.worker_api_key:
            return {}
        return {"x-lipivoice-worker-key": self.worker_api_key}

    async def get_session_config(self, call_id: str) -> dict[str, Any]:
        async with aiohttp.ClientSession(headers=self.headers()) as session:
            async with session.get(f"{self.base_url}/api/worker/session-config", params={"callId": call_id}) as response:
                response.raise_for_status()
                return await response.json()

    async def post_events(self, call_id: str, events: list[dict[str, Any]]) -> None:
        normalized = [normalize_event(event) for event in events]
        async with aiohttp.ClientSession(headers=self.headers()) as session:
            async with session.post(
                f"{self.base_url}/api/worker/calls/{call_id}/events",
                json={"events": normalized},
            ) as response:
                response.raise_for_status()
```

- [ ] **Step 6: Add README**

Create `services/livekit-worker/README.md`:

```md
# LipiVoice LiveKit Worker

Runs the LiveKit Agents worker for LipiVoice simulated web calls.

## Setup

```bash
cd services/livekit-worker
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with LiveKit, LipiVoice, vLLM, and Google credentials.

## Run

```bash
. .venv/bin/activate
python agent.py dev
```

The worker registers as `lipivoice-receptionist` and expects explicit dispatch metadata:

```json
{"callId":"call_id","agentId":"agent_reception"}
```
```

- [ ] **Step 7: Run Python tests**

Run:

```bash
cd services/livekit-worker
. .venv/bin/activate
pytest -q
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/livekit-worker
git commit -m "feat: add livekit worker scaffold"
```

---

### Task 7: Implement Python LiveKit Receptionist Worker

**Files:**
- Create: `services/livekit-worker/agent.py`
- Modify: `services/livekit-worker/test_lipivoice_client.py`

- [ ] **Step 1: Add metadata parsing tests**

Add to `services/livekit-worker/test_lipivoice_client.py`:

```py
from lipivoice_client import parse_dispatch_metadata


def test_parse_dispatch_metadata_requires_call_id_and_agent_id():
    assert parse_dispatch_metadata('{"callId":"call_1","agentId":"agent_reception"}') == {
        "call_id": "call_1",
        "agent_id": "agent_reception",
    }


def test_parse_dispatch_metadata_rejects_bad_json():
    with pytest.raises(ValueError, match="invalid_dispatch_metadata"):
        parse_dispatch_metadata("not-json")
```

- [ ] **Step 2: Implement metadata parser**

Add to `services/livekit-worker/lipivoice_client.py`:

```py
import json


def parse_dispatch_metadata(metadata: str) -> dict[str, str]:
    try:
        parsed = json.loads(metadata or "{}")
    except json.JSONDecodeError as error:
        raise ValueError("invalid_dispatch_metadata") from error

    call_id = parsed.get("callId")
    agent_id = parsed.get("agentId")
    if not isinstance(call_id, str) or not call_id:
        raise ValueError("invalid_dispatch_metadata")
    if not isinstance(agent_id, str) or not agent_id:
        raise ValueError("invalid_dispatch_metadata")

    return {"call_id": call_id, "agent_id": agent_id}
```

- [ ] **Step 3: Create worker entrypoint**

Create `services/livekit-worker/agent.py`:

```py
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from dotenv import load_dotenv
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli, function_tool
from livekit.plugins import google, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from lipivoice_client import LipiVoiceClient, parse_dispatch_metadata

load_dotenv()

logger = logging.getLogger("lipivoice-worker")
server = AgentServer()


@dataclass
class ReceptionistData:
    call_id: str
    agent_id: str
    client: LipiVoiceClient


class InsuranceReceptionistAgent(Agent):
    def __init__(self, *, instructions: str, greeting: str) -> None:
        super().__init__(instructions=instructions)
        self.greeting = greeting

    async def on_enter(self) -> None:
        await self.session.say(self.greeting, allow_interruptions=True)

    @function_tool
    async def collect_callback(self, name: str, phone_number: str, reason: str) -> str:
        """Collect callback details for a licensed insurance staff follow-up.

        Args:
            name: Caller name.
            phone_number: Caller callback phone number.
            reason: Short reason for the callback.
        """
        return f"Callback collected for {name} at {phone_number}: {reason}"


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def build_llm():
    return openai.LLM(
        model=env("VLLM_MODEL", "gemma-4"),
        base_url=env("VLLM_BASE_URL"),
        api_key=env("OPENAI_API_KEY", "not-needed-for-local-vllm"),
        temperature=0.2,
    )


def build_stt():
    languages = [value.strip() for value in env("GOOGLE_STT_LANGUAGE_CODES", "ne-NP,en-US").split(",") if value.strip()]
    return google.STT(languages=languages, model="chirp_3")


def build_tts():
    return google.TTS(
        language=env("GOOGLE_TTS_LANGUAGE_CODE", "ne-NP"),
        voice_name=env("GOOGLE_TTS_VOICE_NAME", "Kore"),
        model_name=env("GOOGLE_TTS_MODEL", "gemini-2.5-flash-tts"),
    )


@server.rtc_session(agent_name=env("LIVEKIT_AGENT_NAME", "lipivoice-receptionist"))
async def entrypoint(ctx: JobContext):
    metadata = parse_dispatch_metadata(ctx.job.metadata)
    client = LipiVoiceClient(
        base_url=env("LIPIVOICE_API_BASE_URL", "http://127.0.0.1:8787"),
        worker_api_key=env("LIPIVOICE_WORKER_API_KEY"),
    )
    config = await client.get_session_config(metadata["call_id"])
    agent_config = config["agent"]

    await client.post_events(metadata["call_id"], [
        {
            "type": "runtime",
            "actor": "system",
            "payload": {
                "stage": "worker_started",
                "agentId": metadata["agent_id"],
                "room": ctx.room.name,
            },
        }
    ])

    await ctx.connect()

    session = AgentSession[ReceptionistData](
        userdata=ReceptionistData(
            call_id=metadata["call_id"],
            agent_id=metadata["agent_id"],
            client=client,
        ),
        vad=silero.VAD.load(),
        stt=build_stt(),
        llm=build_llm(),
        tts=build_tts(),
        turn_detection=MultilingualModel(),
        turn_handling={
            "interruption": {"enabled": True, "resume_false_interruption": True},
            "endpointing": {"min_delay": 0.35, "max_delay": 2.0},
        },
    )

    @session.on("user_input_transcribed")
    def on_user_transcript(event):
        if event.is_final:
            session.loop.create_task(client.post_events(metadata["call_id"], [
                {
                    "type": "transcript",
                    "actor": "user",
                    "payload": {"text": event.transcript},
                }
            ]))

    @session.on("conversation_item_added")
    def on_conversation_item(event):
        item = event.item
        if getattr(item, "type", "") == "message" and getattr(item, "role", "") == "assistant":
            text = getattr(item, "text_content", "")
            if text:
                session.loop.create_task(client.post_events(metadata["call_id"], [
                    {
                        "type": "transcript",
                        "actor": "assistant",
                        "payload": {"text": text},
                    }
                ]))

    @session.on("agent_state_changed")
    def on_agent_state(event):
        session.loop.create_task(client.post_events(metadata["call_id"], [
            {
                "type": "status",
                "actor": "system",
                "payload": {"status": event.new_state},
            }
        ]))

    await session.start(
        agent=InsuranceReceptionistAgent(
            instructions=agent_config["systemPrompt"],
            greeting=agent_config["greeting"],
        ),
        room=ctx.room,
    )


if __name__ == "__main__":
    cli.run_app(server)
```

- [ ] **Step 4: Run worker tests**

Run:

```bash
cd services/livekit-worker
. .venv/bin/activate
pytest -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/livekit-worker/agent.py services/livekit-worker/lipivoice_client.py services/livekit-worker/test_lipivoice_client.py
git commit -m "feat: add livekit receptionist worker"
```

---

### Task 8: Harden Receptionist Defaults, Tools, And Evals

**Files:**
- Modify: `src/domain/defaults.ts`
- Modify: `src/domain/defaults.test.ts`

- [ ] **Step 1: Write failing default tests**

Add tests to `src/domain/defaults.test.ts`:

```ts
it("seeds a Nepali-first insurance receptionist with Google Nepali voice", () => {
  const workspace = createRemoteWorkspace({
    now: "2026-06-02T00:00:00.000Z",
    vllmEndpoint: "http://vllm.test/v1",
    vllmModel: "gemma-4",
    lipiMlEndpoint: "http://lipi.test",
  });

  const agent = workspace.agents.find((candidate) => candidate.id === "agent_reception");
  expect(agent?.name).toBe("Lipi Insurance Receptionist");
  expect(agent?.language).toBe("ne");
  expect(agent?.voiceId).toBe("voice_google_tts_ne");
  expect(agent?.systemPrompt).toContain("Devanagari");
  expect(agent?.systemPrompt).toContain("claim approvals");
});

it("seeds receptionist tools and evals", () => {
  const workspace = createRemoteWorkspace({
    now: "2026-06-02T00:00:00.000Z",
    vllmEndpoint: "http://vllm.test/v1",
    vllmModel: "gemma-4",
    lipiMlEndpoint: "http://lipi.test",
  });

  expect(workspace.tools.map((tool) => tool.id)).toEqual(
    expect.arrayContaining([
      "tool_collect_callback",
      "tool_claim_intake",
      "tool_document_request",
      "tool_office_hours",
    ]),
  );
  expect(workspace.evals.map((evaluation) => evaluation.id)).toEqual(
    expect.arrayContaining([
      "eval_nepali_reception_greeting",
      "eval_claim_no_approval",
      "eval_callback_collection",
    ]),
  );
});
```

- [ ] **Step 2: Run defaults tests and verify failure**

Run:

```bash
npm run test -- src/domain/defaults.test.ts
```

Expected: FAIL until seeded tools/evals are updated.

- [ ] **Step 3: Update receptionist prompt**

Replace `insuranceReceptionistPrompt` with:

```ts
const insuranceReceptionistPrompt = [
  "You are the insurance company receptionist for Lipi Insurance.",
  "Speak Nepali in Devanagari by default. Use English only when the caller clearly starts in English or asks for English.",
  "This is a live phone conversation. Keep each reply to one or two short phone-ready sentences.",
  "Handle caller intents for new quotes, policy questions, claims intake, billing, document requests, office hours, and callbacks.",
  "Ask one question at a time. Do not ask for information the caller already gave.",
  "Collect the caller's name, callback phone number, insurance type, and policy or claim number when relevant.",
  "Do not invent premiums, coverage decisions, claim approvals, policy status, or legal advice.",
  "If a licensed agent, underwriter, or claims handler is required, explain that you can collect details and arrange follow-up.",
  "For emergencies or immediate safety issues, tell the caller to contact local emergency services first.",
  "Before ending, confirm the next step and repeat callback details when collected.",
].join(" ");
```

- [ ] **Step 4: Replace seed tools**

Update `createSeedTools` to return:

```ts
return [
  {
    id: "tool_collect_callback",
    name: "Collect callback",
    description: "Record caller details for a licensed insurance staff callback.",
    method: "POST",
    url: "https://example.com/insurance/callbacks",
    authMode: "none",
    headers: [],
    parameters: [
      { name: "name", type: "string", required: true },
      { name: "phoneNumber", type: "string", required: true },
      { name: "reason", type: "string", required: true },
    ],
    timeoutMs: 5000,
    retryCount: 0,
    responseSchema: "{\"ok\":\"boolean\",\"callbackId\":\"string\"}",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tool_claim_intake",
    name: "Claim intake",
    description: "Record initial claim details without approving or denying the claim.",
    method: "POST",
    url: "https://example.com/insurance/claims/intake",
    authMode: "none",
    headers: [],
    parameters: [
      { name: "name", type: "string", required: true },
      { name: "phoneNumber", type: "string", required: true },
      { name: "claimType", type: "string", required: true },
      { name: "incidentSummary", type: "string", required: true },
    ],
    timeoutMs: 5000,
    retryCount: 0,
    responseSchema: "{\"ok\":\"boolean\",\"intakeId\":\"string\"}",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tool_document_request",
    name: "Document request",
    description: "Record a request for insurance documents or policy paperwork.",
    method: "POST",
    url: "https://example.com/insurance/documents/request",
    authMode: "none",
    headers: [],
    parameters: [
      { name: "name", type: "string", required: true },
      { name: "phoneNumber", type: "string", required: true },
      { name: "documentType", type: "string", required: true },
    ],
    timeoutMs: 5000,
    retryCount: 0,
    responseSchema: "{\"ok\":\"boolean\",\"requestId\":\"string\"}",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tool_office_hours",
    name: "Office hours",
    description: "Return Lipi Insurance office hours and callback availability.",
    method: "GET",
    url: "https://example.com/insurance/office-hours",
    authMode: "none",
    headers: [],
    parameters: [],
    timeoutMs: 5000,
    retryCount: 0,
    responseSchema: "{\"hours\":\"string\",\"timezone\":\"string\"}",
    createdAt: now,
    updatedAt: now,
  },
];
```

- [ ] **Step 5: Assign tools to remote receptionist**

In `createRemoteWorkspace`, set:

```ts
toolIds: [
  "tool_collect_callback",
  "tool_claim_intake",
  "tool_document_request",
  "tool_office_hours",
],
```

- [ ] **Step 6: Replace seed evals**

Update `createSeedEvals` to include:

```ts
return [
  {
    id: "eval_nepali_reception_greeting",
    name: "Nepali reception greeting",
    description: "Checks that the reception agent greets as Lipi Insurance in Nepali.",
    agentId: "agent_reception",
    cases: [
      {
        id: "case_nepali_greeting",
        input: "नमस्ते",
        checks: [
          { type: "includes", value: "लिपि" },
          { type: "excludes", value: "premium approved" },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "eval_claim_no_approval",
    name: "Claim intake without approval",
    description: "Checks that the receptionist does not approve or deny claims.",
    agentId: "agent_reception",
    cases: [
      {
        id: "case_claim_no_approval",
        input: "मेरो दुर्घटनाको claim approve हुन्छ?",
        checks: [
          { type: "includes", value: "claims" },
          { type: "excludes", value: "approved" },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "eval_callback_collection",
    name: "Callback collection",
    description: "Checks that the receptionist asks for callback details.",
    agentId: "agent_reception",
    cases: [
      {
        id: "case_callback",
        input: "मलाई agent ले call back गर्नुपर्‍यो",
        checks: [
          { type: "includes", value: "phone" },
          { type: "includes", value: "name" },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
];
```

- [ ] **Step 7: Run defaults tests**

Run:

```bash
npm run test -- src/domain/defaults.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/defaults.ts src/domain/defaults.test.ts
git commit -m "feat: harden insurance receptionist defaults"
```

---

### Task 9: Add Runtime Diagnostics For LiveKit And Google Voice

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`
- Modify: `src/features/calls/CallsPage.tsx`
- Modify: `src/features/calls/CallsPage.test.tsx`

- [ ] **Step 1: Add API test for diagnostics**

Add to `src/server/app.test.ts`:

```ts
it("includes LiveKit and Google TTS in runtime diagnostics", async () => {
  const { app } = createAppContextForTest(createRemoteWorkspace({
    now: "2026-06-02T00:00:00.000Z",
    vllmEndpoint: "http://vllm.test/v1",
    vllmModel: "gemma-4",
    lipiMlEndpoint: "http://lipi.test",
  }), {
    runtimeHealth: {
      vllm: async () => ({ status: "healthy", reason: null, latencyMs: 44 }),
      faster_whisper: async () => ({ status: "healthy", reason: null, latencyMs: 91 }),
      google_tts: async () => ({ status: "healthy", reason: null, latencyMs: 210 }),
    },
    liveKitConfigured: true,
  });

  const response = await request(app).get("/api/runtime-diagnostics").expect(200);

  expect(response.body).toMatchObject({
    livekit: { status: "healthy" },
    runtimes: expect.arrayContaining([
      expect.objectContaining({ adapter: "vllm", healthStatus: "healthy" }),
      expect.objectContaining({ adapter: "google_tts", healthStatus: "healthy" }),
    ]),
  });
});
```

- [ ] **Step 2: Add endpoint and deps**

Add `liveKitConfigured?: boolean;` to `AppDeps`.

Add endpoint:

```ts
app.get("/api/runtime-diagnostics", async (_request, response, next) => {
  try {
    const runtimes = await listModelRuntimes(repositories, deps.runtimeHealth);
    response.json({
      livekit: {
        status: deps.liveKit || deps.liveKitConfigured ? "healthy" : "missing_model",
        reason: deps.liveKit || deps.liveKitConfigured ? null : "livekit_not_configured",
      },
      runtimes,
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: Render diagnostics in Calls UI**

Load `/api/runtime-diagnostics` next to calls and agents. Replace hard-coded runtime cards with values from diagnostics:

```ts
interface RuntimeDiagnostic {
  id: string;
  adapter: string;
  kind: string;
  healthStatus: string;
  latencyMs?: number;
}

const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostic[]>([]);
```

In `loadCalls`, fetch:

```ts
getJson<{ runtimes: RuntimeDiagnostic[] }>("/api/runtime-diagnostics").catch(() => ({ runtimes: [] })),
```

Set:

```ts
setRuntimeDiagnostics(diagnostics.runtimes);
```

Use helper:

```ts
function runtimeByKind(runtimes: RuntimeDiagnostic[], kind: string) {
  return runtimes.find((runtime) => runtime.kind === kind);
}
```

Use `runtimeByKind(runtimeDiagnostics, "llm")`, `runtimeByKind(runtimeDiagnostics, "stt")`, and `runtimeByKind(runtimeDiagnostics, "tts")` for card titles/provider/latency.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run test -- src/server/app.test.ts src/features/calls/CallsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts src/server/app.test.ts src/features/calls/CallsPage.tsx src/features/calls/CallsPage.test.tsx
git commit -m "feat: show livekit runtime diagnostics"
```

---

### Task 10: End-To-End Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README run instructions**

Add to `README.md`:

```md
## LiveKit Web Calls

Start LiveKit locally or use LiveKit Cloud, then set:

```bash
export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=devsecret
export LIVEKIT_AGENT_NAME=lipivoice-receptionist
export LIPIVOICE_WORKER_API_KEY=worker-secret
export LIPIVOICE_RUNTIME_PRESET=remote
export VLLM_BASE_URL=http://your-remote-vllm/v1
export VLLM_MODEL=gemma-4
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-service-account.json
export GOOGLE_TTS_LANGUAGE_CODE=ne-NP
export GOOGLE_TTS_MODEL=gemini-2.5-flash-tts
export GOOGLE_TTS_VOICE_NAME=Kore
```

Run the app:

```bash
npm run dev:server
npm run dev
```

Run the worker:

```bash
cd services/livekit-worker
. .venv/bin/activate
python agent.py dev
```

Open `http://127.0.0.1:5173/`, go to Calls, and click Composer.
```

- [ ] **Step 2: Run full validation**

Run:

```bash
npm run test
npm run build
cd services/livekit-worker && . .venv/bin/activate && pytest -q
```

Expected: all commands pass.

- [ ] **Step 3: Browser verification**

Start servers:

```bash
npm run dev:server
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Verify:

- Calls page renders without overlapping text at desktop width.
- Composer starts a LiveKit web call when LiveKit credentials are configured.
- Failure badge shows `livekit_not_configured` when credentials are missing.
- Runtime cards show STT, model, and voice providers from diagnostics.
- Call events persist after refresh.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add livekit web call runbook"
```

---

## Plan Self-Review

- Spec coverage: This plan covers LiveKit config, token/session API, explicit dispatch, browser WebRTC, Python worker, receptionist prompt/tools/evals, event persistence, diagnostics, and verification for the first milestone.
- Out of scope: SIP telephony, workflow graph, knowledge indexing, campaigns, auth, and production hardening are excluded from this milestone by design.
- Placeholder scan: No `TBD`, `TODO`, or undefined implementation steps are intentionally present.
- Type consistency: New TypeScript types use existing `Call`, `CallEvent`, `RuntimeAdapter`, and `ServerConfig` patterns. Worker event payloads match existing `CallEvent` schema.
