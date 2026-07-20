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
import {
  createDefaultComparisonTable,
  createDefaultStickyBoard,
  createDefaultStructureDiagram,
  serializeStructureData,
} from "./recordStructureBlocks";

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

  it("can sync editor content without restoring deleted legacy refs", () => {
    const synced = syncRecordRefsFromContent(
      {
        ...record,
        contentHtml: "<p></p>",
      },
      { preserveLegacyRefs: false },
    );

    expect(synced.contentHtml).toBe("<p></p>");
    expect(synced.contentHtml).not.toContain("record-asset");
    expect(synced.assets).toEqual([]);
    expect(synced.formulas).toEqual([]);
  });

  it("extracts record refs from content", () => {
    const refs = extractRecordRefsFromContent(normalizeRecordContent(record));

    expect(refs.assets).toEqual([{ id: "a1", title: "树截图", kind: "image" }]);
    expect(refs.formulas).toEqual([{ id: "f1", title: "复杂度", latex: "T(n)=O(n)" }]);
  });

  it("counts inline Markdown formulas as formula nodes and keeps them searchable", () => {
    const synced = syncRecordRefsFromContent({
      ...record,
      assets: [],
      formulas: [],
      contentHtml: '<p>勾股定理 <record-inline-math data-formula-id="inline-1" data-latex="a^2+b^2=c^2"></record-inline-math></p>',
    });

    expect(synced.formulas).toEqual([{ id: "inline-1", latex: "a^2+b^2=c^2", title: undefined }]);
    expect(recordToPlainText(synced)).toContain("$a^2+b^2=c^2$");
    expect(recordToLinearMarkdown(synced)).toContain("$a^2+b^2=c^2$");
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

  it("ignores persisted editable trailing paragraphs when syncing refs and exporting content", () => {
    const withoutTail = {
      ...record,
      assets: [],
      formulas: [],
      contentHtml: '<p>正文</p><record-formula data-formula-id="formula-1" data-title="公式" data-latex="x^2"></record-formula>',
    };
    const withTail = {
      ...withoutTail,
      contentHtml: `${withoutTail.contentHtml}<p></p>`,
    };

    expect(syncRecordRefsFromContent(withTail)).toMatchObject({
      assets: [],
      formulas: [{ id: "formula-1", title: "公式", latex: "x^2" }],
    });
    expect(recordToPlainText(withTail)).toBe(recordToPlainText(withoutTail));
    expect(recordToLinearMarkdown(withTail)).toBe(recordToLinearMarkdown(withoutTail));
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
  it("exports structure blocks to plain text and markdown", () => {
    const diagram = createDefaultStructureDiagram();
    expect(diagram.orientation).toBe("horizontal");
    diagram.title = "File system layers";
    diagram.chain[0] = {
      ...diagram.chain[0],
      title: "IO control",
      body: "talks to devices",
      note: "worker",
      branches: [[{ ...diagram.chain[0], id: "branch-1", title: "device driver", body: "parallel path", branches: [] }]],
    };
    const comparison = createDefaultComparisonTable();
    comparison.rows[0].cells[comparison.columns[0].id] = "logical file system";
    comparison.rows[0].cells[comparison.columns[2].id] = "gatekeeper";
    const sticky = createDefaultStickyBoard();
    sticky.notes[0].text = "remember by role";

    const structureRecord = {
      ...record,
      contentHtml: [
        `<record-structure-diagram data-json='${serializeStructureData(diagram)}'></record-structure-diagram>`,
        `<record-comparison-table data-json='${serializeStructureData(comparison)}'></record-comparison-table>`,
        `<record-sticky-board data-json='${serializeStructureData(sticky)}'></record-sticky-board>`,
      ].join(""),
    };

    const text = recordToPlainText(structureRecord);
    const markdown = recordToLinearMarkdown(structureRecord);

    expect(text).toContain("IO control");
    expect(text).toContain("worker");
    expect(text).toContain("gatekeeper");
    expect(text).toContain("remember by role");
    expect(markdown).toContain("### File system layers");
    expect(markdown).toContain("分叉 1");
    expect(markdown).toContain("| 概念 | 作用 | 类比 | 易错点 |");
  });

  it("exports collapse block content", () => {
    const collapseRecord = {
      ...record,
      contentHtml:
        '<record-collapse data-title="Recall first" data-summary="standard answer" data-default-open="false"><p>hidden detail</p><record-formula data-formula-id="fx" data-title="formula" data-latex="a=b"></record-formula></record-collapse>',
    };

    const text = recordToPlainText(collapseRecord);
    const markdown = recordToLinearMarkdown(collapseRecord);

    expect(text).toContain("Recall first");
    expect(text).toContain("hidden detail");
    expect(text).toContain("a=b");
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("<summary>Recall first · standard answer</summary>");
  });

  it("exports highlight block content as searchable text and markdown", () => {
    const highlightRecord = {
      ...record,
      contentHtml:
        '<p>前文</p><record-highlight-block data-tone="pink"><p><strong>重点结论</strong></p><ul><li>可搜索</li></ul></record-highlight-block><p>后文</p>',
    };

    const text = recordToPlainText(highlightRecord);
    const markdown = recordToLinearMarkdown(highlightRecord);

    expect(text).toContain("重点结论");
    expect(text).toContain("可搜索");
    expect(markdown).toContain("浅粉色高亮");
    expect(markdown).toContain("> 重点结论");
  });
});
