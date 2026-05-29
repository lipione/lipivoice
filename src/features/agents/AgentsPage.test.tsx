import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentsPage } from "./AgentsPage";

const agents = [
  {
    id: "agent_1",
    name: "Reception",
    systemPrompt: "Be concise.",
    greeting: "Hi",
    language: "en",
  },
  {
    id: "agent_2",
    name: "Support",
    systemPrompt: "Be helpful.",
    greeting: "Hello",
    language: "en",
  },
];

function stubAgentsApi({
  agentsResponse = agents,
  runtimesResponse = [
    { id: "runtime_ollama", adapter: "ollama", healthStatus: "unknown", configuredState: "configured" },
  ],
}: {
  agentsResponse?: unknown;
  runtimesResponse?: unknown;
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/api/agents")) {
        return Response.json(agentsResponse);
      }
      if (url.endsWith("/api/model-runtimes")) {
        return Response.json(runtimesResponse);
      }
      return Response.json([]);
    }),
  );
}

describe("AgentsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows agent prompt and runtime health", async () => {
    stubAgentsApi();

    render(<AgentsPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Reception")).toBeInTheDocument());
    expect(screen.getByText("ollama")).toBeInTheDocument();
  });

  it("renders fallback runtime values when runtime data is incomplete", async () => {
    stubAgentsApi({
      runtimesResponse: [{ id: "runtime_broken", healthStatus: "not_a_status" }],
    });

    render(<AgentsPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Reception")).toBeInTheDocument());
    expect(screen.getAllByText("unknown")).toHaveLength(2);
    expect(screen.getByText("Unchecked")).toBeInTheDocument();
  });

  it("keeps local edits scoped to the selected agent", async () => {
    const user = userEvent.setup();
    stubAgentsApi();

    render(<AgentsPage />);

    const nameInput = await screen.findByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Front Desk");

    await user.click(screen.getByRole("button", { name: /Support/ }));
    expect(screen.getByDisplayValue("Support")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Front Desk")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Front Desk/ }));
    expect(screen.getByDisplayValue("Front Desk")).toBeInTheDocument();
  });

  it("shows an error state when fetching agents fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/agents")) {
          return Response.json({ code: "internal_error" }, { status: 500 });
        }
        return Response.json([]);
      }),
    );

    render(<AgentsPage />);

    expect(await screen.findByText("Request failed: 500")).toBeInTheDocument();
  });

  it("shows an empty agent list state", async () => {
    stubAgentsApi({ agentsResponse: [] });

    render(<AgentsPage />);

    expect(await screen.findByText("No agents configured.")).toBeInTheDocument();
    expect(screen.getByText("0 configured")).toBeInTheDocument();
  });
});
