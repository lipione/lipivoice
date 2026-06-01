export interface RuntimeHealthResult {
  status: "healthy" | "unavailable" | "missing_model" | "license_required" | "failed";
  reason: string | null;
  latencyMs?: number;
}

export interface LlmAdapter {
  health(): Promise<RuntimeHealthResult>;
  chat(input: {
    model: string;
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<string>;
}

export interface SttAdapter {
  health(): Promise<RuntimeHealthResult>;
  transcribe(input: { wavPath: string; language: string }): Promise<{ text: string; confidence: number | null }>;
}

export interface TtsAdapter {
  health(): Promise<RuntimeHealthResult>;
  synthesize(input: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: string }>;
}

export interface VadAdapter {
  detect(frames: Float32Array[]): { hasSpeech: boolean; peak: number };
}
