import { readFile } from "node:fs/promises";
import type { RuntimeAdapter } from "@/domain/types";
import type { RuntimeHealthResult } from "./types";

interface TtsModelCatalogOptions {
  manifestPath: string;
}

interface CatalogModelEntry {
  status?: string;
  file_count?: number;
  bytes?: number;
}

interface TtsModelManifest {
  models?: Record<string, CatalogModelEntry>;
}

const adapterModelKeys: Partial<Record<RuntimeAdapter, string[]>> = {
  indic_parler: ["indic_parler_tts"],
  omnivoice: ["omnivoice_gguf"],
  chatterbox_nepali: ["chatterbox_base", "chatterbox_nepali"],
  coqui_vits: ["coqui_piper_vits"],
};

export class TtsModelCatalog {
  private readonly manifestPath: string;

  constructor(options: TtsModelCatalogOptions) {
    this.manifestPath = options.manifestPath;
  }

  async health(adapter: RuntimeAdapter): Promise<RuntimeHealthResult> {
    if (!this.manifestPath) {
      return { status: "missing_model", reason: "model_catalog_not_configured" };
    }

    const modelKeys = adapterModelKeys[adapter];
    if (!modelKeys) {
      return { status: "missing_model", reason: "model_catalog_adapter_not_supported" };
    }

    const manifest = await this.readManifest();
    if (!manifest) {
      return { status: "missing_model", reason: "model_catalog_not_found" };
    }

    const entries = modelKeys.map((key) => manifest.models?.[key] ?? null);
    if (entries.some((entry) => !entry)) {
      return { status: "missing_model", reason: "model_catalog_entry_missing" };
    }

    if (entries.some((entry) => entry?.status === "gated_missing_hf_token")) {
      return { status: "license_required", reason: "hf_token_required" };
    }

    if (entries.some((entry) => entry?.status === "download_failed")) {
      return { status: "failed", reason: "model_download_failed" };
    }

    if (entries.every((entry) => isInstalledStatus(entry?.status) && hasModelFiles(entry))) {
      return { status: "healthy", reason: null };
    }

    return { status: "missing_model", reason: "model_files_missing" };
  }

  private async readManifest(): Promise<TtsModelManifest | null> {
    try {
      return JSON.parse(await readFile(this.manifestPath, "utf8")) as TtsModelManifest;
    } catch {
      return null;
    }
  }
}

function isInstalledStatus(status: string | undefined): boolean {
  return status === "downloaded" || status === "linked_existing";
}

function hasModelFiles(entry: CatalogModelEntry | null): boolean {
  return Number(entry?.file_count ?? 0) > 0 && Number(entry?.bytes ?? 0) > 0;
}
