import { describe, expect, it } from "vitest";

import { reduceVoiceEvent } from "./voiceSocket";

describe("reduceVoiceEvent", () => {
  it("stores failed runtime status", () => {
    const state = reduceVoiceEvent(
      { status: "connecting", transcript: [], audioQueue: [], error: null },
      { type: "status", status: "failed", reason: "runtime_not_configured" },
    );

    expect(state.status).toBe("failed");
    expect(state.error).toBe("runtime_not_configured");
  });
});
