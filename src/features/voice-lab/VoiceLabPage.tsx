import { useEffect, useState } from "react";
import { AudioWaveform } from "lucide-react";

import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Voice } from "@/domain/types";

interface TtsResponse {
  audioBase64: string;
  mimeType: string;
}

interface GeneratedAudio extends TtsResponse {
  text: string;
  voiceName: string;
}

export function VoiceLabPage() {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [audio, setAudio] = useState<GeneratedAudio | null>(null);
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

      setAudio({
        ...(body as TtsResponse),
        text: submittedText,
        voiceName: submittedVoiceName,
      });
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate speech.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-4" aria-label="Voice Lab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Local TTS lab</h2>
          <p className="mt-1 text-sm text-muted-foreground">Generate speech through the configured Piper runtime.</p>
        </div>
        <Badge variant="outline">Piper</Badge>
      </div>

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
    </section>
  );
}
