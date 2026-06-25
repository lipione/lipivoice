import { describe, expect, it } from "vitest";
import { createDefaultWorkspace, createRemoteWorkspace } from "./defaults";
import {
  agentSchema,
  evalDefinitionSchema,
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  modelAssetSchema,
  modelRuntimeSchema,
  phoneNumberSchema,
  voiceSchema,
  voiceSampleSchema,
  workspaceSettingsSchema,
} from "./schemas";

describe("domain defaults", () => {
  it("seeds schema-valid workspace records", () => {
    const workspace = createDefaultWorkspace("2026-05-29T00:00:00.000Z");

    for (const agent of workspace.agents) {
      expect(() => agentSchema.parse(agent)).not.toThrow();
    }

    for (const runtime of workspace.modelRuntimes) {
      expect(() => modelRuntimeSchema.parse(runtime)).not.toThrow();
    }

    for (const modelAsset of workspace.modelAssets) {
      expect(() => modelAssetSchema.parse(modelAsset)).not.toThrow();
    }

    for (const voice of workspace.voices) {
      expect(() => voiceSchema.parse(voice)).not.toThrow();
    }

    for (const voiceSample of workspace.voiceSamples) {
      expect(() => voiceSampleSchema.parse(voiceSample)).not.toThrow();
    }

    for (const phoneNumber of workspace.phoneNumbers) {
      expect(() => phoneNumberSchema.parse(phoneNumber)).not.toThrow();
    }

    for (const knowledgeBase of workspace.knowledgeBases) {
      expect(() => knowledgeBaseSchema.parse(knowledgeBase)).not.toThrow();
    }

    for (const knowledgeDocument of workspace.knowledgeDocuments) {
      expect(() => knowledgeDocumentSchema.parse(knowledgeDocument)).not.toThrow();
    }

    for (const evalDefinition of workspace.evals) {
      expect(() => evalDefinitionSchema.parse(evalDefinition)).not.toThrow();
    }

    expect(() => workspaceSettingsSchema.parse(workspace.settings)).not.toThrow();
  });

  it("seeds agents with existing runtime, model, and voice references", () => {
    const workspace = createDefaultWorkspace("2026-05-29T00:00:00.000Z");
    const runtimeIds = new Set(workspace.modelRuntimes.map((runtime) => runtime.id));
    const modelAssetIds = new Set(workspace.modelAssets.map((modelAsset) => modelAsset.id));
    const voiceIds = new Set(workspace.voices.map((voice) => voice.id));

    for (const agent of workspace.agents) {
      expect(runtimeIds.has(agent.modelRuntimeId)).toBe(true);
      expect(modelAssetIds.has(agent.modelAssetId)).toBe(true);
      expect(voiceIds.has(agent.voiceId)).toBe(true);
      expect(runtimeIds.has(agent.transcriberRuntimeId)).toBe(true);
    }
  });

  it("seeds runtimes and voices with existing references", () => {
    const workspace = createDefaultWorkspace("2026-05-29T00:00:00.000Z");
    const runtimeIds = new Set(workspace.modelRuntimes.map((runtime) => runtime.id));
    const modelAssetIds = new Set(workspace.modelAssets.map((modelAsset) => modelAsset.id));

    for (const runtime of workspace.modelRuntimes) {
      expect(modelAssetIds.has(runtime.defaultModelId)).toBe(true);
    }

    for (const voice of workspace.voices) {
      expect(runtimeIds.has(voice.runtimeId)).toBe(true);
    }
  });

  it("seeds a remote workspace using Lipi-branded runtimes", () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });

    expect(workspace.agents[0]).toMatchObject({
      name: "Sarita",
      greeting:
        "नमस्ते, सगरमाथा लुम्बिनी इन्स्योरेन्समा स्वागत छ। म सरिता बोल्दैछु, म कसरी सहयोग गर्न सक्छु?",
      language: "ne",
      modelRuntimeId: "runtime_vllm",
      modelAssetId: "model_vllm_remote",
      transcriberRuntimeId: "runtime_lipi_ml_stt",
      voiceId: "voice_lipi_ml_ne",
      knowledgeBaseIds: ["kb_reception_faq"],
      deploymentState: "ready",
    });
    expect(workspace.agents[0]?.systemPrompt).toContain("warm Nepali front-desk receptionist");
    expect(workspace.agents[0]?.systemPrompt).toContain("Speak Nepali in Devanagari by default");
    expect(workspace.agents[0]?.systemPrompt).toContain("Sagarmatha Lumbini Insurance Company Limited");
    expect(workspace.agents[0]?.systemPrompt).toContain("pronounce it as one word");
    expect(workspace.agents[0]?.systemPrompt).toContain("Do not spell it letter by letter");
    expect(workspace.agents[0]?.systemPrompt).toContain("property, motor, marine, engineering, aviation, agriculture, micro, and miscellaneous");
    expect(workspace.agents[0]?.systemPrompt).toContain("customer.service@salico.com.np");
    expect(workspace.agents[0]?.systemPrompt).toContain("Ask one question at a time");
    expect(workspace.agents[0]?.systemPrompt).toContain("Silently remember the caller's name");
    expect(workspace.agents[0]?.systemPrompt).toContain("Use हस् or हजुर for acknowledgement");
    expect(workspace.agents[0]?.systemPrompt).toContain("Do not say ठीक छ");
    expect(workspace.agents[0]?.systemPrompt).toContain("Use natural Nepali phrasing");
    expect(workspace.agents[0]?.systemPrompt).toContain("Only handle Nepali, English, or natural Nepali-English mixed speech");
    expect(workspace.agents[0]?.systemPrompt).toContain("Do not infer an insurance product from Newari");
    expect(workspace.agents[0]?.systemPrompt).toContain("पति पार्स तो इंचरेंस गरिक्प");
    expect(workspace.agents[0]?.systemPrompt).toContain("Avoid Hindi-style or Indian call-center intonation");
    expect(workspace.agents[0]?.systemPrompt).toContain("Never read them as a full amount value");
    expect(workspace.agents[0]?.systemPrompt).toContain("Do not ask how you can help if the caller already stated the purpose.");
    expect(workspace.agents[0]?.systemPrompt).toContain("Do not invent premiums, coverage decisions, claim approvals, policy status, or legal advice.");
    expect(workspace.agents[0]?.systemPrompt).toContain("claim approvals");

    expect(workspace.tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        "tool_collect_callback",
        "tool_claim_intake",
        "tool_document_request",
        "tool_office_hours",
      ]),
    );
    expect(workspace.evals.map((evaluation) => evaluation.id)).toEqual(
      expect.arrayContaining([
        "eval_nepali_reception_greeting",
        "eval_claim_no_approval",
        "eval_callback_collection",
      ]),
    );
    expect(workspace.modelRuntimes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime_vllm",
          adapter: "vllm",
          endpoint: "http://127.0.0.1:8002/v1",
          defaultModelId: "model_vllm_remote",
        }),
        expect.objectContaining({
          id: "runtime_lipi_ml_stt",
          adapter: "faster_whisper",
          endpoint: "http://127.0.0.1:5001/stt",
        }),
        expect.objectContaining({
          id: "runtime_lipi_ml_tts",
          adapter: "piper",
          endpoint: "http://127.0.0.1:5001/tts",
        }),
        expect.objectContaining({
          id: "runtime_coqui_http",
          adapter: "coqui_http",
        }),
        expect.objectContaining({
          id: "runtime_fastpitch_http",
          adapter: "fastpitch_http",
        }),
        expect.objectContaining({
          id: "runtime_indic_parler",
          adapter: "indic_parler",
          endpoint: "http://127.0.0.1:5010",
          configuredState: "not_configured",
        }),
      ]),
    );
    expect(workspace.modelAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "model_vllm_remote", name: "LipiCore Realtime" }),
        expect.objectContaining({ id: "model_lipi_ml_whisper_large_v3" }),
        expect.objectContaining({ id: "model_lipi_ml_piper" }),
        expect.objectContaining({ id: "model_coqui_xtts_ne" }),
        expect.objectContaining({
          id: "model_indic_parler_ne_finetuned",
          pathOrTag: "milanakdj/indic-parler-tts-nepali-finetuned-dgx-v9-cosine",
        }),
      ]),
    );
    expect(workspace.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "voice_lipi_ml_en", language: "en-US" }),
        expect.objectContaining({ id: "voice_lipi_ml_ne", language: "ne-NP" }),
        expect.objectContaining({ id: "voice_piper_ne_sita", language: "ne-NP" }),
        expect.objectContaining({
          id: "voice_indic_parler_ne_amrita",
          runtimeId: "runtime_indic_parler",
          language: "ne-NP",
        }),
      ]),
    );
    expect(workspace.settings).toMatchObject({
      publicBaseUrl: "https://ai.silverlining.com.np/voice",
      allowedOrigins: ["https://ai.silverlining.com.np"],
    });
  });
});
