import type { RuntimeHealthResult, TtsAdapter } from "./types";

interface IndicParlerHttpAdapterOptions {
  endpoint: string;
  description?: string;
  fetcher?: typeof fetch;
}

interface IndicParlerSynthResponse {
  audio?: string;
  audio_base64?: string;
}

export class IndicParlerHttpAdapter implements TtsAdapter {
  private readonly endpoint: string;
  private readonly description: string;
  private readonly fetcher: typeof fetch;

  constructor(options: IndicParlerHttpAdapterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.description =
      options.description ??
      "Amrita speaks clearly in Nepali at a steady call-center pace. Very clear audio.";
    this.fetcher = options.fetcher ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    if (!this.endpoint) {
      return { status: "missing_model", reason: "indic_parler_endpoint_not_configured" };
    }

    try {
      const response = await this.fetcher(`${this.endpoint}/health`, {
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        return { status: "unavailable", reason: `http_${response.status}` };
      }

      const body = await response.json().catch(() => ({})) as { model_loaded?: boolean; status?: string };
      if (body.model_loaded === false) {
        return { status: "missing_model", reason: "model_not_loaded" };
      }

      return { status: "healthy", reason: null };
    } catch {
      return { status: "unavailable", reason: "indic_parler_unreachable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<{
    audioBase64: string;
    mimeType: "audio/wav";
    providerId: string;
    voiceId: string;
  }> {
    const voiceId = input.voicePath;
    const response = await this.fetcher(`${this.endpoint}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        language: "ne",
        voice: voiceId,
        description: this.description,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Indic Parler synthesis failed: ${response.status} ${detail}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("audio/wav") || contentType.includes("audio/x-wav")) {
      return {
        audioBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
        mimeType: "audio/wav",
        providerId: "indic_parler",
        voiceId,
      };
    }

    const data = (await response.json()) as IndicParlerSynthResponse;
    const audioBase64 = data.audio_base64 ?? data.audio;
    if (!audioBase64) {
      throw new Error("Indic Parler response missing audio data");
    }

    return {
      audioBase64,
      mimeType: "audio/wav",
      providerId: "indic_parler",
      voiceId,
    };
  }
}
