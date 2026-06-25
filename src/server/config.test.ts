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
        INDIC_PARLER_ENDPOINT: "http://127.0.0.1:5010",
        GOOGLE_TTS_CREDENTIALS_PATH: "/run/secrets/google/tts.json",
        GOOGLE_LLM_CREDENTIALS_PATH: "/run/secrets/google/gemini.json",
        GOOGLE_LLM_MODEL: "gemini-2.5-pro",
        GOOGLE_TTS_LANGUAGE_CODE: "ne",
        GOOGLE_TTS_MODEL: "gemini-2.5-flash-tts",
        GOOGLE_TTS_VOICE_NE: "Kore",
      }),
    ).toMatchObject({
      runtimePreset: "remote",
      vllmBaseUrl: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlBaseUrl: "http://127.0.0.1:5001",
      indicParlerEndpoint: "http://127.0.0.1:5010",
      googleTtsCredentialsPath: "/run/secrets/google/tts.json",
      googleLlmCredentialsPath: "/run/secrets/google/gemini.json",
      googleLlmModel: "gemini-2.5-pro",
      googleTtsLanguageCode: "ne-NP",
      googleTtsModel: "gemini-2.5-flash-tts",
      googleTtsVoiceName: "Kore",
    });
  });

  it("does not treat np as a Nepali language code", () => {
    expect(loadServerConfig({ GOOGLE_TTS_LANGUAGE_CODE: "np" }).googleTtsLanguageCode).toBe("np");
  });

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

  it("loads admin username and password from environment", () => {
    const config = loadServerConfig({
      LIPIVOICE_ADMIN_TOKEN: "admin-token",
      LIPIVOICE_ADMIN_USERNAME: "operator",
      LIPIVOICE_ADMIN_PASSWORD: "secret-password",
    });

    expect(config.adminToken).toBe("admin-token");
    expect(config.adminUsername).toBe("operator");
    expect(config.adminPassword).toBe("secret-password");
  });

  it("derives a local LiveKit HTTP API URL from a ws URL", () => {
    const config = loadServerConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
    });

    expect(config.livekitWsUrl).toBe("ws://127.0.0.1:7880");
    expect(config.livekitApiUrl).toBe("http://127.0.0.1:7880");
  });
});
