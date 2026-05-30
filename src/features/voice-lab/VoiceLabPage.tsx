import { useEffect, useState } from "react";
import { AudioWaveform, History } from "lucide-react";

import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Voice, VoiceSample } from "@/domain/types";

interface TtsResponse {
  audioBase64: string;
  mimeType: string;
}

type GeneratedAudio = VoiceSample;

export function VoiceLabPage() {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [audio, setAudio] = useState<GeneratedAudio | null>(null);
  const [samples, setSamples] = useState<GeneratedAudio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadVoices() {
      try {
        const nextVoices = await getJson<Voice[]>("/api/voices");
        if (!isCurrent) return;

        setVoices(nextVoices);
        setVoiceId((currentVoiceId) => currentVoiceId || nextVoices[0]?.id || "");
      } catch {
        if (isCurrent) {
          setError("voices_load_failed");
        }
      }
    }

    void loadVoices();
    void getJson<unknown>("/api/voice-samples")
      .then((nextSamples) => {
        if (isCurrent) {
          setSamples(Array.isArray(nextSamples) ? nextSamples.filter(isVoiceSample) : []);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setSamples([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  async function generateSpeech() {
    const submittedText = text.trim();
    const submittedVoiceId = voiceId;
    const submittedVoiceName =
      voices.find((voice) => voice.id === submittedVoiceId)?.name ?? submittedVoiceId;

    setIsGenerating(true);
    setError(null);
    setAudio(null);

    try {
      const response = await fetch("/api/tts/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: submittedText, voiceId: submittedVoiceId }),
      });
      const body = (await response.json()) as TtsResponse | { code?: string };

      if (!response.ok) {
        throw new Error("code" in body && body.code ? body.code : `Request failed: ${response.status}`);
      }

      const generatedAudio = createGeneratedAudio(body as Partial<VoiceSample> & TtsResponse, {
        text: submittedText,
        voiceId: submittedVoiceId,
        voiceName: submittedVoiceName,
      });
      setAudio(generatedAudio);
      setSamples((currentSamples) => [
        generatedAudio,
        ...currentSamples.filter((sample) => sample.id !== generatedAudio.id),
      ]);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate speech.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Voice Lab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Local TTS lab</h2>
          <p className="mt-1 text-sm text-muted-foreground">Generate speech through the configured Piper runtime.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Piper</Badge>
          <Badge variant="secondary">{samples.length} samples</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>Generate speech</CardTitle>
            <CardDescription>Local text-to-speech controls</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="tts-text">Text</Label>
              <Textarea
                id="tts-text"
                className="min-h-32"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tts-voice">Voice</Label>
              <select
                id="tts-voice"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={voiceId}
                onChange={(event) => setVoiceId(event.target.value)}
              >
                {voices.length === 0 ? (
                  <option value="">No voices available</option>
                ) : null}
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} - {voice.language}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void generateSpeech()}
                disabled={isGenerating || text.trim() === "" || voiceId === ""}
              >
                <AudioWaveform aria-hidden="true" />
                {isGenerating ? "Generating..." : "Generate speech"}
              </Button>
              {error ? <Badge variant="danger">{error}</Badge> : null}
            </div>

            {audio ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">
                  Generated from "{audio.text}" with {audio.voiceName}
                </p>
                <audio
                  aria-label="Generated speech"
                  controls
                  src={`data:${audio.mimeType};base64,${audio.audioBase64}`}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Sample history</CardTitle>
              <CardDescription>Recent generated clips</CardDescription>
            </div>
            <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent className="grid gap-3">
            {samples.length === 0 ? (
              <p className="text-sm text-muted-foreground">No generated samples yet.</p>
            ) : (
              samples.slice(0, 6).map((sample) => (
                <div key={sample.id} className="grid gap-2 rounded-md border border-border p-3">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{sample.text}</p>
                    <Badge variant="outline">{sample.voiceName}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{sample.createdAt}</p>
                  <audio
                    aria-label={`Generated speech sample ${sample.id}`}
                    className="w-full"
                    controls
                    src={`data:${sample.mimeType};base64,${sample.audioBase64}`}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function createGeneratedAudio(
  response: Partial<VoiceSample> & TtsResponse,
  fallback: { text: string; voiceId: string; voiceName: string },
): GeneratedAudio {
  return {
    id: response.id ?? `voice_sample_${Date.now()}`,
    voiceId: response.voiceId ?? fallback.voiceId,
    voiceName: response.voiceName ?? fallback.voiceName,
    text: response.text ?? fallback.text,
    audioBase64: response.audioBase64,
    mimeType: response.mimeType,
    createdAt: response.createdAt ?? new Date().toISOString(),
  };
}

function isVoiceSample(value: unknown): value is GeneratedAudio {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "voiceId" in value &&
    "voiceName" in value &&
    "text" in value &&
    "audioBase64" in value &&
    "mimeType" in value &&
    "createdAt" in value
  );
}
