import { describe, expect, it } from "vitest";
import { createRealtimeSessionStore } from "./sessionTokens";

describe("realtime session tokens", () => {
  it("creates agent-bound sessions and consumes context once", () => {
    const nowMs = Date.parse("2026-05-31T00:00:00.000Z");
    const store = createRealtimeSessionStore({
      ttlMs: 60_000,
      now: () => new Date(nowMs),
    });

    const session = store.createSession({ agentId: "agent_support", ttlMs: 30_000 });

    expect(session).toEqual({
      token: expect.any(String),
      agentId: "agent_support",
      expiresAt: "2026-05-31T00:00:30.000Z",
    });
    expect(store.consume(session.token)).toEqual({ agentId: "agent_support" });
    expect(store.consume(session.token)).toBeNull();
  });

  it("rejects expired sessions without returning context", () => {
    let nowMs = Date.parse("2026-05-31T00:00:00.000Z");
    const store = createRealtimeSessionStore({
      ttlMs: 1_000,
      now: () => new Date(nowMs),
    });
    const session = store.createSession({ agentId: "agent_reception" });

    nowMs = Date.parse("2026-05-31T00:00:02.000Z");

    expect(store.consume(session.token)).toBeNull();
  });
});
