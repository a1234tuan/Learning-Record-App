import { describe, expect, it } from "vitest";

import type { Asset, RecordBlock } from "../types";
import { buildAiContextPack, buildAiContextPackAsync, selectRelevantChunks } from "./aiContextService";

const stamp = "2026-06-22T00:00:00.000Z";

const record = (patch: Partial<RecordBlock> = {}): RecordBlock => ({
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-22",
  order: 0,
  subject: "数据结构",
  title: "B树索引",
  contentHtml: [
    "<p>B树用于减少磁盘 IO，节点里可以存多个 key。</p>",
    '<record-formula data-formula-id="f-1" data-title="高度" data-latex="h=O(log_m n)"></record-formula>',
    '<record-asset data-asset-id="img-done" data-kind="image" data-title="板书"></record-asset>',
    '<record-asset data-asset-id="img-idle" data-kind="image" data-title="截图"></record-asset>',
    '<record-asset data-asset-id="audio-1" data-kind="audio" data-title="录音"></record-asset>',
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

describe("aiContextService", () => {
  it("builds text, formula, and OCR chunks while skipping unusable assets", () => {
    const pack = buildAiContextPack(
      "2026-06-22",
      [record(), record({ id: "deleted", deletedAt: stamp, title: "已删除" })],
      [
        asset({ id: "img-done", title: "板书", ocrStatus: "done", ocrText: "OCR 里写了 B+树叶子链表" }),
        asset({ id: "img-idle", title: "截图", ocrStatus: "idle" }),
        asset({ id: "audio-1", title: "录音", kind: "audio", mimeType: "audio/mp4" }),
      ],
      "B树",
    );

    expect(pack.recordIds).toEqual(["record-1"]);
    expect(pack.allChunks.map((chunk) => chunk.kind)).toEqual(["text", "formula", "imageOcr"]);
    expect(pack.allChunks.map((chunk) => chunk.content).join("\n")).toContain("B树用于减少磁盘 IO");
    expect(pack.allChunks.map((chunk) => chunk.content).join("\n")).toContain("h=O(log_m n)");
    expect(pack.allChunks.map((chunk) => chunk.content).join("\n")).toContain("B+树叶子链表");
    expect(pack.missingOcrAssetIds).toEqual(["img-idle"]);
    expect(pack.skippedAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "img-idle", kind: "image" }),
      expect.objectContaining({ id: "audio-1", kind: "audio" }),
    ]));
    expect(pack.ocrSummary).toEqual({ includedImages: 1, skippedImages: 1 });
  });

  it("selects chunks by title, subject, content, and OCR text", () => {
    const pack = buildAiContextPack(
      "2026-06-22",
      [record(), record({ id: "os", subject: "OS", title: "进程调度", contentHtml: "<p>时间片轮转。</p>", order: 1 })],
      [asset({ id: "img-done", ocrStatus: "done", ocrText: "OCR 里写了 B+树叶子链表" })],
    );

    const selected = selectRelevantChunks(pack.allChunks, "B+树");

    const ocrChunk = selected.find((chunk) => chunk.sourceLabel.includes("图片OCR"));
    expect(ocrChunk?.content).toContain("B+树");
  });

  it("uses selected chunks for long contexts instead of carrying every chunk", () => {
    const longRecord = record({
      contentHtml: `<p>${"无关内容。".repeat(7000)}</p><p>B树命中内容。</p>`,
    });

    const pack = buildAiContextPack("2026-06-22", [longRecord], [], "B树");

    expect(pack.allChunks.length).toBeGreaterThan(pack.selectedChunks.length);
    expect(pack.selectedChunks.map((chunk) => chunk.content).join("\n")).toContain("B树命中内容");
  });

  it("builds the same formula-aware context asynchronously", async () => {
    const pack = await buildAiContextPackAsync(
      "2026-06-22",
      [record({ contentHtml: '<p>行内 <record-inline-math data-formula-id="inline" data-latex="x^2"></record-inline-math></p>' })],
      [],
      "x^2",
    );

    expect(pack.selectedChunks.map((chunk) => chunk.content).join("\n")).toContain("$x^2$");
    expect(pack.contextHash).toBeTruthy();
  });
});
