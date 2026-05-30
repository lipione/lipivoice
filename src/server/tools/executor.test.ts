import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("retries transient HTTP failures before returning the final response", async () => {
    const requests: string[] = [];
    const retryTool = { ...baseTool, retryCount: 1 };

    const result = await executeTool(retryTool, { orderId: "A123" }, {
      fetchImpl: async (url) => {
        requests.push(String(url));

        return requests.length === 1
          ? new Response("temporary upstream failure", { status: 502 })
          : Response.json({ status: "in_transit" }, { status: 200 });
      },
    });

    expect(requests).toEqual([
      "https://example.com/orders/A123",
      "https://example.com/orders/A123",
    ]);
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      attempts: 2,
      response: { body: "{\"status\":\"in_transit\"}" },
    });
  });

  it("returns a failed result after repeated network failures", async () => {
    let attempts = 0;

    const result = await executeTool({ ...baseTool, retryCount: 1 }, { orderId: "A123" }, {
      fetchImpl: async () => {
        attempts += 1;
        throw new Error("socket closed");
      },
    });

    expect(attempts).toBe(2);
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      attempts: 2,
      error: "socket closed",
      response: { body: "socket closed" },
    });
  });

  it("refuses unsafe tool URLs before making a network request", async () => {
    const fetchImpl = vi.fn(async () => new Response("not reached", { status: 200 }));

    const result = await executeTool(
      { ...baseTool, url: "http://127.0.0.1:8787/internal/{orderId}" },
      { orderId: "A123" },
      { fetchImpl },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      attempts: 0,
      error: "unsafe_tool_url",
      request: {
        method: "GET",
        url: "http://127.0.0.1:8787/internal/A123",
      },
      response: { body: "unsafe_tool_url" },
    });
  });

  it("allows explicit private tool URLs for trusted local deployments", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));

    const result = await executeTool(
      { ...baseTool, url: "http://127.0.0.1:8787/internal/{orderId}" },
      { orderId: "A123" },
      { fetchImpl, allowPrivateUrls: true },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("aborts a slow tool call at the configured timeout", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];

    const resultPromise = executeTool({ ...baseTool, timeoutMs: 50 }, { orderId: "A123" }, {
      fetchImpl: async (_url, init) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          throw new Error("missing abort signal");
        }
        signals.push(signal);

        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      },
    });

    await vi.advanceTimersByTimeAsync(50);
    const pending = Symbol("pending");
    const result = await Promise.race([resultPromise, Promise.resolve(pending)]);

    expect(signals[0]?.aborted).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      attempts: 1,
      error: "tool_timeout",
      response: { body: "tool_timeout" },
    });
  });
});
