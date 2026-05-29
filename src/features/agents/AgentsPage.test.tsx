import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentsPage } from "./AgentsPage";

describe("AgentsPage", () => {
  it("shows agent prompt and runtime health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/agents")) {
          return Response.json([{ id: "agent_1", name: "Reception", systemPrompt: "Be concise.", greeting: "Hi" }]);
        }
        if (url.endsWith("/api/model-runtimes")) {
          return Response.json([
            { id: "runtime_ollama", adapter: "ollama", healthStatus: "unknown", configuredState: "configured" },
          ]);
        }
        return Response.json([]);
      }),
    );

    render(<AgentsPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Reception")).toBeInTheDocument());
    expect(screen.getByText("ollama")).toBeInTheDocument();
  });
});
