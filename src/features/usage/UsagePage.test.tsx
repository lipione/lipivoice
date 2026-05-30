import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UsagePage } from "./UsagePage";

describe("UsagePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders local usage metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          agents: 2,
          phoneNumbers: 1,
          callsTotal: 4,
          activeCalls: 1,
          callMinutes: 6.5,
          estimatedCostUsd: 0.42,
          toolExecutions: 3,
          knowledgeBases: 2,
          knowledgeDocuments: 5,
        }),
      ),
    );

    render(<UsagePage />);

    expect(await screen.findByText("Usage overview")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("6.5 min")).toBeInTheDocument();
    expect(screen.getByText("$0.42")).toBeInTheDocument();
    expect(screen.getByText("5 documents")).toBeInTheDocument();
  });
});
