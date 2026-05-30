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

  it("seeds a remote workspace using vLLM and lipi-ml runtimes", () => {
    const workspace = createRemoteWorkspace({
      now: "2026-05-29T00:00:00.000Z",
      vllmEndpoint: "http://127.0.0.1:8002/v1",
      vllmModel: "gemma-4",
      lipiMlEndpoint: "http://127.0.0.1:5001",
    });

    expect(workspace.agents[0]).toMatchObject({
      modelRuntimeId: "runtime_vllm",
      modelAssetId: "model_vllm_remote",
      transcriberRuntimeId: "runtime_lipi_ml_stt",
      voiceId: "voice_lipi_ml_en",
      deploymentState: "ready",
    });
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
      ]),
    );
    expect(workspace.modelAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "model_vllm_remote", name: "gemma-4" }),
        expect.objectContaining({ id: "model_lipi_ml_whisper_large_v3" }),
        expect.objectContaining({ id: "model_lipi_ml_piper" }),
      ]),
    );
    expect(workspace.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "voice_lipi_ml_en", language: "en-US" }),
        expect.objectContaining({ id: "voice_lipi_ml_ne", language: "ne-NP" }),
      ]),
    );
  });
});
