import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "./defaults";
import { agentSchema, modelAssetSchema, modelRuntimeSchema, voiceSchema } from "./schemas";

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
});
