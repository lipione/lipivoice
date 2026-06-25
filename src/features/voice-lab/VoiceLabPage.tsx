import { useEffect, useState } from "react";
import { AudioWaveform, FlaskConical, History, ShieldCheck } from "lucide-react";

import { apiPath, authHeaders, getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ConsentRecord, RuntimeHealthStatus, TtsBenchmarkResult, TtsProvider, Voice, VoiceSample } from "@/domain/types";
import { formatVoiceOption, sortVoicesForDisplay } from "@/domain/voiceLabels";

interface TtsResponse {
  audioBase64: string;
  mimeType: string;
}

interface VoiceCloneResponse {
  voice: Voice;
  consent: ConsentRecord;
}

type GeneratedAudio = VoiceSample;

export function VoiceLabPage() {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [audio, setAudio] = useState<GeneratedAudio | null>(null);
  const [samples, setSamples] = useState<GeneratedAudio[]>([]);
  const [providers, setProviders] = useState<TtsProvider[]>([]);
  const [benchmarkText, setBenchmarkText] = useState("नमस्ते, लिपिभ्वाइस परीक्षण हो।");
  const [benchmarkResult, setBenchmarkResult] = useState<TtsBenchmarkResult | null>(null);
  const [benchmarkingProviderId, setBenchmarkingProviderId] = useState<string | null>(null);
  const [cloneForm, setCloneForm] = useState({
    voiceName: "",
    language: "en-US",
    speakerName: "",
    consentSource: "",
    auditNotes: "",
  });
  const [cloneResult, setCloneResult] = useState<Voice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCloning, setIsCloning] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadVoices() {
      try {
        const nextVoices = await getJson<Voice[]>("/api/voices");
        if (!isCurrent) return;

        const displayVoices = sortVoicesForDisplay(nextVoices);
        setVoices(displayVoices);
        setVoiceId((currentVoiceId) => currentVoiceId || displayVoices[0]?.id || "");
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
    void getJson<unknown>("/api/tts/providers")
      .then((nextProviders) => {
        if (isCurrent) {
          setProviders(Array.isArray(nextProviders) ? nextProviders.filter(isTtsProvider) : []);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setProviders([]);
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
      const response = await fetch(apiPath("/api/tts/generate"), {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
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

  async function createCloneRequest() {
    setIsCloning(true);
    setCloneError(null);

    try {
      const response = await fetch(apiPath("/api/voice-clones"), {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(cloneForm),
      });
      const body = (await response.json()) as VoiceCloneResponse | { code?: string };

      if (!response.ok) {
        throw new Error("code" in body && body.code ? body.code : `Request failed: ${response.status}`);
      }

      const nextVoice = (body as VoiceCloneResponse).voice;
      setCloneResult(nextVoice);
      setVoices((currentVoices) => [
        ...currentVoices.filter((voice) => voice.id !== nextVoice.id),
        nextVoice,
      ]);
      setVoiceId(nextVoice.id);
    } catch (cloneRequestError) {
      setCloneError(cloneRequestError instanceof Error ? cloneRequestError.message : "Unable to create clone request.");
    } finally {
      setIsCloning(false);
    }
  }

  async function benchmarkProvider(providerId: string) {
    const submittedText = benchmarkText.trim();

    if (!submittedText) return;

    setBenchmarkingProviderId(providerId);
    setBenchmarkResult(null);

    try {
      const response = await fetch(apiPath("/api/tts/benchmark"), {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ providerId, text: submittedText }),
      });
      const body = (await response.json()) as TtsBenchmarkResult | { code?: string };

      if (!response.ok && !isTtsBenchmarkResult(body)) {
        throw new Error("code" in body && body.code ? body.code : `Request failed: ${response.status}`);
      }

      setBenchmarkResult(isTtsBenchmarkResult(body) ? body : null);
    } catch (benchmarkError) {
      setBenchmarkResult({
        id: `benchmark_failed_${Date.now()}`,
        providerId,
        providerName: providers.find((provider) => provider.id === providerId)?.name ?? providerId,
        text: submittedText,
        status: "unavailable",
        healthStatus: "failed",
        code: benchmarkError instanceof Error ? benchmarkError.message : "benchmark_failed",
        audioBase64: null,
        mimeType: null,
        latencyMs: 0,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setBenchmarkingProviderId(null);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Voice Lab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">LipiVoice lab</h2>
          <p className="mt-1 text-sm text-muted-foreground">Generate and compare Nepali speech through the configured LipiVoice pipeline.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">LipiVoice</Badge>
          <Badge variant="secondary">{samples.length} samples</Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Nepali voice providers</CardTitle>
            <CardDescription>LipiVoice provider readiness and benchmark path</CardDescription>
          </div>
          <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="benchmark-text">Benchmark text</Label>
            <Textarea
              id="benchmark-text"
              className="min-h-20"
              value={benchmarkText}
              onChange={(event) => setBenchmarkText(event.target.value)}
            />
          </div>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No TTS providers reported.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {providers.map((provider) => (
                <div key={provider.id} className="grid gap-3 rounded-md border border-border p-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{provider.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{provider.role}</p>
                    </div>
                    <Badge variant={provider.healthStatus === "healthy" ? "success" : provider.healthStatus === "license_required" ? "warning" : "secondary"}>
                      {formatHealthStatus(provider.healthStatus)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{provider.access.replace("_", " ")}</Badge>
                    <Badge variant="outline">{provider.license}</Badge>
                    <Badge variant="outline">{provider.languageSupport.slice(0, 2).join(", ")}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <a
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                      href={provider.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source
                    </a>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Benchmark ${provider.name}`}
                      onClick={() => void benchmarkProvider(provider.id)}
                      disabled={benchmarkingProviderId !== null || benchmarkText.trim() === ""}
                    >
                      <FlaskConical aria-hidden="true" />
                      {benchmarkingProviderId === provider.id ? "Testing..." : "Benchmark"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {benchmarkResult ? (
            <div className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium">{benchmarkResult.providerName}</p>
                <Badge variant={benchmarkResult.status === "generated" ? "success" : "warning"}>
                  {benchmarkResult.code ?? benchmarkResult.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {benchmarkResult.healthStatus} · {benchmarkResult.latencyMs} ms
              </p>
              {benchmarkResult.audioBase64 && benchmarkResult.mimeType ? (
                <audio
                  aria-label={`Benchmark audio ${benchmarkResult.id}`}
                  controls
                  src={`data:${benchmarkResult.mimeType};base64,${benchmarkResult.audioBase64}`}
                />
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-4">
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
                      {formatVoiceOption(voice)}
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
            <CardHeader>
              <CardTitle>Clone request</CardTitle>
              <CardDescription>Consent-gated private voice record</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="clone-name">Clone name</Label>
                  <Input
                    id="clone-name"
                    value={cloneForm.voiceName}
                    onChange={(event) => setCloneForm((current) => ({ ...current, voiceName: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="clone-language">Language</Label>
                  <Input
                    id="clone-language"
                    value={cloneForm.language}
                    onChange={(event) => setCloneForm((current) => ({ ...current, language: event.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="clone-speaker">Speaker name</Label>
                <Input
                  id="clone-speaker"
                  value={cloneForm.speakerName}
                  onChange={(event) => setCloneForm((current) => ({ ...current, speakerName: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="clone-consent">Consent source</Label>
                <Textarea
                  id="clone-consent"
                  className="min-h-20"
                  value={cloneForm.consentSource}
                  onChange={(event) => setCloneForm((current) => ({ ...current, consentSource: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="clone-audit">Audit notes</Label>
                <Textarea
                  id="clone-audit"
                  className="min-h-20"
                  value={cloneForm.auditNotes}
                  onChange={(event) => setCloneForm((current) => ({ ...current, auditNotes: event.target.value }))}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void createCloneRequest()}
                  disabled={
                    isCloning ||
                    !cloneForm.voiceName.trim() ||
                    !cloneForm.speakerName.trim() ||
                    !cloneForm.consentSource.trim()
                  }
                >
                  <ShieldCheck aria-hidden="true" />
                  {isCloning ? "Creating..." : "Create clone request"}
                </Button>
                {cloneError ? <Badge variant="danger">{cloneError}</Badge> : null}
              </div>
              {cloneResult ? (
                <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{cloneResult.name}</p>
                    <p className="text-xs text-muted-foreground">{cloneResult.language}</p>
                  </div>
                  <Badge variant="outline">{cloneResult.cloneStatus}</Badge>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

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
                    <Badge variant="outline">
                      {sample.voiceName}
                    </Badge>
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

function isTtsProvider(value: unknown): value is TtsProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "role" in value &&
    "access" in value &&
    "healthStatus" in value &&
    "sourceUrl" in value &&
    "languageSupport" in value &&
    "capabilities" in value &&
    "hardwareHints" in value
  );
}

function isTtsBenchmarkResult(value: unknown): value is TtsBenchmarkResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "providerId" in value &&
    "providerName" in value &&
    "status" in value &&
    "healthStatus" in value &&
    "code" in value &&
    "latencyMs" in value
  );
}

function formatHealthStatus(status: RuntimeHealthStatus) {
  return status.replace("_", " ");
}
