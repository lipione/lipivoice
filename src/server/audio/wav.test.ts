import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileToBase64 } from "./wav";

describe("WAV helpers", () => {
  it("reads a file as base64 audio content", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-wav-test-"));
    const filePath = join(tempDir, "speech.wav");

    try {
      await writeFile(filePath, Buffer.from([1, 2, 3, 4]));

      await expect(fileToBase64(filePath)).resolves.toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
