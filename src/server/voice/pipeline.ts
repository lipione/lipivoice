interface VoicePipelineAgent {
  greeting: string;
  systemPrompt: string;
  language: string;
  modelAssetId: string;
  voiceId: string;
}

interface VoicePipelineMessage {
  role: "user" | "assistant";
  content: string;
}

interface VoicePipelineInput {
  agent: VoicePipelineAgent;
  model: string;
  audioWavPath: string;
  stt: {
    transcribe(args: { wavPath: string; language: string }): Promise<{ text: string; confidence: number | null }>;
  };
  llm: {
    chat(args: { model: string; system: string; messages: VoicePipelineMessage[] }): Promise<string>;
  };
  tts: {
    synthesize(args: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: "audio/wav" }>;
  };
  history: VoicePipelineMessage[];
}

export async function runVoiceTurn(input: VoicePipelineInput) {
  const transcription = await input.stt.transcribe({
    wavPath: input.audioWavPath,
    language: input.agent.language,
  });

  if (transcription.text.trim().length === 0) {
    throw new Error("Transcription did not include any speech");
  }

  const assistantText = await input.llm.chat({
    model: input.model,
    system: input.agent.systemPrompt,
    messages: [...input.history, { role: "user", content: transcription.text }],
  });
  const audio = await input.tts.synthesize({
    text: assistantText,
    voicePath: input.agent.voiceId,
  });

  return {
    userText: transcription.text,
    assistantText,
    audio,
    events: [
      {
        type: "transcript" as const,
        actor: "user" as const,
        payload: { text: transcription.text, confidence: transcription.confidence },
      },
      { type: "transcript" as const, actor: "assistant" as const, payload: { text: assistantText } },
      { type: "audio" as const, actor: "assistant" as const, payload: audio },
    ],
  };
}
