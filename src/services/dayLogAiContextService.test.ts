import { describe, expect, it } from "vitest";

import type { Asset, RecordBlock } from "../types";
import { buildDayLogAiContext } from "./dayLogAiContextService";

const stamp = "2026-06-22T00:00:00.000Z";

const record = (patch: Partial<RecordBlock> = {}): RecordBlock => ({
  id: "record-1",
  createdAt: stamp,
  updatedAt: "2026-06-23T00:00:00.000Z",
  type: "record",
  date: "2026-06-22",
  order: 0,
  subject: "数学",
  title: "极限",
  contentHtml: [
    "<p>今天复习了洛必达法则。</p>",
    '<record-asset data-asset-id="img-done" data-kind="image" data-title="板书"></record-asset>',
    '<record-asset data-asset-id="img-idle" data-kind="image" data-title="截图"></record-asset>',
    '<record-asset data-asset-id="audio-1" data-kind="audio" data-title="讲解录音"></record-asset>',
    '<record-formula data-formula-id="f-1" data-title="公式" data-latex="\\lim_{x\\to0}\\frac{\\sin x}{x}=1"></record-formula>',
  ].join(""),
  assets: [],
  formulas: [],
  mistakeRefs: [],
  ...patch,
});

const asset = (patch: Partial<Asset>): Asset => ({
  id: patch.id ?? "asset",
  createdAt: stamp,
  updatedAt: stamp,
  fileName: patch.fileName ?? "file.png",
  title: patch.title,
  mimeType: patch.mimeType ?? "image/png",
  size: patch.size ?? 10,
  kind: patch.kind ?? "image",
  data: new Blob(["x"]),
  ...patch,
});

describe("buildDayLogAiContext", () => {
  it("uses record.date, includes OCR text, warns missing OCR, and skips audio", () => {
    const context = buildDayLogAiContext(
      "2026-06-22",
      [
        record(),
        record({ id: "other", date: "2026-06-21", title: "旧记录" }),
      ],
      [
        asset({ id: "img-done", title: "板书", ocrStatus: "done", ocrText: "OCR 中的极限定义" }),
        asset({ id: "img-idle", title: "截图", ocrStatus: "idle" }),
        asset({ id: "audio-1", title: "讲解录音", kind: "audio", mimeType: "audio/mp4" }),
      ],
    );

    expect(context.recordIds).toEqual(["record-1"]);
    expect(context.markdown).toContain("今天复习了洛必达法则");
    expect(context.markdown).toContain("OCR 中的极限定义");
    expect(context.markdown).toContain("\\lim_{x\\to0}");
    expect(context.summary).toContain("2026-06-22");
    expect(context.allChunks.map((chunk) => chunk.kind)).toEqual(["text", "imageOcr", "formula"]);
    expect(context.selectedChunks.length).toBe(context.allChunks.length);
    expect(context.contextHash).toBeTruthy();
    expect(context.missingOcrAssetIds).toEqual(["img-idle"]);
    expect(context.skippedAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "img-idle", kind: "image" }),
        expect.objectContaining({ id: "audio-1", kind: "audio" }),
      ]),
    );
    expect(context.warnings.join("\n")).toContain("图片未提供可用 OCR 文本");
    expect(context.warnings.join("\n")).toContain("音频或附件已跳过");
    expect(context.ocrSummary).toEqual({ includedImages: 1, skippedImages: 1 });
    expect(context.skippedAssets.find((item) => item.id === "img-idle")?.reason).toContain("图片尚未 OCR");
  });
});
