import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config";

describe("server config", () => {
  it("falls back to the default port for ports outside the TCP range", () => {
    expect(loadServerConfig({ PORT: "70000" }).port).toBe(8787);
  });

  it("accepts valid TCP ports", () => {
    expect(loadServerConfig({ PORT: "5174" }).port).toBe(5174);
  });
});
