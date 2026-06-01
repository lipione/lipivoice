import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RuntimeHealthResult, TtsAdapter } from "./types";

interface GoogleCloudTtsOptions {
  credentialsPath: string;
  languageCode?: string;
  voiceName?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface GoogleServiceAccount {
  type?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface VoicesResponse {
  voices?: Array<{ name?: string; languageCodes?: string[] }>;
}

interface SynthesizeResponse {
  audioContent?: string;
}

export class GoogleCloudTtsAdapter implements TtsAdapter {
  private readonly credentialsPath: string;
  private readonly languageCode: string;
  private readonly voiceName: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: { accessToken: string; expiresAtMs: number } | null = null;

  constructor(options: GoogleCloudTtsOptions) {
    this.credentialsPath = options.credentialsPath;
    this.languageCode = options.languageCode ?? "ne-NP";
    this.voiceName = options.voiceName ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async health(): Promise<RuntimeHealthResult> {
    const credentials = await this.readCredentials();
    if (!credentials) {
      return { status: "missing_model", reason: "runtime_not_configured" };
    }

    try {
      const token = await this.getAccessToken(credentials);
      const response = await this.fetchImpl(
        `https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(this.languageCode)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );

      if (!response.ok) {
        return { status: "unavailable", reason: "google_tts_unavailable" };
      }

      const body = (await response.json()) as VoicesResponse;
      const voices = body.voices ?? [];
      const hasVoice = this.voiceName
        ? voices.some((voice) => voice.name === this.voiceName)
        : voices.some((voice) => voice.languageCodes?.includes(this.languageCode));

      return hasVoice
        ? { status: "healthy", reason: null }
        : { status: "missing_model", reason: "voice_not_available" };
    } catch {
      return { status: "unavailable", reason: "google_tts_unavailable" };
    }
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: string }> {
    const credentials = await this.readCredentials();
    if (!credentials) {
      throw new Error("Google Cloud TTS credentials are not configured");
    }

    const token = await this.getAccessToken(credentials);
    const response = await this.fetchImpl("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: { text: input.text },
        voice: {
          languageCode: this.languageCode,
          ...(this.voiceName ? { name: this.voiceName } : {}),
        },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Cloud TTS failed with status ${response.status}`);
    }

    const body = (await response.json()) as SynthesizeResponse;
    if (!body.audioContent) {
      throw new Error("Google Cloud TTS response did not include audioContent");
    }

    return {
      audioBase64: body.audioContent,
      mimeType: "audio/mpeg",
    };
  }

  private async readCredentials(): Promise<GoogleServiceAccount | null> {
    if (!this.credentialsPath) {
      return null;
    }

    try {
      const credentials = JSON.parse(await readFile(this.credentialsPath, "utf8")) as GoogleServiceAccount;
      if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key) {
        return null;
      }

      return credentials;
    } catch {
      return null;
    }
  }

  private async getAccessToken(credentials: GoogleServiceAccount): Promise<string> {
    if (this.token && this.token.expiresAtMs - this.now() > 60_000) {
      return this.token.accessToken;
    }

    const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
    const nowSeconds = Math.floor(this.now() / 1000);
    const assertion = signJwt(
      {
        alg: "RS256",
        typ: "JWT",
      },
      {
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: tokenUri,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      },
      credentials.private_key ?? "",
    );

    const response = await this.fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google OAuth token request failed with status ${response.status}`);
    }

    const body = (await response.json()) as TokenResponse;
    if (!body.access_token) {
      throw new Error("Google OAuth token response did not include access_token");
    }

    this.token = {
      accessToken: body.access_token,
      expiresAtMs: this.now() + Math.max(1, body.expires_in ?? 3600) * 1000,
    };

    return this.token.accessToken;
  }
}

function signJwt(header: object, payload: object, privateKey: string): string {
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url");

  return `${unsigned}.${signature}`;
}

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
