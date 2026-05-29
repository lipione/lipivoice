import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverviewPage } from "./OverviewPage";

describe("OverviewPage", () => {
  it("keeps the runbook section unframed while preserving metric cards", () => {
    render(<OverviewPage />);

    const runbookSection = screen.getByRole("region", { name: "Current runbook" });

    expect(runbookSection).not.toHaveClass("border");
    expect(runbookSection).not.toHaveClass("bg-card");
    expect(screen.getByLabelText("Overview metrics").querySelectorAll(".rounded-lg.border")).toHaveLength(4);
  });
});
