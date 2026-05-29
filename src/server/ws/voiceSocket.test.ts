import { createServer } from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { attachVoiceSocket } from "./voiceSocket";

let server: ReturnType<typeof createServer> | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

describe("voice socket", () => {
  it("emits failed when local runtimes are not configured", async () => {
    server = createServer();
    attachVoiceSocket(server, {
      checkReady: async () => ({ ready: false, reason: "runtime_not_configured" }),
      processAudio: async () => {
        throw new Error("not reached");
      },
    });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test address");

    const message = await new Promise<Record<string, unknown>>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime`);
      ws.on("message", (data) => resolve(JSON.parse(String(data))));
    });

    expect(message).toEqual({ type: "status", status: "failed", reason: "runtime_not_configured" });
  });
});
