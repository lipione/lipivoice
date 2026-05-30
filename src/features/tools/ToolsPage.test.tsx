import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolsPage } from "./ToolsPage";

const tools = [
  {
    id: "tool_order_lookup",
    name: "Order lookup",
    description: "Find order status.",
    method: "GET",
    url: "https://example.com/orders",
    authMode: "none",
    headers: [],
    parameters: [{ name: "orderId", type: "string", required: true }],
    timeoutMs: 5000,
    retryCount: 0,
    responseSchema: "{\"status\":\"string\"}",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
  },
];

describe("ToolsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders tool definitions with request details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(tools)));

    render(<ToolsPage />);

    expect(await screen.findAllByText("Order lookup")).not.toHaveLength(0);
    expect(screen.getByText("GET")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/orders")).toBeInTheDocument();
    expect(screen.getByText("orderId")).toBeInTheDocument();
  });

  it("creates a tool and appends it to the list", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (_url === "/api/tools/executions") {
        return Response.json([]);
      }
      if (init?.method === "POST") {
        return Response.json(JSON.parse(String(init.body)));
      }

      return Response.json(tools);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<ToolsPage />);

    await user.type(await screen.findByLabelText("Name"), "CRM lookup");
    await user.type(screen.getByLabelText("Description"), "Pull customer context.");
    await user.clear(screen.getByLabelText("URL"));
    await user.type(screen.getByLabelText("URL"), "https://example.com/customers");
    await user.type(screen.getByLabelText("Parameter"), "customerId");
    await user.selectOptions(screen.getByLabelText("Auth"), "header");
    await user.type(screen.getByLabelText("Header name"), "authorization");
    await user.type(screen.getByLabelText("Header value"), "Bearer secret");
    await user.click(screen.getByRole("button", { name: "Save tool" }));

    await waitFor(() => expect(screen.getByText("Tool saved")).toBeInTheDocument());
    expect(screen.getAllByText("CRM lookup")).not.toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tools",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"customerId\""),
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tools",
      expect.objectContaining({
        body: expect.stringContaining("\"authorization\""),
      }),
    );
  });

  it("runs a saved tool and renders execution logs", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/tools/executions") {
        return Response.json([
          {
            id: "exec_1",
            toolId: "tool_order_lookup",
            toolName: "Order lookup",
            timestamp: "2026-05-31T00:00:00.000Z",
            ok: true,
            status: 200,
            attempts: 1,
            durationMs: 12,
            error: null,
            request: { method: "GET", url: "https://example.com/orders/A123", headers: [] },
            response: { body: "{\"status\":\"shipped\"}" },
          },
        ]);
      }
      if (url === "/api/tools/execute" && init?.method === "POST") {
        return Response.json({
          id: "exec_2",
          toolId: "tool_order_lookup",
          toolName: "Order lookup",
          timestamp: "2026-05-31T00:00:01.000Z",
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 10,
          error: null,
          request: { method: "GET", url: "https://example.com/orders/A124", headers: [] },
          response: { body: "{\"status\":\"delivered\"}" },
        });
      }

      return Response.json(tools);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<ToolsPage />);

    expect(await screen.findByText("Execution logs")).toBeInTheDocument();
    expect(screen.getByText(/shipped/)).toBeInTheDocument();
    const testArguments = screen.getByLabelText("Test arguments");
    await user.clear(testArguments);
    await user.click(testArguments);
    await user.paste("{\"orderId\":\"A124\"}");
    await user.click(screen.getByRole("button", { name: "Run tool" }));

    await waitFor(() => expect(screen.getByText(/delivered/)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tools/execute",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ toolId: "tool_order_lookup", arguments: { orderId: "A124" } }),
      }),
    );
  });

  it("shows a fetch error state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "internal_error" }, { status: 500 })));

    render(<ToolsPage />);

    expect(await screen.findByText("Request failed: 500")).toBeInTheDocument();
  });
});
