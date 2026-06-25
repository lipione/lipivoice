import type { RuntimeHealthResult, TtsAdapter } from "./types";
import {
  getGoogleAccessToken,
  googleUserProjectHeader,
  readGoogleServiceAccount,
  type GoogleServiceAccount,
} from "./googleAuth";
interface GoogleCloudTtsOptions {
  credentialsPath: string;
  languageCode?: string;
  modelName?: string;
  voiceName?: string;
  prompt?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

interface VoicesResponse {
  voices?: Array<{ name?: string; languageCodes?: string[] }>;
}

interface SynthesizeResponse {
  audioContent?: string;
}

interface GoogleVoiceProfile {
  languageCode: string;
  voiceName: string;
}

const googleVoiceProfiles: Record<string, GoogleVoiceProfile> = {
  voice_google_tts_ne: { languageCode: "ne-NP", voiceName: "Kore" },
  voice_google_gemini_kore_ne: { languageCode: "ne-NP", voiceName: "Kore" },
  voice_google_gemini_aoede_ne: { languageCode: "ne-NP", voiceName: "Aoede" },
  voice_google_gemini_leda_ne: { languageCode: "ne-NP", voiceName: "Leda" },
  voice_google_gemini_charon_ne: { languageCode: "ne-NP", voiceName: "Charon" },
  voice_google_gemini_puck_ne: { languageCode: "ne-NP", voiceName: "Puck" },
  voice_google_gemini_orus_ne: { languageCode: "ne-NP", voiceName: "Orus" },
};

export class GoogleCloudTtsAdapter implements TtsAdapter {
  private readonly credentialsPath: string;
  private readonly languageCode: string;
  private readonly modelName: string;
  private readonly voiceName: string;
  private readonly prompt: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: TokenCache | null = null;

  constructor(options: GoogleCloudTtsOptions) {
    this.credentialsPath = options.credentialsPath;
    this.languageCode = options.languageCode ?? "ne-NP";
    this.modelName = options.modelName ?? "";
    this.voiceName = options.voiceName ?? "";
    this.prompt = options.prompt ?? "Say the following.";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async health(): Promise<RuntimeHealthResult> {
    const credentials = await readGoogleServiceAccount(this.credentialsPath);
    if (!credentials) {
      return { status: "missing_model", reason: "runtime_not_configured" };
    }

    try {
      const token = await this.getAccessToken(credentials);
      if (this.modelName) {
        return this.voiceName
          ? { status: "healthy", reason: null }
          : { status: "missing_model", reason: "google_tts_voice_not_configured" };
      }

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
    const credentials = await readGoogleServiceAccount(this.credentialsPath);
    if (!credentials) {
      throw new Error("Google Cloud TTS credentials are not configured");
    }

    const token = await this.getAccessToken(credentials);
    const profile = this.voiceProfileForPath(input.voicePath);
    const headers = {
      authorization: `Bearer ${token}`,
      ...googleUserProjectHeader(credentials),
      "content-type": "application/json",
    };
    const response = await this.synthesizeWithGoogle(input.text, headers, profile, {
      includeModel: Boolean(this.modelName),
      includeVoiceName: Boolean(profile.voiceName),
    });

    if (response.ok) {
      return readSynthesizeResponse(response);
    }

    if (this.modelName) {
      const fallbackResponse = await this.synthesizeWithGoogle(input.text, headers, profile, {
        includeModel: false,
        includeVoiceName: false,
      });

      if (fallbackResponse.ok) {
        return readSynthesizeResponse(fallbackResponse);
      }

      throw new Error(
        `Google Cloud TTS failed with status ${response.status}; standard fallback failed with status ${fallbackResponse.status}`,
      );
    }

    throw new Error(`Google Cloud TTS failed with status ${response.status}`);
  }

  private async synthesizeWithGoogle(
    text: string,
    headers: Record<string, string>,
    profile: GoogleVoiceProfile,
    options: { includeModel: boolean; includeVoiceName: boolean },
  ): Promise<Response> {
    return this.fetchImpl("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: options.includeModel ? { prompt: this.prompt, text } : { text },
        voice: {
          languageCode: profile.languageCode,
          ...(options.includeVoiceName && profile.voiceName ? { name: profile.voiceName } : {}),
          ...(options.includeModel && this.modelName ? { model_name: this.modelName } : {}),
        },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });
  }

  private voiceProfileForPath(voicePath: string): GoogleVoiceProfile {
    return (this.modelName ? googleVoiceProfiles[voicePath] : null) ?? {
      languageCode: this.languageCode,
      voiceName: this.voiceName,
    };
  }

  private async getAccessToken(credentials: GoogleServiceAccount): Promise<string> {
    const result = await getGoogleAccessToken({
      credentials,
      fetchImpl: this.fetchImpl,
      now: this.now,
      tokenCache: this.token,
    });

    this.token = result.tokenCache;
    return result.token;
  }
}

async function readSynthesizeResponse(response: Response): Promise<{ audioBase64: string; mimeType: string }> {
  const body = (await response.json()) as SynthesizeResponse;
  if (!body.audioContent) {
    throw new Error("Google Cloud TTS response did not include audioContent");
  }

  return {
    audioBase64: body.audioContent,
    mimeType: "audio/mpeg",
  };
}
