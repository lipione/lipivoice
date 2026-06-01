import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config";

describe("server config", () => {
  it("falls back to the default port for ports outside the TCP range", () => {
    expect(loadServerConfig({ PORT: "70000" }).port).toBe(8787);
  });

  it("accepts valid TCP ports", () => {
    expect(loadServerConfig({ PORT: "5174" }).port).toBe(5174);
  });

  it("loads remote runtime endpoints for the remote preset", () => {
    expect(
      loadServerConfig({
        LIPIVOICE_RUNTIME_PRESET: "remote",
        VLLM_BASE_URL: "http://127.0.0.1:8002/v1",
        VLLM_MODEL: "gemma-4",
        LIPI_ML_BASE_URL: "http://127.0.0.1:5001",
        GOOGLE_TTS_CREDENTIALS_PATH: "/run/secrets/google/tts.json",
        GOOGLE_TTS_LANGUAGE_CODE: "ne",
        GOOGLE_TTS_MODEL: "gemini-3.1-flash-tts-preview",
        GOOGLE_TTS_VOICE_NE: "Kore",
      }),
    ).toMatchObject({
      runtimePreset: "remote",
      vllmBaseUrl: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlBaseUrl: "http://127.0.0.1:5001",
      googleTtsCredentialsPath: "/run/secrets/google/tts.json",
      googleTtsLanguageCode: "ne-NP",
      googleTtsModel: "gemini-3.1-flash-tts-preview",
      googleTtsVoiceName: "Kore",
    });
  });

  it("does not treat np as a Nepali language code", () => {
    expect(loadServerConfig({ GOOGLE_TTS_LANGUAGE_CODE: "np" }).googleTtsLanguageCode).toBe("np");
  });
});
