import { describe, expect, it } from "vitest";
import { detectSpeechTurn } from "./energyVad";
import { mapRuntimeHealth } from "./health";

describe("runtime adapters", () => {
  it("detects speech when frame energy crosses threshold", () => {
    const quiet = new Float32Array([0.001, -0.001, 0.002]);
    const speech = new Float32Array([0.2, -0.18, 0.16]);

    expect(detectSpeechTurn([quiet, speech], { threshold: 0.05 })).toEqual({
      hasSpeech: true,
      peak: 0.2,
    });
  });

  it("maps missing local binaries to runtime_not_configured", () => {
    expect(mapRuntimeHealth({ configured: false, reachable: false, modelPresent: false })).toEqual({
      status: "missing_model",
      reason: "runtime_not_configured",
    });
  });
});
