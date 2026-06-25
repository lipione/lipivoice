import type { RuntimeHealthResult, TtsAdapter } from "./types";

interface FastPitchHttpAdapterOptions {
  endpoint: string;
  speakerId?: number;
  fetcher?: typeof fetch;
}

interface FastPitchSynthRequest {
  text: string;
  speaker_id?: number;
  pace?: number;
  pitch_transform?: number;
  volume_transform?: number;
}

interface FastPitchSynthResponse {
  audio?: string;
  audio_base64?: string;
  sample_rate?: number;
}

export class FastPitchHttpAdapter implements TtsAdapter {
  private readonly endpoint: string;
  private readonly speakerId: number | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: FastPitchHttpAdapterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.speakerId = options.speakerId;
    this.fetcher = options.fetcher ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    if (!this.endpoint) {
      return { status: "missing_model", reason: "fastpitch_http_endpoint_not_configured" };
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
      return { status: "unavailable", reason: "fastpitch_http_unreachable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<{
    audioBase64: string;
    mimeType: "audio/wav";
    providerId: string;
    voiceId: string;
  }> {
    const speakerId = this.speakerId ?? 0;
    const body: FastPitchSynthRequest = {
      text: input.text,
      speaker_id: speakerId,
      pace: 1.0,
    };

    const response = await this.fetcher(`${this.endpoint}/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`FastPitch synthesis failed: ${response.status} ${detail}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("audio/")) {
      const buffer = await response.arrayBuffer();
      return {
        audioBase64: Buffer.from(buffer).toString("base64"),
        mimeType: "audio/wav",
        providerId: "fastpitch_http",
        voiceId: `speaker_${speakerId}`,
      };
    }

    const data = (await response.json()) as FastPitchSynthResponse;
    const audioBase64 = data.audio_base64 ?? data.audio;

    if (!audioBase64) {
      throw new Error("FastPitch response missing audio data");
    }

    return {
      audioBase64,
      mimeType: "audio/wav",
      providerId: "fastpitch_http",
      voiceId: `speaker_${speakerId}`,
    };
  }
}
