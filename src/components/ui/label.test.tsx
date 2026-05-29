import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Label } from "./label";

describe("Label", () => {
  it("includes accessible focus-visible ring styling", () => {
    render(<Label htmlFor="agent-name">Agent name</Label>);

    const label = screen.getByText("Agent name");

    expect(label).toHaveClass("focus-visible:outline-none");
    expect(label).toHaveClass("focus-visible:ring-2");
    expect(label).toHaveClass("focus-visible:ring-ring");
  });
});
