import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KnowledgeBasePage } from "./KnowledgeBasePage";

const knowledgeBases = [
  {
    id: "kb_reception_faq",
    name: "Reception FAQ",
    description: "Common caller answers.",
    status: "ready",
    documentCount: 1,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
];

const documents = [
  {
    id: "doc_hours",
    knowledgeBaseId: "kb_reception_faq",
    title: "Hours",
    sourceType: "text",
    content: "We are open from 9 AM to 5 PM.",
    tokenCount: 10,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
];

describe("KnowledgeBasePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders documents, adds text, and searches the selected base", async () => {
    const user = userEvent.setup();
    let savedDocument: Record<string, unknown> | null = null;
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/knowledge-bases/kb_reception_faq/documents") && init?.method === "POST") {
        savedDocument = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({
          ...savedDocument,
          id: "doc_refunds",
          knowledgeBaseId: "kb_reception_faq",
          tokenCount: 9,
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:00:00.000Z",
        });
      }

      if (url.endsWith("/api/knowledge-bases/kb_reception_faq/search")) {
        return Response.json([
          {
            documentId: "doc_refunds",
            title: "Refunds",
            snippet: "Refunds are available within 30 days.",
            score: 3,
          },
        ]);
      }

      if (url.endsWith("/api/knowledge-bases/kb_reception_faq/documents")) {
        return Response.json(documents);
      }

      if (url.endsWith("/api/knowledge-bases")) {
        return Response.json(knowledgeBases);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<KnowledgeBasePage />);

    expect(await screen.findAllByText("Reception FAQ")).not.toHaveLength(0);
    expect(screen.getByText("Hours")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "Refunds" } });
    fireEvent.change(screen.getByLabelText("Document content"), {
      target: { value: "Refunds are available within 30 days." },
    });
    await user.click(screen.getByRole("button", { name: "Add document" }));

    await waitFor(() =>
      expect(savedDocument).toMatchObject({
        title: "Refunds",
        content: "Refunds are available within 30 days.",
      }),
    );

    fireEvent.change(screen.getByLabelText("Search query"), { target: { value: "refund policy" } });
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(screen.getAllByText("Refunds are available within 30 days.").length).toBeGreaterThan(0),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/knowledge-bases/kb_reception_faq/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "refund policy" }),
      }),
    );
  });
});
