import type { RuntimeHealthResult, TtsAdapter } from "./types";

interface PiperHttpAdapterOptions {
  endpoint: string;
  voiceId?: string;
  fetcher?: typeof fetch;
}

interface PiperSynthRequest {
  text: string;
  voice?: string;
  length_scale?: number;
  noise_scale?: number;
  noise_w?: number;
}

interface PiperSynthResponse {
  audio?: string;
  audio_base64?: string;
}

export class PiperHttpAdapter implements TtsAdapter {
  private readonly endpoint: string;
  private readonly voiceId: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: PiperHttpAdapterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.voiceId = options.voiceId;
    this.fetcher = options.fetcher ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    if (!this.endpoint) {
      return { status: "missing_model", reason: "piper_http_endpoint_not_configured" };
    }

    try {
      const response = await this.fetcher(`${this.endpoint}/health`, {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        return { status: "healthy", reason: null };
      }

      return { status: "unavailable", reason: `http_${response.status}` };
    } catch {
      return { status: "unavailable", reason: "piper_http_unreachable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<{
    audioBase64: string;
    mimeType: "audio/wav";
    providerId: string;
    voiceId: string;
  }> {
    const voiceId = this.voiceId ?? input.voicePath;
    const body: PiperSynthRequest = {
      text: input.text,
      voice: voiceId,
    };

    const response = await this.fetcher(`${this.endpoint}/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Piper HTTP synthesis failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("audio/wav") || contentType.includes("audio/x-wav")) {
      const buffer = await response.arrayBuffer();
      return {
        audioBase64: Buffer.from(buffer).toString("base64"),
        mimeType: "audio/wav",
        providerId: "piper_http",
        voiceId,
      };
    }

    const data = (await response.json()) as PiperSynthResponse;
    const audioBase64 = data.audio_base64 ?? data.audio;

    if (!audioBase64) {
      throw new Error("Piper HTTP response missing audio data");
    }

    return {
      audioBase64,
      mimeType: "audio/wav",
      providerId: "piper_http",
      voiceId,
    };
  }
}
