import { describe, expect, it } from "vitest";

import {
  assessMarkdownPaste,
  isUndoablePasteSource,
  MAX_UNDOABLE_PASTE_BYTES,
  pasteSourceByteLength,
  splitMarkdownPasteSource,
} from "./markdownPasteWork";

describe("markdown paste work assessment", () => {
  it("keeps fenced code, display formulas, tables and list groups as complete chunks", () => {
    const source = [
      "# 标题",
      "",
      "- 第一项",
      "  - 子项",
      "- 第二项",
      "",
      "```python",
      "print('$not_math$')",
      "```",
      "",
      "$$",
      "x = y^2",
      "$$",
      "",
      "| 名称 | 示例 |",
      "| --- | --- |",
      "| `x` | **值** |",
    ].join("\n");

    const chunks = splitMarkdownPasteSource(source);

    expect(chunks.map((chunk) => chunk.kind)).toEqual(["heading", "list", "code", "formula", "table"]);
    expect(chunks[1].source).toContain("  - 子项");
    expect(chunks[2].source).toContain("$not_math$");
    expect(chunks[3].formulaCount).toBe(1);
  });

  it("uses Android's structural budget before the character cap", () => {
    const source = Array.from({ length: 25 }, (_, index) => `### 段落 ${index}\n\n说明文字。`).join("\n\n");
    const assessment = assessMarkdownPaste(source, true);

    expect(source.length).toBeLessThan(4 * 1024);
    expect(assessment.blockCount).toBeGreaterThan(24);
    expect(assessment.shouldStream).toBe(true);
    expect(assessment.retainRaw).toBe(false);
  });

  it("retains raw Markdown when a source exceeds conversion safety caps", () => {
    const tooManyFormulas = Array.from({ length: 121 }, (_, index) => `$x_${index}$`).join("\n\n");
    const oversizedCode = `\`\`\`python\n${"x".repeat(16 * 1024 + 1)}\n\`\`\``;

    expect(assessMarkdownPaste(tooManyFormulas, true).retainRaw).toBe(true);
    expect(assessMarkdownPaste(oversizedCode, false).retainRaw).toBe(true);
  });

  it("uses UTF-8 bytes rather than JavaScript character count for undoable paste limits", () => {
    const atLimit = "a".repeat(MAX_UNDOABLE_PASTE_BYTES);
    const overLimit = `${atLimit}a`;

    expect(pasteSourceByteLength("中文")).toBe(6);
    expect(isUndoablePasteSource(atLimit)).toBe(true);
    expect(isUndoablePasteSource(overLimit)).toBe(false);
  });
});
