import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OverviewPage } from "./OverviewPage";

describe("OverviewPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the runbook section unframed while preserving metric cards", () => {
    render(<OverviewPage />);

    const runbookSection = screen.getByRole("region", { name: "Current runbook" });

    expect(runbookSection).not.toHaveClass("border");
    expect(runbookSection).not.toHaveClass("bg-card");
    expect(screen.getByLabelText("Overview metrics").querySelectorAll(".rounded-lg.border")).toHaveLength(4);
  });

  it("does not claim runtime readiness when speech runtimes are not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { id: "runtime_ollama", kind: "llm", configuredState: "configured", healthStatus: "unknown" },
          { id: "runtime_whisper_cpp", kind: "stt", configuredState: "not_configured", healthStatus: "missing_model" },
          { id: "runtime_piper", kind: "tts", configuredState: "not_configured", healthStatus: "missing_model" },
        ]),
      ),
    );

    render(<OverviewPage />);

    expect(await screen.findByText("Runtime not configured")).toBeInTheDocument();
    expect(screen.getByText("Speech runtimes missing")).toBeInTheDocument();
    expect(screen.queryByText("Runtime ready")).not.toBeInTheDocument();
  });
});
