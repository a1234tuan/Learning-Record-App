import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset, RecordBlock } from "../types";

const stamp = "2026-06-21T00:00:00.000Z";
const blob = new Blob(["image"], { type: "image/png" });
const assetStore = new Map<string, Asset>();

vi.mock("./storageAdapter", () => ({
  storage: {
    getAsset: vi.fn((id: string) => Promise.resolve(assetStore.get(id))),
    patchAsset: vi.fn((id: string, patch: Partial<Asset>) => {
      const existing = assetStore.get(id);
      if (!existing) {
        return Promise.resolve(undefined);
      }
      const saved = { ...existing, ...patch, data: existing.data, updatedAt: stamp };
      assetStore.set(id, saved);
      return Promise.resolve(saved);
    }),
  },
}));

vi.mock("./ocrService", () => ({
  runPaddleOcr: vi.fn(async () => "识别出来的文字"),
}));

describe("ocrJobService", () => {
  beforeEach(() => {
    assetStore.clear();
    assetStore.set("a1", {
      id: "a1",
      createdAt: stamp,
      updatedAt: stamp,
      fileName: "note.png",
      title: "截图",
      mimeType: "image/png",
      size: 5,
      kind: "image",
      data: blob,
    });
    vi.clearAllMocks();
  });

  it("updates OCR metadata without replacing image blob", async () => {
    const { runOcrForAsset } = await import("./ocrJobService");

    const updated = await runOcrForAsset("a1", { force: true });

    expect(updated?.ocrStatus).toBe("done");
    expect(updated?.ocrText).toBe("识别出来的文字");
    expect(updated?.data).toBe(blob);
    expect(assetStore.get("a1")?.data).toBe(blob);
  });

  it("queues only idle image refs for auto OCR", async () => {
    const { enqueueAutoOcrForRecord } = await import("./ocrJobService");
    const { runPaddleOcr } = await import("./ocrService");
    const record: RecordBlock = {
      id: "r1",
      createdAt: stamp,
      updatedAt: stamp,
      type: "record",
      date: "2026-06-21",
      order: 0,
      subject: "数据结构",
      title: "数据结构记录块1",
      contentHtml: "<p></p>",
      assets: [
        { id: "a1", title: "截图", kind: "image" },
        { id: "missing-audio", title: "录音", kind: "audio" },
      ],
      formulas: [],
      mistakeRefs: [],
    };

    enqueueAutoOcrForRecord(record);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(runPaddleOcr).toHaveBeenCalledTimes(1);
  });

  it("marks completed empty OCR result as failed with a clear message", async () => {
    const { runPaddleOcr } = await import("./ocrService");
    vi.mocked(runPaddleOcr).mockResolvedValueOnce("");
    const { runOcrForAsset } = await import("./ocrJobService");

    await expect(runOcrForAsset("a1", { force: true })).rejects.toThrow("上游返回空 OCR 文本");

    expect(assetStore.get("a1")?.ocrStatus).toBe("failed");
    expect(assetStore.get("a1")?.ocrError).toBe("上游返回空 OCR 文本。");
    expect(assetStore.get("a1")?.ocrResultSummary?.includedInAi).toBe(false);
  });
});
