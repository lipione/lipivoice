# Local Voice MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable LipiVoice platform slice: a shadcn/ui dashboard, persisted agent/runtime/call data, local open-source runtime adapters, and a browser voice console that talks to the backend over WebSocket.

**Architecture:** The frontend is a Vite React app using shadcn/ui-style owned components and Tailwind. The backend is an Express + WebSocket server that owns persistence, runtime health checks, and a turn-based local voice pipeline. The first model path is open-source/self-hosted: Ollama for LLM, whisper.cpp CLI for STT, Piper CLI for TTS, and a local energy turn detector that fits the same VAD interface until a Silero adapter is introduced in a separate plan.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui primitives, lucide-react, Express, ws, Zod, better-sqlite3, Vitest, Testing Library, Supertest, Ollama, whisper.cpp, Piper.

---

## Status Update - 2026-06-01

The phase 1 MVP is implemented and has been extended beyond the original local-only plan.

Completed implementation:

- React/Vite dashboard, Express API, SQLite persistence, seeded agents/runtimes/calls/tools/voices/evals/usage, and shadcn-style owned UI primitives.
- Local runtime preset for Ollama, whisper.cpp, Piper, and energy VAD.
- Remote runtime preset for vLLM, `lipi-ml` faster-whisper STT, `lipi-ml` Piper TTS, and energy VAD.
- Web Voice session creation and WebSocket orchestration with explicit runtime-not-configured states.
- Voice Lab TTS generation through the configured TTS adapter.
- Nepali TTS provider catalog through `GET /api/tts/providers`.
- Provider benchmark route through `POST /api/tts/benchmark`.
- Manifest-backed remote model catalog via `LIPIVOICE_TTS_MODEL_MANIFEST`.
- Optional Google Cloud TTS adapter using server-side service-account credentials and returning MP3 audio.

Important files added after the original plan:

- `src/domain/ttsProviders.ts`: provider definitions for Google Cloud TTS, Indic Parler TTS, OmniVoice, Chatterbox Nepali, and Coqui/Piper-VITS.
- `src/server/runtimes/ttsModelCatalog.ts`: manifest-backed health and license checks for downloaded TTS candidates.
- `src/server/runtimes/googleCloudTts.ts`: Google service-account auth, voice health check, and MP3 synthesis adapter.
- `docker-compose.remote.yml`: remote Docker deployment with host networking, model catalog mount, and Google secret mount.

Current remote provider status:

| Provider | Status | Notes |
| --- | --- | --- |
| Google Cloud TTS | Configured for Gemini-TTS Preview, IAM blocked | Uses `ne-NP`, `gemini-3.1-flash-tts-preview`, and `GOOGLE_TTS_VOICE_NE=Kore`; remote health is `healthy`, but benchmark returns `provider_synthesis_failed` until the service account receives `aiplatform.endpoints.predict`. |
| Indic Parler TTS | `license_required` | Requires Hugging Face token or accepted terms before model files can be used. |
| OmniVoice | Catalog `healthy`, benchmark unavailable | Model files are present, but inference is not connected, so benchmark returns `provider_adapter_not_connected`. |
| Chatterbox Nepali | `license_required` | Nepali-specific model is gated and still needs accepted access. |
| Coqui VITS / Piper-VITS | `healthy` | Current `lipi-ml` / Piper path generates WAV audio and is the working baseline. |

Remaining follow-up work:

- Implement real inference adapters for OmniVoice and Indic Parler TTS.
- Unlock and wire Chatterbox Nepali after gated model access is accepted.
- Grant the Google service account `roles/aiplatform.user` or equivalent, then re-run the remote Google Cloud TTS benchmark.
- Train or package a stable custom Nepali Coqui/Piper voice for production-quality output.
- Add Google STT only if needed; credentials can be mounted, but no Google STT adapter exists now.
- Expose richer provider failure reasons in the Voice Lab UI if operator debugging needs more detail than the current status/code.

## Scope

This is phase 1 of the approved platform spec. It delivers working software for:

- Dashboard shell and primary navigation.
- Agent creation/editing.
- Runtime settings and health checks for local/open-source model services.
- Calls list and call timeline persistence.
- Voice Lab TTS generation through Piper when configured.
- Browser voice console using a WebSocket session and local model adapters.
- Explicit runtime-not-configured states when Ollama, whisper.cpp, or Piper are absent.

Separate plans should cover production telephony, deeper RAG, eval authoring, Silero VAD integration, and voice-clone job execution.

## File Structure

- `package.json`: scripts and dependencies for frontend, backend, tests, and local runtime orchestration.
- `vite.config.ts`: Vite app config and test config.
- `eslint.config.js`: TypeScript/React lint setup.
- `tsconfig.json`, `tsconfig.node.json`: strict TypeScript config.
- `tailwind.config.ts`, `postcss.config.js`, `components.json`: Tailwind and shadcn/ui configuration.
- `src/styles.css`: global theme tokens and Tailwind layers.
- `src/lib/utils.ts`: `cn()` helper for shadcn/ui components.
- `src/components/ui/*.tsx`: owned shadcn/ui-style primitives used by feature screens.
- `src/domain/types.ts`: shared TypeScript domain types.
- `src/domain/schemas.ts`: Zod schemas and validation helpers.
- `src/domain/defaults.ts`: seed data for the first workspace, agent, and model runtimes.
- `src/domain/status.ts`: call status and runtime status mapping helpers.
- `src/server/index.ts`: backend entrypoint.
- `src/server/app.ts`: Express app and REST routes.
- `src/server/config.ts`: environment parsing for local runtime paths and endpoints.
- `src/server/store/database.ts`: SQLite connection and schema migration.
- `src/server/store/repositories.ts`: typed data access for agents, runtimes, voices, calls, and events.
- `src/server/runtimes/types.ts`: LLM, STT, TTS, VAD, and health interfaces.
- `src/server/runtimes/ollama.ts`: Ollama chat adapter.
- `src/server/runtimes/whisperCpp.ts`: whisper.cpp CLI adapter.
- `src/server/runtimes/piper.ts`: Piper CLI adapter.
- `src/server/runtimes/energyVad.ts`: deterministic local speech turn detector.
- `src/server/runtimes/health.ts`: runtime health aggregation.
- `src/server/audio/wav.ts`: WAV encoding and base64 helpers.
- `src/server/voice/pipeline.ts`: turn-based voice orchestration.
- `src/server/ws/voiceSocket.ts`: WebSocket session handler.
- `src/client/api.ts`: typed REST client.
- `src/client/voiceSocket.ts`: browser WebSocket client.
- `src/App.tsx`: route state and page composition.
- `src/features/shell/*`: dashboard layout.
- `src/features/agents/*`: agent list and editor.
- `src/features/runtimes/*`: runtime health/settings.
- `src/features/voice/*`: web voice console.
- `src/features/calls/*`: calls list and timeline.
- `src/features/voice-lab/*`: TTS generation panel.
- `src/features/overview/*`: operational summary cards.
- `src/test/*`: test setup and test helpers.
- `README.md`: local setup, model install commands, and verification commands.

## Task 1: Project Tooling and shadcn Foundation

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.node.json`
- Create: `eslint.config.js`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `components.json`
- Modify: `src/styles.css`
- Create: `src/lib/utils.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install @vitejs/plugin-react vite typescript react react-dom lucide-react \
  express ws zod better-sqlite3 nanoid cors execa ffmpeg-static \
  @radix-ui/react-slot @radix-ui/react-label @radix-ui/react-select \
  class-variance-authority clsx tailwind-merge
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event supertest @types/express @types/ws \
  @types/better-sqlite3 @types/cors @types/supertest eslint @eslint/js \
  typescript-eslint globals tailwindcss postcss autoprefixer tsx
```

Expected: npm exits 0 and `package-lock.json` changes.

- [ ] **Step 2: Write the first failing test for the shared `cn()` helper**

Create `src/lib/utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2 text-sm", false && "hidden", "px-4")).toBe("text-sm px-4");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lib/utils.test.ts
```

Expected: FAIL because `src/lib/utils.ts` does not export `cn`.

- [ ] **Step 4: Configure scripts, Vite, tests, Tailwind, and `cn()`**

Set `package.json` scripts to:

```json
{
  "dev": "vite --host 0.0.0.0",
  "dev:server": "tsx watch src/server/index.ts",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "preview": "vite preview --host 0.0.0.0"
}
```

Use this `vite.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
```

Use this `eslint.config.js`:

```js
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist", "node_modules"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
```

Use this `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

Use this `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Use this `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Create `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib"
  }
}
```

Use this `src/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 99%;
    --foreground: 224 18% 12%;
    --card: 0 0% 100%;
    --card-foreground: 224 18% 12%;
    --primary: 170 63% 30%;
    --primary-foreground: 0 0% 100%;
    --muted: 220 14% 94%;
    --muted-foreground: 224 9% 42%;
    --accent: 35 88% 53%;
    --accent-foreground: 224 18% 12%;
    --destructive: 0 72% 49%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 13% 86%;
    --input: 220 13% 86%;
    --ring: 170 63% 30%;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground antialiased;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest run src/lib/utils.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.node.json \
  eslint.config.js tailwind.config.ts postcss.config.js components.json \
  src/styles.css src/lib/utils.ts src/lib/utils.test.ts src/test/setup.ts
git commit -m "chore: configure app tooling"
```

## Task 2: Domain Types, Schemas, and Defaults

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/schemas.ts`
- Create: `src/domain/defaults.ts`
- Create: `src/domain/status.ts`
- Test: `src/domain/schemas.test.ts`
- Test: `src/domain/status.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `src/domain/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { agentSchema, modelRuntimeSchema, toolSchema } from "./schemas";

describe("domain schemas", () => {
  it("accepts a complete local-model agent", () => {
    const parsed = agentSchema.parse({
      id: "agent_reception",
      name: "Reception Agent",
      greeting: "Hi, this is LipiVoice. How can I help?",
      systemPrompt: "Answer concisely and collect the caller's name.",
      language: "en",
      modelRuntimeId: "runtime_ollama",
      modelAssetId: "model_llama32_3b",
      voiceId: "voice_piper_amy",
      transcriberRuntimeId: "runtime_whisper",
      recordingEnabled: true,
      interruptionSensitivity: "medium",
      toolIds: ["tool_lookup_customer"],
      knowledgeBaseIds: [],
      deploymentState: "draft",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    });

    expect(parsed.modelRuntimeId).toBe("runtime_ollama");
  });

  it("rejects a tool without a valid URL", () => {
    expect(() =>
      toolSchema.parse({
        id: "tool_bad",
        name: "Bad Tool",
        description: "Invalid URL example",
        method: "POST",
        url: "localhost/customers",
        authMode: "none",
        headers: [],
        parameters: [],
        timeoutMs: 8000,
        retryCount: 0,
        responseSchema: "{}",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z"
      }),
    ).toThrow(/Invalid URL/);
  });

  it("marks model runtimes as local by adapter", () => {
    const runtime = modelRuntimeSchema.parse({
      id: "runtime_ollama",
      kind: "llm",
      adapter: "ollama",
      endpoint: "http://127.0.0.1:11434",
      configuredState: "configured",
      healthStatus: "unknown",
      defaultModelId: "model_llama32_3b",
      concurrencyLimit: 1,
      hardwareHints: ["metal"],
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    });

    expect(runtime.adapter).toBe("ollama");
  });
});
```

Create `src/domain/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { callStatusLabel, runtimeHealthTone } from "./status";

describe("status helpers", () => {
  it("labels runtime failures with actionable severity", () => {
    expect(runtimeHealthTone("missing_model")).toEqual({
      label: "Model missing",
      tone: "warning",
    });
  });

  it("labels active calls", () => {
    expect(callStatusLabel("speaking")).toBe("Speaking");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/domain/schemas.test.ts src/domain/status.test.ts
```

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Add domain types and schemas**

Create `src/domain/types.ts`:

```ts
export type RuntimeKind = "llm" | "stt" | "tts" | "vad" | "embedding";
export type RuntimeAdapter =
  | "ollama"
  | "vllm"
  | "whisper_cpp"
  | "faster_whisper"
  | "piper"
  | "kokoro"
  | "energy_vad";
export type RuntimeHealthStatus =
  | "unknown"
  | "healthy"
  | "unavailable"
  | "missing_model"
  | "license_required"
  | "failed";
export type ConfiguredState = "configured" | "not_configured";
export type DeploymentState = "draft" | "ready" | "not_configured";
export type CallStatus =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "disconnected"
  | "failed";

export interface Agent {
  id: string;
  name: string;
  greeting: string;
  systemPrompt: string;
  language: string;
  modelRuntimeId: string;
  modelAssetId: string;
  voiceId: string;
  transcriberRuntimeId: string;
  recordingEnabled: boolean;
  interruptionSensitivity: "low" | "medium" | "high";
  toolIds: string[];
  knowledgeBaseIds: string[];
  deploymentState: DeploymentState;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRuntime {
  id: string;
  kind: RuntimeKind;
  adapter: RuntimeAdapter;
  endpoint: string;
  configuredState: ConfiguredState;
  healthStatus: RuntimeHealthStatus;
  defaultModelId: string;
  concurrencyLimit: number;
  hardwareHints: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelAsset {
  id: string;
  runtimeId: string;
  name: string;
  kind: RuntimeKind;
  family: string;
  version: string;
  pathOrTag: string;
  license: string;
  parameterSize: string;
  quantization: string;
  languageSupport: string[];
  installedState: "installed" | "not_installed" | "unknown";
}

export interface Voice {
  id: string;
  name: string;
  runtimeId: string;
  type: "builtin" | "cloned";
  language: string;
  tags: string[];
  previewUrl: string;
  privacy: "private" | "workspace";
  cloneStatus: "not_clone" | "pending" | "processing" | "available" | "failed";
  consentId: string | null;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  authMode: "none" | "bearer" | "header";
  headers: Array<{ name: string; value: string; secret: boolean }>;
  parameters: Array<{ name: string; type: "string" | "number" | "boolean"; required: boolean }>;
  timeoutMs: number;
  retryCount: number;
  responseSchema: string;
  createdAt: string;
  updatedAt: string;
}

export interface Call {
  id: string;
  channel: "web" | "phone" | "simulation";
  direction: "inbound" | "outbound";
  agentId: string;
  status: CallStatus;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  costEstimateUsd: number;
  recordingUrl: string | null;
  failureReason: string | null;
}

export interface CallEvent {
  id: string;
  callId: string;
  timestamp: string;
  type: "status" | "transcript" | "tool_call" | "audio" | "runtime" | "error";
  actor: "system" | "user" | "assistant" | "tool";
  payload: Record<string, unknown>;
  severity: "info" | "warning" | "error";
}
```

Create `src/domain/schemas.ts`:

```ts
import { z } from "zod";

export const isoDateSchema = z.string().datetime();

export const callStatusSchema = z.enum([
  "idle",
  "requesting_mic",
  "connecting",
  "connected",
  "listening",
  "thinking",
  "speaking",
  "disconnected",
  "failed",
]);

export const runtimeKindSchema = z.enum(["llm", "stt", "tts", "vad", "embedding"]);
export const runtimeAdapterSchema = z.enum([
  "ollama",
  "vllm",
  "whisper_cpp",
  "faster_whisper",
  "piper",
  "kokoro",
  "energy_vad",
]);

export const runtimeHealthStatusSchema = z.enum([
  "unknown",
  "healthy",
  "unavailable",
  "missing_model",
  "license_required",
  "failed",
]);

export const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  greeting: z.string().min(1),
  systemPrompt: z.string().min(1),
  language: z.string().min(2),
  modelRuntimeId: z.string().min(1),
  modelAssetId: z.string().min(1),
  voiceId: z.string().min(1),
  transcriberRuntimeId: z.string().min(1),
  recordingEnabled: z.boolean(),
  interruptionSensitivity: z.enum(["low", "medium", "high"]),
  toolIds: z.array(z.string()),
  knowledgeBaseIds: z.array(z.string()),
  deploymentState: z.enum(["draft", "ready", "not_configured"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const modelRuntimeSchema = z.object({
  id: z.string().min(1),
  kind: runtimeKindSchema,
  adapter: runtimeAdapterSchema,
  endpoint: z.string(),
  configuredState: z.enum(["configured", "not_configured"]),
  healthStatus: runtimeHealthStatusSchema,
  defaultModelId: z.string(),
  concurrencyLimit: z.number().int().min(1).max(16),
  hardwareHints: z.array(z.string()),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const modelAssetSchema = z.object({
  id: z.string().min(1),
  runtimeId: z.string().min(1),
  name: z.string().min(1),
  kind: runtimeKindSchema,
  family: z.string().min(1),
  version: z.string().min(1),
  pathOrTag: z.string().min(1),
  license: z.string().min(1),
  parameterSize: z.string(),
  quantization: z.string(),
  languageSupport: z.array(z.string()),
  installedState: z.enum(["installed", "not_installed", "unknown"]),
});

export const voiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtimeId: z.string().min(1),
  type: z.enum(["builtin", "cloned"]),
  language: z.string().min(2),
  tags: z.array(z.string()),
  previewUrl: z.string(),
  privacy: z.enum(["private", "workspace"]),
  cloneStatus: z.enum(["not_clone", "pending", "processing", "available", "failed"]),
  consentId: z.string().nullable(),
});

export const toolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url({ message: "Invalid URL" }),
  authMode: z.enum(["none", "bearer", "header"]),
  headers: z.array(z.object({
    name: z.string().min(1),
    value: z.string(),
    secret: z.boolean(),
  })),
  parameters: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(["string", "number", "boolean"]),
    required: z.boolean(),
  })),
  timeoutMs: z.number().int().min(500).max(60000),
  retryCount: z.number().int().min(0).max(3),
  responseSchema: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const callSchema = z.object({
  id: z.string().min(1),
  channel: z.enum(["web", "phone", "simulation"]),
  direction: z.enum(["inbound", "outbound"]),
  agentId: z.string().min(1),
  status: callStatusSchema,
  startedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
  durationSeconds: z.number().min(0),
  costEstimateUsd: z.number().min(0),
  recordingUrl: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const callEventSchema = z.object({
  id: z.string().min(1),
  callId: z.string().min(1),
  timestamp: isoDateSchema,
  type: z.enum(["status", "transcript", "tool_call", "audio", "runtime", "error"]),
  actor: z.enum(["system", "user", "assistant", "tool"]),
  payload: z.record(z.string(), z.unknown()),
  severity: z.enum(["info", "warning", "error"]),
});
```

Create `src/domain/status.ts`:

```ts
import type { CallStatus, RuntimeHealthStatus } from "./types";

export function callStatusLabel(status: CallStatus) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function runtimeHealthTone(status: RuntimeHealthStatus): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  const labels: Record<RuntimeHealthStatus, { label: string; tone: "success" | "warning" | "danger" | "muted" }> = {
    unknown: { label: "Unchecked", tone: "muted" },
    healthy: { label: "Healthy", tone: "success" },
    unavailable: { label: "Unavailable", tone: "danger" },
    missing_model: { label: "Model missing", tone: "warning" },
    license_required: { label: "License required", tone: "warning" },
    failed: { label: "Failed", tone: "danger" },
  };

  return labels[status];
}
```

Create `src/domain/defaults.ts`:

```ts
import type { Agent, ModelAsset, ModelRuntime, Voice } from "./types";

export function createDefaultWorkspace(now = new Date().toISOString()): {
  agents: Agent[];
  modelRuntimes: ModelRuntime[];
  modelAssets: ModelAsset[];
  voices: Voice[];
} {
  return {
    agents: [
      {
        id: "agent_reception",
        name: "Reception Agent",
        greeting: "Hi, this is LipiVoice. How can I help?",
        systemPrompt: "Answer concisely, ask one question at a time, and collect the caller's name.",
        language: "en",
        modelRuntimeId: "runtime_ollama",
        modelAssetId: "model_llama32_3b",
        voiceId: "voice_piper_amy",
        transcriberRuntimeId: "runtime_whisper_cpp",
        recordingEnabled: false,
        interruptionSensitivity: "medium",
        toolIds: [],
        knowledgeBaseIds: [],
        deploymentState: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ],
    modelRuntimes: [
      {
        id: "runtime_ollama",
        kind: "llm",
        adapter: "ollama",
        endpoint: "http://127.0.0.1:11434",
        configuredState: "configured",
        healthStatus: "unknown",
        defaultModelId: "model_llama32_3b",
        concurrencyLimit: 1,
        hardwareHints: ["local"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "runtime_whisper_cpp",
        kind: "stt",
        adapter: "whisper_cpp",
        endpoint: "",
        configuredState: "not_configured",
        healthStatus: "missing_model",
        defaultModelId: "model_whisper_base_en",
        concurrencyLimit: 1,
        hardwareHints: ["cpu", "metal"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "runtime_piper",
        kind: "tts",
        adapter: "piper",
        endpoint: "",
        configuredState: "not_configured",
        healthStatus: "missing_model",
        defaultModelId: "voice_piper_amy",
        concurrencyLimit: 1,
        hardwareHints: ["cpu"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "runtime_energy_vad",
        kind: "vad",
        adapter: "energy_vad",
        endpoint: "local",
        configuredState: "configured",
        healthStatus: "healthy",
        defaultModelId: "energy_threshold_v1",
        concurrencyLimit: 4,
        hardwareHints: ["cpu"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    modelAssets: [
      {
        id: "model_llama32_3b",
        runtimeId: "runtime_ollama",
        name: "llama3.2:3b",
        kind: "llm",
        family: "llama",
        version: "3.2",
        pathOrTag: "llama3.2:3b",
        license: "Meta Llama license",
        parameterSize: "3B",
        quantization: "provider default",
        languageSupport: ["en"],
        installedState: "unknown",
      },
      {
        id: "model_whisper_base_en",
        runtimeId: "runtime_whisper_cpp",
        name: "Whisper base.en",
        kind: "stt",
        family: "whisper",
        version: "base.en",
        pathOrTag: "ggml-base.en.bin",
        license: "MIT",
        parameterSize: "74M",
        quantization: "ggml",
        languageSupport: ["en"],
        installedState: "unknown",
      },
    ],
    voices: [
      {
        id: "voice_piper_amy",
        name: "Piper Amy",
        runtimeId: "runtime_piper",
        type: "builtin",
        language: "en-US",
        tags: ["local", "neutral"],
        previewUrl: "",
        privacy: "workspace",
        cloneStatus: "not_clone",
        consentId: null,
      },
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/domain/schemas.test.ts src/domain/status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain
git commit -m "feat: add local voice domain model"
```

## Task 3: SQLite Store

**Files:**
- Create: `src/server/store/database.ts`
- Create: `src/server/store/repositories.ts`
- Test: `src/server/store/repositories.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `src/server/store/repositories.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "@/domain/defaults";
import { createDatabase } from "./database";
import { createRepositories, type Repositories } from "./repositories";

let repos: Repositories;

beforeEach(() => {
  const db = createDatabase(":memory:");
  repos = createRepositories(db);
  repos.seedWorkspace(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));
});

afterEach(() => {
  repos.close();
});

describe("repositories", () => {
  it("persists and updates an agent", () => {
    const agent = repos.agents.list()[0];
    repos.agents.save({ ...agent, name: "Updated Agent" });

    expect(repos.agents.get(agent.id)?.name).toBe("Updated Agent");
  });

  it("persists call events in timestamp order", () => {
    const agent = repos.agents.list()[0];
    const call = repos.calls.create({
      channel: "web",
      direction: "inbound",
      agentId: agent.id,
      status: "connecting",
      startedAt: "2026-05-29T00:00:01.000Z"
    });

    repos.callEvents.append({
      callId: call.id,
      timestamp: "2026-05-29T00:00:03.000Z",
      type: "status",
      actor: "system",
      payload: { status: "speaking" },
      severity: "info"
    });
    repos.callEvents.append({
      callId: call.id,
      timestamp: "2026-05-29T00:00:02.000Z",
      type: "transcript",
      actor: "user",
      payload: { text: "hello" },
      severity: "info"
    });

    expect(repos.callEvents.listForCall(call.id).map((event) => event.timestamp)).toEqual([
      "2026-05-29T00:00:02.000Z",
      "2026-05-29T00:00:03.000Z",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/server/store/repositories.test.ts
```

Expected: FAIL because the store modules do not exist.

- [ ] **Step 3: Add database and repository code**

In `src/server/store/database.ts`, add a `better-sqlite3` connection, a `createDatabase(filename: string)` export, and migrations for tables: `agents`, `model_runtimes`, `model_assets`, `voices`, `tools`, `calls`, `call_events`. Store flexible records as JSON text columns named `data` except `call_events`, which also has `call_id` and `timestamp` columns for ordered lookup.

In `src/server/store/repositories.ts`, export this interface and implement each method against the SQLite tables:

```ts
export interface Repositories {
  agents: {
    list(): Agent[];
    get(id: string): Agent | null;
    save(agent: Agent): Agent;
  };
  runtimes: {
    list(): ModelRuntime[];
    save(runtime: ModelRuntime): ModelRuntime;
  };
  calls: {
    list(): Call[];
    get(id: string): Call | null;
    create(input: Pick<Call, "channel" | "direction" | "agentId" | "status" | "startedAt">): Call;
    update(call: Call): Call;
  };
  callEvents: {
    append(input: Omit<CallEvent, "id">): CallEvent;
    listForCall(callId: string): CallEvent[];
  };
  seedWorkspace(seed: ReturnType<typeof createDefaultWorkspace>): void;
  close(): void;
}
```

Use `nanoid()` for generated ids. Use `JSON.stringify()` when saving `data` and schema parsing from `src/domain/schemas.ts` when reading records.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/server/store/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/store src/server/store/repositories.test.ts
git commit -m "feat: persist local voice workspace"
```

## Task 4: Backend REST API

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Test: `src/server/app.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `src/server/app.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "@/domain/defaults";
import { createAppForTest } from "./app";

describe("server app", () => {
  it("returns seeded agents and runtimes", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const agents = await request(app).get("/api/agents").expect(200);
    const runtimes = await request(app).get("/api/model-runtimes").expect(200);

    expect(agents.body).toHaveLength(1);
    expect(runtimes.body.some((runtime: { adapter: string }) => runtime.adapter === "ollama")).toBe(true);
  });

  it("creates a simulated call with an initial event", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));
    const agentId = (await request(app).get("/api/agents")).body[0].id;

    const response = await request(app)
      .post("/api/calls/simulate")
      .send({ agentId })
      .expect(201);

    expect(response.body.call.status).toBe("connected");
    expect(response.body.events[0].payload.status).toBe("connected");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/server/app.test.ts
```

Expected: FAIL because `createAppForTest` does not exist.

- [ ] **Step 3: Add REST routes**

Create `src/server/config.ts`:

```ts
export interface ServerConfig {
  port: number;
  databasePath: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  whisperCppBin: string;
  whisperModelPath: string;
  piperBin: string;
  piperVoicePath: string;
}

export function loadServerConfig(env = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8787),
    databasePath: env.LIPIVOICE_DB_PATH ?? "data/lipivoice.sqlite",
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    ollamaModel: env.LIPIVOICE_LLM_MODEL ?? "llama3.2:3b",
    whisperCppBin: env.WHISPER_CPP_BIN ?? "",
    whisperModelPath: env.WHISPER_MODEL_PATH ?? "",
    piperBin: env.PIPER_BIN ?? "",
    piperVoicePath: env.PIPER_VOICE_PATH ?? "",
  };
}
```

In `src/server/app.ts`, add Express JSON middleware, CORS, a repository instance, and these routes: `GET /api/agents`, `POST /api/agents`, `GET /api/model-runtimes`, `GET /api/calls`, `GET /api/calls/:id/events`, `POST /api/calls/simulate`. Export `createAppForTest(seed)` for tests and `createApp(config)` for runtime.

Create `src/server/index.ts`:

```ts
import { createServer } from "node:http";
import { createApp } from "./app";
import { loadServerConfig } from "./config";

const config = loadServerConfig();
const app = createApp(config);
const server = createServer(app);

server.listen(config.port, () => {
  console.log(`LipiVoice API listening on http://localhost:${config.port}`);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/server/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts src/server/app.ts src/server/index.ts src/server/app.test.ts
git commit -m "feat: expose local platform API"
```

## Task 5: Local Runtime Health and Adapters

**Files:**
- Create: `src/server/runtimes/types.ts`
- Create: `src/server/runtimes/ollama.ts`
- Create: `src/server/runtimes/whisperCpp.ts`
- Create: `src/server/runtimes/piper.ts`
- Create: `src/server/runtimes/energyVad.ts`
- Create: `src/server/runtimes/health.ts`
- Test: `src/server/runtimes/runtimes.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Create `src/server/runtimes/runtimes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectSpeechTurn } from "./energyVad";
import { mapRuntimeHealth } from "./health";

describe("runtime adapters", () => {
  it("detects speech when frame energy crosses threshold", () => {
    const quiet = new Float32Array([0.001, -0.001, 0.002]);
    const speech = new Float32Array([0.2, -0.18, 0.16]);

    expect(detectSpeechTurn([quiet, speech], { threshold: 0.05 })).toEqual({
      hasSpeech: true,
      peak: 0.2,
    });
  });

  it("maps missing local binaries to runtime_not_configured", () => {
    expect(mapRuntimeHealth({ configured: false, reachable: false, modelPresent: false })).toEqual({
      status: "missing_model",
      reason: "runtime_not_configured",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/server/runtimes/runtimes.test.ts
```

Expected: FAIL because runtime modules do not exist.

- [ ] **Step 3: Add runtime interfaces and adapters**

Create `src/server/runtimes/types.ts`:

```ts
export interface RuntimeHealthResult {
  status: "healthy" | "unavailable" | "missing_model" | "failed";
  reason: string | null;
  latencyMs?: number;
}

export interface LlmAdapter {
  health(): Promise<RuntimeHealthResult>;
  chat(input: { model: string; system: string; messages: Array<{ role: "user" | "assistant"; content: string }> }): Promise<string>;
}

export interface SttAdapter {
  health(): Promise<RuntimeHealthResult>;
  transcribe(input: { wavPath: string; language: string }): Promise<{ text: string; confidence: number | null }>;
}

export interface TtsAdapter {
  health(): Promise<RuntimeHealthResult>;
  synthesize(input: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: "audio/wav" }>;
}
```

Create `src/server/runtimes/energyVad.ts`:

```ts
export function detectSpeechTurn(
  frames: Float32Array[],
  options: { threshold: number },
): { hasSpeech: boolean; peak: number } {
  const peak = frames.reduce((max, frame) => {
    return Math.max(max, ...Array.from(frame, (sample) => Math.abs(sample)));
  }, 0);

  return { hasSpeech: peak >= options.threshold, peak };
}
```

In `src/server/runtimes/health.ts`, add `mapRuntimeHealth(input)` returning `missing_model/runtime_not_configured` when `configured` is false, `unavailable/runtime_unavailable` when configured but unreachable, `missing_model/model_not_installed` when reachable but model missing, and `healthy/null` when all three booleans are true.

In `src/server/runtimes/ollama.ts`, add an `OllamaAdapter` that calls `${baseUrl}/api/tags` for health and `${baseUrl}/api/chat` with `{ model, messages, stream: false }` for chat.

In `src/server/runtimes/whisperCpp.ts`, add a `WhisperCppAdapter` that returns `missing_model/runtime_not_configured` when `binPath` or `modelPath` is empty and uses `execa(binPath, ["-m", modelPath, "-f", wavPath, "-l", language, "-otxt", "-of", outputBase])` for transcription.

In `src/server/runtimes/piper.ts`, add a `PiperAdapter` that returns `missing_model/runtime_not_configured` when `binPath` or `voicePath` is empty and uses `execa(binPath, ["--model", voicePath, "--output_file", outPath], { input: text })`, then returns the WAV file as base64.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/server/runtimes/runtimes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/runtimes
git commit -m "feat: add open source runtime adapters"
```

## Task 6: Audio Helpers and Voice Pipeline

**Files:**
- Create: `src/server/audio/wav.ts`
- Create: `src/server/voice/pipeline.ts`
- Test: `src/server/voice/pipeline.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Create `src/server/voice/pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runVoiceTurn } from "./pipeline";

describe("voice pipeline", () => {
  it("transcribes, asks the LLM, synthesizes, and returns normalized events", async () => {
    const result = await runVoiceTurn({
      agent: {
        greeting: "Hi",
        systemPrompt: "Be concise.",
        language: "en",
        modelAssetId: "llama3.2:3b",
        voiceId: "voice_piper_amy",
      },
      audioWavPath: "/tmp/input.wav",
      stt: {
        transcribe: async () => ({ text: "What are your hours?", confidence: 0.92 }),
      },
      llm: {
        chat: async () => "We are open from 9 AM to 5 PM.",
      },
      tts: {
        synthesize: async () => ({ audioBase64: "UklGRg==", mimeType: "audio/wav" }),
      },
      history: [],
    });

    expect(result.userText).toBe("What are your hours?");
    expect(result.assistantText).toContain("9 AM");
    expect(result.events.map((event) => event.type)).toEqual(["transcript", "transcript", "audio"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/server/voice/pipeline.test.ts
```

Expected: FAIL because `runVoiceTurn` does not exist.

- [ ] **Step 3: Add WAV helpers and voice pipeline**

In `src/server/audio/wav.ts`, add `writeWebmToWav(inputPath, outputPath)` using `ffmpeg-static` and `execa`, plus `fileToBase64(path)` using `fs/promises`.

Create `src/server/voice/pipeline.ts` exporting:

```ts
export async function runVoiceTurn(input: {
  agent: {
    greeting: string;
    systemPrompt: string;
    language: string;
    modelAssetId: string;
    voiceId: string;
  };
  audioWavPath: string;
  stt: { transcribe(args: { wavPath: string; language: string }): Promise<{ text: string; confidence: number | null }> };
  llm: { chat(args: { model: string; system: string; messages: Array<{ role: "user" | "assistant"; content: string }> }): Promise<string> };
  tts: { synthesize(args: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: "audio/wav" }> };
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const transcription = await input.stt.transcribe({
    wavPath: input.audioWavPath,
    language: input.agent.language,
  });
  const assistantText = await input.llm.chat({
    model: input.agent.modelAssetId,
    system: input.agent.systemPrompt,
    messages: [...input.history, { role: "user", content: transcription.text }],
  });
  const audio = await input.tts.synthesize({
    text: assistantText,
    voicePath: input.agent.voiceId,
  });

  return {
    userText: transcription.text,
    assistantText,
    audio,
    events: [
      { type: "transcript" as const, actor: "user" as const, payload: { text: transcription.text, confidence: transcription.confidence } },
      { type: "transcript" as const, actor: "assistant" as const, payload: { text: assistantText } },
      { type: "audio" as const, actor: "assistant" as const, payload: audio },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/server/voice/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/audio src/server/voice
git commit -m "feat: orchestrate local voice turns"
```

## Task 7: WebSocket Voice Sessions

**Files:**
- Create: `src/server/ws/voiceSocket.ts`
- Modify: `src/server/index.ts`
- Test: `src/server/ws/voiceSocket.test.ts`

- [ ] **Step 1: Write failing WebSocket test**

Create `src/server/ws/voiceSocket.test.ts`:

```ts
import { createServer } from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { attachVoiceSocket } from "./voiceSocket";

let server: ReturnType<typeof createServer> | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

describe("voice socket", () => {
  it("emits failed when local runtimes are not configured", async () => {
    server = createServer();
    attachVoiceSocket(server, {
      checkReady: async () => ({ ready: false, reason: "runtime_not_configured" }),
      processAudio: async () => {
        throw new Error("not reached");
      },
    });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test address");

    const message = await new Promise<Record<string, unknown>>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime`);
      ws.on("message", (data) => resolve(JSON.parse(String(data))));
    });

    expect(message).toEqual({ type: "status", status: "failed", reason: "runtime_not_configured" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/server/ws/voiceSocket.test.ts
```

Expected: FAIL because `attachVoiceSocket` does not exist.

- [ ] **Step 3: Add WebSocket session handler**

In `src/server/ws/voiceSocket.ts`, add `attachVoiceSocket(server, deps)`. On connection to `/api/realtime`, call `deps.checkReady()`. If not ready, send `{"type":"status","status":"failed","reason":"runtime_not_configured"}` and keep the socket open long enough for the client to read it. Accept client messages shaped as `{ type: "audio_chunk", mimeType: "audio/webm", audioBase64: string }` and send status events `listening`, `thinking`, `speaking`, and transcript/audio events from `deps.processAudio`.

In `src/server/index.ts`, create the HTTP server, create runtime adapters from config, and attach the voice socket.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/server/ws/voiceSocket.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ws src/server/index.ts
git commit -m "feat: add realtime voice websocket"
```

## Task 8: shadcn/ui Primitives and Dashboard Shell

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/features/shell/DashboardShell.tsx`
- Create: `src/features/overview/OverviewPage.tsx`
- Modify: `src/App.tsx`
- Test: `src/features/shell/DashboardShell.test.tsx`

- [ ] **Step 1: Write failing shell test**

Create `src/features/shell/DashboardShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardShell } from "./DashboardShell";

describe("DashboardShell", () => {
  it("renders operational navigation without marketing copy", () => {
    render(
      <DashboardShell activePage="overview" onNavigate={() => null}>
        <div>Overview content</div>
      </DashboardShell>,
    );

    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Web Voice" })).toBeInTheDocument();
    expect(screen.getByText("Overview content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/features/shell/DashboardShell.test.tsx
```

Expected: FAIL because the shell component does not exist.

- [ ] **Step 3: Add UI primitives and shell**

Create shadcn/ui-style primitives using `cn()`, `@radix-ui/react-slot` for `Button asChild`, `class-variance-authority` variants for `Button` and `Badge`, and 8px or smaller border radii.

In `src/features/shell/DashboardShell.tsx`, add navigation ids: `overview`, `agents`, `web-voice`, `phone`, `calls`, `tools`, `voice-lab`, `knowledge`, `evals`, `usage`, `settings`. Use lucide icons: `Activity`, `Bot`, `Mic`, `Phone`, `ListChecks`, `Wrench`, `AudioWaveform`, `Database`, `FlaskConical`, `Gauge`, `Settings`.

In `src/App.tsx`, render `DashboardShell` and `OverviewPage`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/features/shell/DashboardShell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui src/features/shell src/features/overview src/App.tsx
git commit -m "feat: add operational dashboard shell"
```

## Task 9: Client API, Agents, and Runtime Health UI

**Files:**
- Create: `src/client/api.ts`
- Create: `src/features/agents/AgentsPage.tsx`
- Create: `src/features/runtimes/RuntimeHealthPanel.tsx`
- Modify: `src/App.tsx`
- Test: `src/features/agents/AgentsPage.test.tsx`

- [ ] **Step 1: Write failing agent UI test**

Create `src/features/agents/AgentsPage.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentsPage } from "./AgentsPage";

describe("AgentsPage", () => {
  it("shows agent prompt and runtime health", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/agents")) {
        return Response.json([{ id: "agent_1", name: "Reception", systemPrompt: "Be concise.", greeting: "Hi" }]);
      }
      if (url.endsWith("/api/model-runtimes")) {
        return Response.json([{ id: "runtime_ollama", adapter: "ollama", healthStatus: "unknown", configuredState: "configured" }]);
      }
      return Response.json([]);
    }));

    render(<AgentsPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Reception")).toBeInTheDocument());
    expect(screen.getByText("ollama")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/features/agents/AgentsPage.test.tsx
```

Expected: FAIL because `AgentsPage` does not exist.

- [ ] **Step 3: Add client API and agent UI**

Create `src/client/api.ts`:

```ts
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
```

In `AgentsPage`, add a left list of agents, editable fields for name/greeting/system prompt/language, and a runtime health panel showing runtime adapter, configured state, and health status.

Modify `App.tsx` so clicking `Agents` shows `AgentsPage`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/features/agents/AgentsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client src/features/agents src/features/runtimes src/App.tsx
git commit -m "feat: add agent and runtime management UI"
```

## Task 10: Browser Voice Console

**Files:**
- Create: `src/client/voiceSocket.ts`
- Create: `src/features/voice/VoiceConsolePage.tsx`
- Modify: `src/App.tsx`
- Test: `src/client/voiceSocket.test.ts`
- Test: `src/features/voice/VoiceConsolePage.test.tsx`

- [ ] **Step 1: Write failing voice socket reducer test**

Create `src/client/voiceSocket.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reduceVoiceEvent } from "./voiceSocket";

describe("reduceVoiceEvent", () => {
  it("stores failed runtime status", () => {
    const state = reduceVoiceEvent(
      { status: "connecting", transcript: [], audioQueue: [], error: null },
      { type: "status", status: "failed", reason: "runtime_not_configured" },
    );

    expect(state.status).toBe("failed");
    expect(state.error).toBe("runtime_not_configured");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/client/voiceSocket.test.ts
```

Expected: FAIL because `reduceVoiceEvent` does not exist.

- [ ] **Step 3: Add browser voice state and console**

In `src/client/voiceSocket.ts`, add `VoiceState`, `VoiceServerEvent`, `reduceVoiceEvent`, and `createVoiceSocket(url, handlers)`. The reducer must support status, transcript, audio, and error events.

In `VoiceConsolePage`, add these UI elements:

- Start button using `Mic`.
- Stop button using `Square`.
- Status badge.
- Runtime error panel.
- Transcript list grouped by user/assistant.
- Audio queue playback for `audio/wav` base64 messages.

Use `MediaRecorder` for the first browser capture implementation. On each recorded blob, convert it to base64 and send `{ type: "audio_chunk", mimeType: blob.type, audioBase64 }`.

Modify `App.tsx` so clicking `Web Voice` shows `VoiceConsolePage`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/client/voiceSocket.test.ts src/features/voice/VoiceConsolePage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/voiceSocket.ts src/features/voice src/App.tsx
git commit -m "feat: add browser voice console"
```

## Task 11: Calls and Voice Lab Pages

**Files:**
- Create: `src/features/calls/CallsPage.tsx`
- Create: `src/features/voice-lab/VoiceLabPage.tsx`
- Modify: `src/server/app.ts`
- Modify: `src/App.tsx`
- Test: `src/features/calls/CallsPage.test.tsx`
- Test: `src/features/voice-lab/VoiceLabPage.test.tsx`

- [ ] **Step 1: Write failing page tests**

Create `src/features/calls/CallsPage.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CallsPage } from "./CallsPage";

describe("CallsPage", () => {
  it("renders call records and failure reasons", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json([{ id: "call_1", status: "failed", channel: "web", failureReason: "runtime_not_configured" }]),
    ));

    render(<CallsPage />);

    await waitFor(() => expect(screen.getByText("runtime_not_configured")).toBeInTheDocument());
  });
});
```

Create `src/features/voice-lab/VoiceLabPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VoiceLabPage } from "./VoiceLabPage";

describe("VoiceLabPage", () => {
  it("shows local TTS controls", () => {
    render(<VoiceLabPage />);

    expect(screen.getByLabelText("Text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate speech" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/features/calls/CallsPage.test.tsx src/features/voice-lab/VoiceLabPage.test.tsx
```

Expected: FAIL because the pages do not exist.

- [ ] **Step 3: Add pages and TTS route**

In `CallsPage`, add a compact table of call id, channel, status, duration, and failure reason. Clicking a row loads `/api/calls/:id/events` and renders a timeline.

In `VoiceLabPage`, add text input, voice selector, Generate speech button, and runtime-not-configured result handling.

In `src/server/app.ts`, add `POST /api/tts/generate`. It must call the Piper adapter when configured and return HTTP 409 with `{ code: "runtime_not_configured" }` when Piper is not configured.

Modify `App.tsx` so clicking `Calls` and `Voice Lab` shows these pages.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/features/calls/CallsPage.test.tsx src/features/voice-lab/VoiceLabPage.test.tsx src/server/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/calls src/features/voice-lab src/server/app.ts src/App.tsx
git commit -m "feat: add calls and local voice lab"
```

## Task 12: README, Verification, and Browser Smoke Test

**Files:**
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Add local model setup docs**

Create `README.md` using this content:

```md
# LipiVoice

LipiVoice is a local/open-source voice agent platform prototype inspired by Vapi-style agent orchestration and Voice.ai-style voice infrastructure.

## Local Model Runtime

The default AI path is local/self-hosted:

- LLM: Ollama at `OLLAMA_BASE_URL`, default `http://127.0.0.1:11434`
- STT: whisper.cpp CLI configured by `WHISPER_CPP_BIN` and `WHISPER_MODEL_PATH`
- TTS: Piper CLI configured by `PIPER_BIN` and `PIPER_VOICE_PATH`

Example environment:

```bash
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export LIPIVOICE_LLM_MODEL=llama3.2:3b
export WHISPER_CPP_BIN=/absolute/path/to/whisper-cli
export WHISPER_MODEL_PATH=/absolute/path/to/ggml-base.en.bin
export PIPER_BIN=/absolute/path/to/piper
export PIPER_VOICE_PATH=/absolute/path/to/en_US-amy-medium.onnx
```

## Development

```bash
npm install
npm run dev
npm run dev:server
```

## Verification

```bash
npm run test
npm run lint
npm run build
```
```

- [ ] **Step 2: Run full automated verification**

Run:

```bash
npm run test
npm run lint
npm run build
```

Expected: all three commands exit 0.

- [ ] **Step 3: Start local services for browser smoke**

Run API server:

```bash
npm run dev:server
```

Run frontend in a second terminal:

```bash
npm run dev -- --port 5173
```

Expected: frontend prints a local URL and API prints `LipiVoice API listening on http://localhost:8787`.

- [ ] **Step 4: Browser smoke test**

Open `http://localhost:5173`.

Verify:

- Sidebar renders without overlapping text at desktop width.
- Agents page loads seeded Reception agent.
- Web Voice page Start button requests microphone permission.
- If local runtimes are missing, the console shows `runtime_not_configured`.
- Calls page shows simulated call records after using the simulation route.
- Voice Lab shows `runtime_not_configured` when Piper is absent.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json package-lock.json
git commit -m "docs: document local runtime setup"
```

## Final Verification

Before claiming the phase is complete, run:

```bash
npm run test
npm run lint
npm run build
git status --short
```

Expected:

- Tests pass with 0 failures.
- Lint exits 0.
- Build exits 0.
- `git status --short` shows only intentional untracked local files, such as model files or `.env`.

## Spec Coverage Review

Covered by this plan:

- Agents, Web Voice, Calls, Voice Lab, Usage/runtime health basics, local model runtime configuration, WebSocket voice session, local runtime error states, shadcn/ui dashboard, persistence, and verification.

Not covered by this phase:

- Production carrier telephony, real number management, advanced eval authoring, production RAG indexing, full Silero VAD adapter, voice clone job execution, billing, authentication, and compliance workflows.

Those items remain outside phase 1 because they are independent subsystems and should each get their own implementation plan.
