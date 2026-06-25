import type { RuntimeHealthResult, SttAdapter } from "./types";

interface FasterWhisperAdapterOptions {
  endpoint: string;
  defaultLanguage?: string;
  fetcher?: typeof fetch;
}

interface WhisperTranscriptionResponse {
  text?: string;
  segments?: Array<{ text: string; avg_logprob?: number }>;
  language?: string;
}

export class FasterWhisperAdapter implements SttAdapter {
  private readonly endpoint: string;
  private readonly defaultLanguage: string;
  private readonly fetcher: typeof fetch;

  constructor(options: FasterWhisperAdapterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.defaultLanguage = options.defaultLanguage ?? "ne";
    this.fetcher = options.fetcher ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    if (!this.endpoint) {
      return { status: "missing_model", reason: "faster_whisper_endpoint_not_configured" };
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
      return { status: "unavailable", reason: "faster_whisper_unreachable" };
    }
  }

  async transcribe(input: { wavPath: string; language: string }): Promise<{
    text: string;
    confidence: number | null;
  }> {
    const { createReadStream } = await import("node:fs");
    const { basename } = await import("node:path");

    const stream = createReadStream(input.wavPath);
    const formData = new FormData();

    const blob = await streamToBlob(stream, "audio/wav");
    formData.append("file", blob, basename(input.wavPath));
    formData.append("language", input.language || this.defaultLanguage);
    formData.append("response_format", "json");

    const response = await this.fetcher(`${this.endpoint}/v1/audio/transcriptions`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Faster-Whisper transcription failed: ${response.status} ${detail}`);
    }

    const data = (await response.json()) as WhisperTranscriptionResponse;
    const text = data.text?.trim() ?? "";
    const confidence = computeConfidence(data.segments);

    return { text, confidence };
  }
}

async function streamToBlob(
  stream: NodeJS.ReadableStream,
  mimeType: string,
): Promise<Blob> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  return new Blob([Buffer.concat(chunks)], { type: mimeType });
}

function computeConfidence(
  segments: Array<{ avg_logprob?: number }> | undefined,
): number | null {
  if (!segments || segments.length === 0) return null;

  const validLogprobs = segments
    .map((segment) => segment.avg_logprob)
    .filter((logprob): logprob is number => typeof logprob === "number");

  if (validLogprobs.length === 0) return null;

  const avgLogprob = validLogprobs.reduce((sum, lp) => sum + lp, 0) / validLogprobs.length;
  return Math.min(1, Math.max(0, Math.exp(avgLogprob)));
}
