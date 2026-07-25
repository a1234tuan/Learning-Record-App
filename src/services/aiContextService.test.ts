import { beforeEach, describe, expect, it } from "vitest";

import type { AiContextChunk, Asset, RecordBlock } from "../types";
import {
  buildAiContextPack,
  buildAiContextPackAsync,
  buildAiKnowledgeContextPack,
  clearAiContextCache,
  estimateAiContextSourceTokens,
  estimateAiTokens,
  selectRelevantChunks,
} from "./aiContextService";

const stamp = "2026-06-22T00:00:00.000Z";

const record = (patch: Partial<RecordBlock> = {}): RecordBlock => ({
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-22",
  order: 0,
  subject: "数据结构",
  tags: [],
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
  beforeEach(() => clearAiContextCache());
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

  it("filters tag scopes by both subject and normalized tag while retaining tag source metadata", () => {
    const pack = buildAiKnowledgeContextPack(
      { kind: "tag", subject: "数学", tag: "专项突破" },
      [
        record({ id: "math-hit", subject: "数学", tags: ["专项突破", "训练"], title: "极限" }),
        record({ id: "math-miss", subject: "数学", tags: ["基础"], title: "导数" }),
        record({ id: "other-subject", subject: "物理", tags: ["专项突破"], title: "力学" }),
      ],
      [],
      "B树",
    );

    expect(pack.scope).toEqual({ kind: "tag", subject: "数学", tag: "专项突破" });
    expect(pack.scopeTitle).toBe("数学 / #专项突破");
    expect(pack.recordIds).toEqual(["math-hit"]);
    expect(pack.allChunks[0]).toMatchObject({ tags: ["专项突破", "训练"] });
    expect(pack.markdown).toContain("标签：#专项突破 #训练");
  });

  it("uses calendar-day boundaries for recent scopes and excludes deleted records", () => {
    const pack = buildAiKnowledgeContextPack(
      { kind: "recent", days: 7 },
      [
        record({ id: "start", date: "2026-07-04", title: "起始日" }),
        record({ id: "today", date: "2026-07-10", title: "当天" }),
        record({ id: "older", date: "2026-07-03", title: "更早" }),
        record({ id: "deleted", date: "2026-07-08", deletedAt: stamp, title: "已删除" }),
      ],
      [],
      "",
      { referenceDate: "2026-07-10" },
    );

    expect(pack.scopeTitle).toBe("最近 7 天（2026-07-04 至 2026-07-10）");
    expect(pack.recordIds).toEqual(["start", "today"]);
  });

  it("matches Chinese bigrams and preserves Markdown in selected structure chunks", () => {
    const pack = buildAiKnowledgeContextPack(
      { kind: "tag", subject: "数学", tag: "训练" },
      [record({
        subject: "数学",
        tags: ["训练"],
        contentHtml: '<record-collapse data-title="积分表"><p>积分计算规律</p></record-collapse>',
      })],
      [],
      "积分法",
    );

    expect(pack.selectedChunks).toHaveLength(1);
    expect(pack.selectedChunks[0].content).toContain("积分计算");
    expect(pack.selectedChunks[0].markdown).toContain("积分表");
  });

  it("counts source labels and Markdown when enforcing a token retrieval budget", () => {
    const chunk: AiContextChunk = {
      chunkId: "with-source",
      recordId: "record-1",
      date: "2026-06-22",
      subject: "数学",
      tags: ["专项突破"],
      title: "积分表",
      kind: "text",
      content: "积分计算规律",
      markdown: "### 积分表\n\n积分计算规律",
      sourceLabel: "2026-06-22 / 数学 / 积分表 / 标签：#专项突破 / 结构块",
      order: 0,
    };

    expect(estimateAiContextSourceTokens(chunk, 0)).toBeGreaterThan(estimateAiTokens(chunk.markdown!));
  });

  it("uses one best chunk from each record before filling coverage-mode retrieval", () => {
    const chunks: AiContextChunk[] = ["A", "B", "C"].flatMap((recordId, recordIndex) => [
      {
        chunkId: `${recordId}-first`,
        recordId,
        date: "2026-06-22",
        subject: "数学",
        title: `记录${recordId}`,
        kind: "text" as const,
        content: `抽测重点 ${recordId} ${"内容".repeat(240)}`,
        sourceLabel: `数学 / 记录${recordId} / 正文`,
        order: recordIndex * 2,
      },
      {
        chunkId: `${recordId}-second`,
        recordId,
        date: "2026-06-22",
        subject: "数学",
        title: `记录${recordId}`,
        kind: "text" as const,
        content: `抽测补充 ${recordId} ${"内容".repeat(240)}`,
        sourceLabel: `数学 / 记录${recordId} / 正文2`,
        order: recordIndex * 2 + 1,
      },
    ]);

    const selected = selectRelevantChunks(chunks, "请抽测这些重点", { maxTokens: 4_000, retrievalMode: "coverage" });

    expect(new Set(selected.map((chunk) => chunk.recordId))).toEqual(new Set(["A", "B", "C"]));
  });
});
