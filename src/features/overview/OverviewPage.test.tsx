import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OverviewPage } from "./OverviewPage";

describe("OverviewPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps overview focused on live metrics and queue state", () => {
    stubDashboardFetch({
      runtimes: [],
    });

    render(<OverviewPage />);

    expect(screen.getByLabelText("Overview metrics").querySelectorAll(".rounded-lg.border")).toHaveLength(4);
    expect(screen.getByText("Queue mix")).toBeInTheDocument();
    expect(screen.queryByText("Operator runbook")).not.toBeInTheDocument();
  });

  it("does not claim runtime readiness when speech runtimes are not configured", async () => {
    stubDashboardFetch({
      runtimes: [
          { id: "runtime_ollama", kind: "llm", configuredState: "configured", healthStatus: "unknown" },
          { id: "runtime_whisper_cpp", kind: "stt", configuredState: "not_configured", healthStatus: "missing_model" },
          { id: "runtime_piper", kind: "tts", configuredState: "not_configured", healthStatus: "missing_model" },
      ],
    });

    render(<OverviewPage />);

    expect(await screen.findByText("Runtime not configured")).toBeInTheDocument();
    expect(screen.getByText("Speech runtimes missing")).toBeInTheDocument();
    expect(screen.queryByText("Runtime ready")).not.toBeInTheDocument();
  });

  it("reports ready when speech providers are configured", async () => {
    stubDashboardFetch({
      runtimes: [
        { id: "runtime_lipi_ml_stt", kind: "stt", configuredState: "configured", healthStatus: "healthy" },
        { id: "runtime_indic_parler_tts", kind: "tts", configuredState: "configured", healthStatus: "healthy" },
        { id: "runtime_piper", kind: "tts", configuredState: "not_configured", healthStatus: "missing_model" },
      ],
    });

    render(<OverviewPage />);

    expect(await screen.findByText("Runtime ready")).toBeInTheDocument();
    expect(screen.getByText("Speech runtimes configured")).toBeInTheDocument();
  });
});

function stubDashboardFetch(input: {
  runtimes: Array<{ id: string; kind: string; configuredState: string; healthStatus: string }>;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/model-runtimes")) return Response.json(input.runtimes);
      if (path.endsWith("/api/calls")) return Response.json([]);
      if (path.endsWith("/api/agents")) return Response.json([]);
      if (path.endsWith("/api/customers")) return Response.json([]);
      if (path.endsWith("/api/tickets")) return Response.json([]);
      if (path.endsWith("/api/appointments")) return Response.json([]);
      if (path.endsWith("/api/transfers")) return Response.json([]);
      if (path.endsWith("/api/campaigns")) return Response.json([]);
      return Response.json([]);
    }),
  );
}
