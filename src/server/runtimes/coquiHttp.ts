import type { RuntimeHealthResult, TtsAdapter } from "./types";

interface CoquiHttpAdapterOptions {
  endpoint: string;
  modelName?: string;
  speakerId?: string;
  languageId?: string;
  fetcher?: typeof fetch;
}

interface CoquiSynthRequest {
  text: string;
  speaker_id?: string;
  language_id?: string;
  speed?: number;
}

export class CoquiHttpAdapter implements TtsAdapter {
  private readonly endpoint: string;
  private readonly modelName: string;
  private readonly speakerId: string | undefined;
  private readonly languageId: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: CoquiHttpAdapterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.modelName = options.modelName ?? "tts_models/multilingual/multi-dataset/xtts_v2";
    this.speakerId = options.speakerId;
    this.languageId = options.languageId;
    this.fetcher = options.fetcher ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    if (!this.endpoint) {
      return { status: "missing_model", reason: "coqui_http_endpoint_not_configured" };
    }

    try {
      const response = await this.fetcher(`${this.endpoint}/api/tts`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });

      if (response.status === 200 || response.status === 405) {
        return { status: "healthy", reason: null };
      }

      return { status: "unavailable", reason: `http_${response.status}` };
    } catch {
      return { status: "unavailable", reason: "coqui_http_unreachable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<{
    audioBase64: string;
    mimeType: "audio/wav";
    providerId: string;
    voiceId: string;
  }> {
    const speakerId = this.speakerId ?? input.voicePath;
    const params = new URLSearchParams({
      text: input.text,
      speaker_id: speakerId,
    });

    if (this.languageId) {
      params.set("language_id", this.languageId);
    }

    const response = await this.fetcher(`${this.endpoint}/api/tts?${params.toString()}`, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Coqui TTS synthesis failed: ${response.status} ${detail}`);
    }

    const buffer = await response.arrayBuffer();

    return {
      audioBase64: Buffer.from(buffer).toString("base64"),
      mimeType: "audio/wav",
      providerId: "coqui_http",
      voiceId: speakerId,
    };
  }

  async synthesizeJson(input: { text: string; speakerId?: string; languageId?: string }): Promise<{
    audioBase64: string;
    mimeType: "audio/wav";
  }> {
    const body: CoquiSynthRequest = {
      text: input.text,
      speaker_id: input.speakerId ?? this.speakerId,
      language_id: input.languageId ?? this.languageId,
    };

    const response = await this.fetcher(`${this.endpoint}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Coqui TTS POST synthesis failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    return {
      audioBase64: Buffer.from(buffer).toString("base64"),
      mimeType: "audio/wav",
    };
  }
}
