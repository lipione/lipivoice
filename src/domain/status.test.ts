import { describe, expect, it } from "vitest";
import { callStatusLabel, runtimeHealthTone } from "./status";

describe("status helpers", () => {
  it("labels runtime failures with actionable severity", () => {
    expect(runtimeHealthTone("missing_model")).toEqual({
      label: "Model missing",
      tone: "warning",
    });
  });

  it("labels active calls", () => {
    expect(callStatusLabel("speaking")).toBe("Speaking");
  });
});
