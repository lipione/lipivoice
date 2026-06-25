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
    expect(screen.getByRole("button", { name: "Calls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Campaigns" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phone Numbers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SDK Playground" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Knowledge Base" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voice Lab" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Evals" })).not.toBeInTheDocument();
    expect(screen.getByText("Overview content")).toBeInTheDocument();
    expect(screen.getByLabelText("LipiVoice")).toBeInTheDocument();
    expect(screen.getByText("Operate")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
  });

  it("calls onNavigate with the selected page id", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <DashboardShell activePage="overview" onNavigate={onNavigate}>
        <div>Overview content</div>
      </DashboardShell>,
    );

    await user.click(screen.getByRole("button", { name: "Operations" }));

    expect(onNavigate).toHaveBeenCalledWith("operations");
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
