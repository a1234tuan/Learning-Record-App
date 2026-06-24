import { describe, expect, it } from "vitest";

import type { Asset, RecordBlock } from "../types";
import {
  extractRecordRefsFromContent,
  normalizeRecordContent,
  renameRecordAssetTitle,
  recordToLinearMarkdown,
  recordToPlainText,
  syncRecordRefsFromContent,
} from "./recordContent";

const stamp = "2026-06-21T00:00:00.000Z";

const record: RecordBlock = {
  id: "r1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject: "数据结构",
  title: "树",
  contentHtml: "<p>先写文字</p>",
  assets: [{ id: "a1", title: "树截图", kind: "image" }],
  formulas: [{ id: "f1", title: "复杂度", latex: "T(n)=O(n)" }],
  mistakeRefs: [],
};

const image: Asset = {
  id: "a1",
  createdAt: stamp,
  updatedAt: stamp,
  fileName: "tree.png",
  title: "树截图",
  mimeType: "image/png",
  size: 4,
  kind: "image",
  data: new Blob(["tree"]),
  ocrStatus: "done",
  ocrText: "二叉树遍历",
};

describe("recordContent", () => {
  it("normalizes legacy assets and formulas into linear nodes", () => {
    const html = normalizeRecordContent(record);

    expect(html).toContain("<p>先写文字</p>");
    expect(html).toContain("record-asset");
    expect(html).toContain('data-asset-id="a1"');
    expect(html).toContain("record-formula");
    expect(html).toContain('data-latex="T(n)=O(n)"');
  });

  it("extracts record refs from content", () => {
    const refs = extractRecordRefsFromContent(normalizeRecordContent(record));

    expect(refs.assets).toEqual([{ id: "a1", title: "树截图", kind: "image" }]);
    expect(refs.formulas).toEqual([{ id: "f1", title: "复杂度", latex: "T(n)=O(n)" }]);
  });

  it("syncs record indexes from linear content", () => {
    const synced = syncRecordRefsFromContent({
      ...record,
      assets: [],
      formulas: [],
      contentHtml:
        '<p>A</p><record-asset data-asset-id="a2" data-kind="audio" data-title="录音"></record-asset>',
    });

    expect(synced.assets).toEqual([{ id: "a2", title: "录音", kind: "audio" }]);
    expect(synced.formulas).toEqual([]);
  });

  it("renames a record asset title in content and refs", () => {
    const result = renameRecordAssetTitle(
      {
        ...record,
        contentHtml:
          '<p>A</p><record-asset data-asset-id="audio-1" data-kind="audio" data-title="old"></record-asset>',
        assets: [{ id: "audio-1", title: "old", kind: "audio" }],
      },
      "audio-1",
      "new title",
    );

    expect(result.changed).toBe(true);
    expect(result.record.contentHtml).toContain('data-title="new title"');
    expect(result.record.assets).toEqual([{ id: "audio-1", title: "new title", kind: "audio" }]);
  });

  it("exports linear plain text and markdown in order", () => {
    const linearRecord = {
      ...record,
      contentHtml:
        '<p>第一段</p><record-asset data-asset-id="a1" data-kind="image" data-title="树截图"></record-asset><p>第二段</p><record-formula data-formula-id="f1" data-title="复杂度" data-latex="T(n)=O(n)"></record-formula>',
    };

    const text = recordToPlainText(linearRecord, [image]);
    const markdown = recordToLinearMarkdown(linearRecord, [image]);

    expect(text.indexOf("第一段")).toBeLessThan(text.indexOf("树截图"));
    expect(text.indexOf("树截图")).toBeLessThan(text.indexOf("第二段"));
    expect(markdown).toContain("![树截图](../assets/a1-tree.png)");
    expect(markdown).toContain("图片 OCR：二叉树遍历");
  });
});
