import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardShell } from "./DashboardShell";

describe("DashboardShell", () => {
  it("renders operational navigation without marketing copy", () => {
    render(
      <DashboardShell activePage="overview" onNavigate={() => null}>
        <div>Overview content</div>
      </DashboardShell>,
    );

    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Web Voice" })).toBeInTheDocument();
    expect(screen.getByText("Overview content")).toBeInTheDocument();
  });
});
