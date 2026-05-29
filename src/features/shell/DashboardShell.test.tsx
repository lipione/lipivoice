import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByRole("button", { name: "Phone Numbers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Knowledge Base" })).toBeInTheDocument();
    expect(screen.getByText("Overview content")).toBeInTheDocument();
    expect(screen.getByLabelText("LipiVoice")).toBeInTheDocument();
    expect(screen.getByText("Self-hosted")).toBeInTheDocument();
  });

  it("calls onNavigate with the selected page id", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <DashboardShell activePage="overview" onNavigate={onNavigate}>
        <div>Overview content</div>
      </DashboardShell>,
    );

    await user.click(screen.getByRole("button", { name: "Knowledge Base" }));

    expect(onNavigate).toHaveBeenCalledWith("knowledge");
  });

  it("marks the active page button as current", () => {
    render(
      <DashboardShell activePage="phone" onNavigate={() => null}>
        <div>Phone content</div>
      </DashboardShell>,
    );

    expect(screen.getByRole("button", { name: "Phone Numbers" })).toHaveAttribute("aria-current", "page");
  });
});
