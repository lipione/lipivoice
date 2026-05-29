import { readFile } from "node:fs/promises";
import { mapRuntimeHealth } from "./health";
import type { RuntimeHealthResult, SttAdapter, TtsAdapter } from "./types";

interface LipiMlAdapterOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

interface LipiMlHealthResponse {
  status?: string;
  stt_loaded?: boolean;
  tts_loaded?: boolean;
}

interface LipiMlSttResponse {
  text?: string;
  confidence?: number | null;
}

export class LipiMlSttAdapter implements SttAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LipiMlAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    const health = await getLipiMlHealth(this.baseUrl, this.fetchImpl);

    return mapRuntimeHealth({
      configured: health.configured,
      reachable: health.reachable,
      modelPresent: health.body?.status === "ok" && health.body.stt_loaded !== false,
      latencyMs: health.latencyMs,
    });
  }

  async transcribe(input: { wavPath: string; language: string }): Promise<{ text: string; confidence: number | null }> {
    const audio = await readFile(input.wavPath);
    const form = new FormData();
    form.append("audio", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    form.append("language_hint", input.language);

    const response = await this.fetchImpl(`${this.baseUrl}/stt`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      throw new Error(`lipi-ml STT failed with status ${response.status}`);
    }

    const body = (await response.json()) as LipiMlSttResponse;
    return {
      text: typeof body.text === "string" ? body.text : "",
      confidence: typeof body.confidence === "number" ? body.confidence : null,
    };
  }
}

export class LipiMlTtsAdapter implements TtsAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LipiMlAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    const health = await getLipiMlHealth(this.baseUrl, this.fetchImpl);

    return mapRuntimeHealth({
      configured: health.configured,
      reachable: health.reachable,
      modelPresent: health.body?.status === "ok" && health.body.tts_loaded !== false,
      latencyMs: health.latencyMs,
    });
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: "audio/wav" }> {
    const response = await this.fetchImpl(`${this.baseUrl}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        language: languageFromVoicePath(input.voicePath),
      }),
    });

    if (!response.ok) {
      throw new Error(`lipi-ml TTS failed with status ${response.status}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());

    return {
      audioBase64: audio.toString("base64"),
      mimeType: "audio/wav",
    };
  }
}

async function getLipiMlHealth(baseUrl: string, fetchImpl: typeof fetch) {
  if (!baseUrl) {
    return { configured: false, reachable: false, body: null, latencyMs: undefined };
  }

  const startedAt = performance.now();

  try {
    const response = await fetchImpl(`${baseUrl}/health`);
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return { configured: true, reachable: false, body: null, latencyMs };
    }

    return {
      configured: true,
      reachable: true,
      body: (await response.json()) as LipiMlHealthResponse,
      latencyMs,
    };
  } catch {
    return { configured: true, reachable: false, body: null, latencyMs: undefined };
  }
}

function languageFromVoicePath(voicePath: string): "en" | "ne" {
  return voicePath.includes("_ne") || voicePath.includes("ne-NP") ? "ne" : "en";
}
