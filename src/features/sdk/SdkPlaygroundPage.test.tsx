import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SdkPlaygroundPage } from "./SdkPlaygroundPage";

describe("SdkPlaygroundPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders browser voice snippets for the selected agent and public base URL", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/agents") {
          return Response.json([
            { id: "agent_reception", name: "Reception Agent" },
            { id: "agent_support", name: "Support Agent" },
          ]);
        }

        if (url === "/api/settings") {
          return Response.json({
            publicBaseUrl: "https://voice.example.com",
          });
        }

        return Response.json({ code: "not_found" }, { status: 404 });
      }),
    );

    render(<SdkPlaygroundPage />);

    await user.selectOptions(await screen.findByLabelText("Agent"), "agent_support");

    const snippet = screen.getByLabelText("Browser voice SDK snippet");
    expect(snippet).toHaveTextContent('agentId: "agent_support"');
    expect(snippet).toHaveTextContent("https://voice.example.com/api/realtime/session");
    expect(snippet).toHaveTextContent("wss://voice.example.com/api/realtime");
    expect(snippet).toHaveTextContent("Authorization");
    expect(snippet).toHaveTextContent("LIPIVOICE_ADMIN_TOKEN");
  });
});
