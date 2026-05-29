import { describe, expect, it } from "vitest";
import { executeTool } from "./executor";
import type { Tool } from "@/domain/types";

const baseTool: Tool = {
  id: "tool_order_lookup",
  name: "Order lookup",
  description: "Find order status.",
  method: "GET",
  url: "https://example.com/orders/{orderId}",
  authMode: "header",
  headers: [
    { name: "x-api-key", value: "secret-key", secret: true },
    { name: "x-workspace", value: "lipi", secret: false },
  ],
  parameters: [{ name: "orderId", type: "string", required: true }],
  timeoutMs: 5000,
  retryCount: 0,
  responseSchema: "{}",
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
};

describe("tool executor", () => {
  it("executes GET tools with path parameters and redacted event metadata", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];

    const result = await executeTool(baseTool, { orderId: "A 123" }, {
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({ status: "in_transit", eta: "Friday" }, { status: 200 });
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://example.com/orders/A%20123");
    expect(requests[0].init.headers).toEqual({
      "x-api-key": "secret-key",
      "x-workspace": "lipi",
    });
    expect(result).toMatchObject({
      toolId: "tool_order_lookup",
      toolName: "Order lookup",
      ok: true,
      status: 200,
      request: {
        method: "GET",
        url: "https://example.com/orders/A%20123",
        headers: [
          { name: "x-api-key", value: "[redacted]" },
          { name: "x-workspace", value: "lipi" },
        ],
      },
      response: { body: "{\"status\":\"in_transit\",\"eta\":\"Friday\"}" },
    });
  });

  it("sends JSON bodies for POST tools", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const postTool: Tool = {
      ...baseTool,
      method: "POST",
      url: "https://example.com/demo",
      headers: [],
    };

    await executeTool(postTool, { email: "user@example.com" }, {
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response("ok", { status: 201 });
      },
    });

    expect(requests).toEqual([
      {
        url: "https://example.com/demo",
        init: expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{\"email\":\"user@example.com\"}",
        }),
      },
    ]);
  });
});
