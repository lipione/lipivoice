import { useEffect, useMemo, useState } from "react";
import { Database, Search, Save, Upload } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeSearchResult } from "@/domain/types";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "failed";

const defaultBaseForm = {
  name: "Reception FAQ",
  description: "Common caller answers.",
};

const defaultDocumentForm = {
  title: "",
  content: "",
};

export function KnowledgeBasePage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [baseForm, setBaseForm] = useState(defaultBaseForm);
  const [documentForm, setDocumentForm] = useState(defaultDocumentForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseState, setBaseState] = useState<SaveState>("idle");
  const [documentState, setDocumentState] = useState<SaveState>("idle");
  const [searchState, setSearchState] = useState<SaveState>("idle");

  useEffect(() => {
    let isCurrent = true;

    async function loadKnowledgeBases() {
      setIsLoading(true);
      setError(null);

      try {
        const nextBases = await getJson<KnowledgeBase[]>("/api/knowledge-bases");
        if (!isCurrent) return;

        setKnowledgeBases(nextBases);
        const firstBase = nextBases[0] ?? null;
        if (firstBase) {
          setSelectedBaseId(firstBase.id);
          setBaseForm(formFromBase(firstBase));
          void loadDocuments(firstBase.id);
        }
      } catch (loadError) {
        if (!isCurrent) return;

        setError(loadError instanceof Error ? loadError.message : "Unable to load knowledge bases.");
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadKnowledgeBases();

    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedBase = useMemo(
    () => knowledgeBases.find((knowledgeBase) => knowledgeBase.id === selectedBaseId) ?? null,
    [knowledgeBases, selectedBaseId],
  );

  async function loadDocuments(knowledgeBaseId: string) {
    setIsLoadingDocuments(true);
    setSearchResults([]);
    try {
      setDocuments(await getJson<KnowledgeDocument[]>(`/api/knowledge-bases/${knowledgeBaseId}/documents`));
    } catch {
      setDocuments([]);
    } finally {
      setIsLoadingDocuments(false);
    }
  }

  function selectBase(knowledgeBase: KnowledgeBase) {
    setSelectedBaseId(knowledgeBase.id);
    setBaseForm(formFromBase(knowledgeBase));
    setBaseState("idle");
    setDocumentState("idle");
    setSearchState("idle");
    void loadDocuments(knowledgeBase.id);
  }

  function createNewBase() {
    setSelectedBaseId(null);
    setBaseForm(defaultBaseForm);
    setDocuments([]);
    setSearchResults([]);
    setBaseState("idle");
    setDocumentState("idle");
    setSearchState("idle");
  }

  async function saveKnowledgeBase() {
    const now = new Date().toISOString();
    const knowledgeBase: KnowledgeBase = {
      id: selectedBaseId ?? createKnowledgeBaseId(baseForm.name),
      name: baseForm.name.trim(),
      description: baseForm.description.trim(),
      status: selectedBase?.status ?? "ready",
      documentCount: selectedBase?.documentCount ?? 0,
      createdAt: selectedBase?.createdAt ?? now,
      updatedAt: now,
    };

    setBaseState("saving");
    try {
      const savedBase = await postJson<KnowledgeBase>("/api/knowledge-bases", knowledgeBase);
      setKnowledgeBases((currentBases) => {
        const existing = currentBases.some((currentBase) => currentBase.id === savedBase.id);
        return existing
          ? currentBases.map((currentBase) => (currentBase.id === savedBase.id ? savedBase : currentBase))
          : [...currentBases, savedBase];
      });
      setSelectedBaseId(savedBase.id);
      setBaseForm(formFromBase(savedBase));
      setBaseState("saved");
    } catch {
      setBaseState("failed");
    }
  }

  async function addDocument() {
    if (!selectedBase) return;

    setDocumentState("saving");
    try {
      const savedDocument = await postJson<KnowledgeDocument>(
        `/api/knowledge-bases/${selectedBase.id}/documents`,
        {
          title: documentForm.title.trim(),
          sourceType: "text",
          content: documentForm.content.trim(),
        },
      );
      setDocuments((currentDocuments) => [
        ...currentDocuments.filter((document) => document.id !== savedDocument.id),
        savedDocument,
      ]);
      setKnowledgeBases((currentBases) =>
        currentBases.map((knowledgeBase) =>
          knowledgeBase.id === selectedBase.id
            ? {
                ...knowledgeBase,
                documentCount: currentDocumentsCount(documents, savedDocument.id),
                updatedAt: savedDocument.updatedAt,
              }
            : knowledgeBase,
        ),
      );
      setDocumentForm(defaultDocumentForm);
      setDocumentState("saved");
    } catch {
      setDocumentState("failed");
    }
  }

  async function searchKnowledgeBase() {
    if (!selectedBase) return;

    setSearchState("saving");
    try {
      setSearchResults(
        await postJson<KnowledgeSearchResult[]>(`/api/knowledge-bases/${selectedBase.id}/search`, {
          query: searchQuery,
        }),
      );
      setSearchState("saved");
    } catch {
      setSearchState("failed");
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Knowledge Base">
        <Card>
          <CardHeader>
            <CardTitle>Knowledge Base</CardTitle>
            <CardDescription>Loading local documents.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading knowledge bases...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Knowledge Base">
        <Card>
          <CardHeader>
            <CardTitle>Knowledge Base</CardTitle>
            <CardDescription>Unable to load local documents.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Knowledge Base">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Knowledge retrieval</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Store local text documents and test retrieval snippets before attaching them to agents.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{knowledgeBases.length} bases</Badge>
          <Button type="button" size="sm" variant="outline" onClick={createNewBase}>
            <Database aria-hidden="true" />
            New base
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Bases</CardTitle>
            <CardDescription>Reusable agent knowledge</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {knowledgeBases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No knowledge bases configured.</p>
            ) : (
              knowledgeBases.map((knowledgeBase) => {
                const isSelected = knowledgeBase.id === selectedBaseId;

                return (
                  <Button
                    key={knowledgeBase.id}
                    type="button"
                    variant={isSelected ? "secondary" : "ghost"}
                    className={cn("h-auto justify-start px-3 py-2 text-left", isSelected && "bg-muted")}
                    onClick={() => selectBase(knowledgeBase)}
                  >
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate font-medium">{knowledgeBase.name}</span>
                        <Badge variant={knowledgeBase.status === "ready" ? "success" : "warning"}>
                          {knowledgeBase.status}
                        </Badge>
                      </span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {knowledgeBase.documentCount} documents
                      </span>
                    </span>
                  </Button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid min-w-0 gap-4">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle>Base settings</CardTitle>
                  <CardDescription>Name and description used in agent context.</CardDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void saveKnowledgeBase()}
                  disabled={baseState === "saving" || !baseForm.name.trim()}
                >
                  <Save aria-hidden="true" />
                  {baseState === "saving" ? "Saving..." : "Save knowledge base"}
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="knowledge-name">Name</Label>
                  <Input
                    id="knowledge-name"
                    value={baseForm.name}
                    onChange={(event) => {
                      setBaseState("idle");
                      setBaseForm((current) => ({ ...current, name: event.target.value }));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="knowledge-description">Description</Label>
                  <Textarea
                    id="knowledge-description"
                    className="min-h-20"
                    value={baseForm.description}
                    onChange={(event) => {
                      setBaseState("idle");
                      setBaseForm((current) => ({ ...current, description: event.target.value }));
                    }}
                  />
                </div>
                {baseState === "saved" ? (
                  <Badge variant="success">Knowledge base saved</Badge>
                ) : baseState === "failed" ? (
                  <Badge variant="danger">Save failed</Badge>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
                <CardDescription>{selectedBase ? selectedBase.name : "Select a base"}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {isLoadingDocuments ? (
                  <p className="text-sm text-muted-foreground">Loading documents...</p>
                ) : documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No documents indexed.</p>
                ) : (
                  documents.map((document) => (
                    <div key={document.id} className="grid gap-1 rounded-md border border-border p-3 text-sm">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate font-medium">{document.title}</span>
                        <Badge variant="outline">{document.tokenCount} tokens</Badge>
                      </div>
                      <p className="line-clamp-2 text-muted-foreground">{document.content}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Add text</CardTitle>
                <CardDescription>Local document ingestion</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="knowledge-document-title">Document title</Label>
                  <Input
                    id="knowledge-document-title"
                    value={documentForm.title}
                    onChange={(event) => {
                      setDocumentState("idle");
                      setDocumentForm((current) => ({ ...current, title: event.target.value }));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="knowledge-document-content">Document content</Label>
                  <Textarea
                    id="knowledge-document-content"
                    className="min-h-32"
                    value={documentForm.content}
                    onChange={(event) => {
                      setDocumentState("idle");
                      setDocumentForm((current) => ({ ...current, content: event.target.value }));
                    }}
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void addDocument()}
                  disabled={
                    !selectedBase ||
                    documentState === "saving" ||
                    !documentForm.title.trim() ||
                    !documentForm.content.trim()
                  }
                >
                  <Upload aria-hidden="true" />
                  {documentState === "saving" ? "Adding..." : "Add document"}
                </Button>
                {documentState === "saved" ? (
                  <Badge variant="success">Document added</Badge>
                ) : documentState === "failed" ? (
                  <Badge variant="danger">Add failed</Badge>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Search</CardTitle>
                <CardDescription>Lexical retrieval preview</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="knowledge-search-query">Search query</Label>
                  <Input
                    id="knowledge-search-query"
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchState("idle");
                      setSearchQuery(event.target.value);
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void searchKnowledgeBase()}
                  disabled={!selectedBase || searchState === "saving" || !searchQuery.trim()}
                >
                  <Search aria-hidden="true" />
                  {searchState === "saving" ? "Searching..." : "Search"}
                </Button>
                {searchState === "failed" ? <Badge variant="danger">Search failed</Badge> : null}
                {searchResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No search results.</p>
                ) : (
                  searchResults.map((result) => (
                    <div key={result.documentId} className="grid gap-1 rounded-md border border-border p-3 text-sm">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate font-medium">{result.title}</span>
                        <Badge variant="outline">Score {result.score}</Badge>
                      </div>
                      <p className="break-words text-muted-foreground">{result.snippet}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}

function formFromBase(knowledgeBase: KnowledgeBase) {
  return {
    name: knowledgeBase.name,
    description: knowledgeBase.description,
  };
}

function createKnowledgeBaseId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `kb_${slug || Date.now()}`;
}

function currentDocumentsCount(documents: KnowledgeDocument[], savedDocumentId: string) {
  return documents.some((document) => document.id === savedDocumentId) ? documents.length : documents.length + 1;
}
