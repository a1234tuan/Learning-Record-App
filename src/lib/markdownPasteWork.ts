export type MarkdownPasteChunkKind = "blank" | "code" | "formula" | "table" | "list" | "quote" | "heading" | "rule" | "paragraph";

export type MarkdownPasteChunk = {
  source: string;
  kind: MarkdownPasteChunkKind;
  formulaCount: number;
};

export type MarkdownPasteAssessment = {
  chunks: MarkdownPasteChunk[];
  blockCount: number;
  formulaCount: number;
  heavyBytes: number;
  shouldStream: boolean;
  retainRaw: boolean;
};

export const MAX_UNDOABLE_PASTE_BYTES = 512 * 1024;

const textEncoder = new TextEncoder();

export const pasteSourceByteLength = (source: string): number => textEncoder.encode(source).byteLength;

export const isUndoablePasteSource = (source: string): boolean =>
  pasteSourceByteLength(source) <= MAX_UNDOABLE_PASTE_BYTES;

export const MARKDOWN_PASTE_LIMITS = {
  maxSourceLength: 262_144,
  maxStreamBlocks: 500,
  maxStreamFormulas: 120,
  maxStreamChunkLength: 16 * 1024,
  native: {
    immediateLength: 4 * 1024,
    immediateBlocks: 24,
    immediateFormulas: 6,
    immediateHeavyBytes: 4 * 1024,
    batchBlocks: 4,
    batchFormulas: 2,
    batchLength: 4 * 1024,
  },
  web: {
    immediateLength: 12 * 1024,
    immediateBlocks: 80,
    immediateFormulas: 20,
    immediateHeavyBytes: 12 * 1024,
    batchBlocks: 10,
    batchFormulas: 4,
    batchLength: 12 * 1024,
  },
} as const;

type Line = {
  value: string;
  end: number;
};

const headingPattern = /^[ \t]{0,3}#{1,6}(?=\s)/;
const rulePattern = /^[ \t]*(?:-{3,}|_{3,}|\*{3,})[ \t]*$/;
const listPattern = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/;
const quotePattern = /^[ \t]*>/;
const fencePattern = /^[ \t]*(`{3,}|~{3,})/;
const tableDividerCellPattern = /^:?-{3,}:?$/;

const isBlank = (line: string): boolean => /^[ \t]*$/.test(line);

const isTableDivider = (line: string): boolean => {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => tableDividerCellPattern.test(cell));
};

const isTableRow = (line: string): boolean => line.includes("|") && !isBlank(line);

const countFormulas = (source: string): number => {
  const withoutCode = source
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[\s\S]*?\2[ \t]*(?=\n|$)/g, "")
    .replace(/`[^`\n]*`/g, "");
  const blockCount = (withoutCode.match(/(^|\n)[ \t]*\$\$/g) ?? []).length / 2;
  const inlineCount = (withoutCode.match(/(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$(?!\$)/g) ?? []).length;
  return Math.floor(blockCount) + inlineCount;
};

const makeChunk = (source: string, kind: MarkdownPasteChunkKind): MarkdownPasteChunk => ({
  source,
  kind,
  formulaCount: countFormulas(source),
});

const toLines = (source: string): Line[] => {
  const lines: Line[] = [];
  let offset = 0;
  source.split("\n").forEach((value, index, all) => {
    offset += value.length;
    if (index < all.length - 1) {
      offset += 1;
    }
    lines.push({ value, end: offset });
  });
  return lines;
};

const consumeTrailingBlankLines = (lines: readonly Line[], index: number): number => {
  let next = index;
  while (next < lines.length && isBlank(lines[next].value)) {
    next += 1;
  }
  return next;
};

const isBlockStart = (lines: readonly Line[], index: number): boolean => {
  const line = lines[index]?.value ?? "";
  return headingPattern.test(line)
    || rulePattern.test(line)
    || fencePattern.test(line)
    || line.trim() === "$$"
    || listPattern.test(line)
    || quotePattern.test(line)
    || (index + 1 < lines.length && isTableRow(line) && isTableDivider(lines[index + 1].value));
};

/**
 * Splits only at supported Markdown block boundaries. Chunks deliberately keep
 * surrounding blank lines so a cancelled conversion still preserves raw text.
 */
export const splitMarkdownPasteSource = (source: string): MarkdownPasteChunk[] => {
  const lines = toLines(source);
  const chunks: MarkdownPasteChunk[] = [];
  let index = 0;
  let start = 0;

  const push = (nextIndex: number, kind: MarkdownPasteChunkKind) => {
    const end = nextIndex > 0 ? lines[nextIndex - 1].end : 0;
    const chunk = source.slice(start, end);
    if (chunk) {
      chunks.push(makeChunk(chunk, kind));
    }
    start = end;
    index = nextIndex;
  };

  while (index < lines.length) {
    const line = lines[index].value;
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = fencePattern.exec(line)?.[1];
    if (fence) {
      let next = index + 1;
      const closing = new RegExp(`^[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
      while (next < lines.length && !closing.test(lines[next].value)) {
        next += 1;
      }
      if (next < lines.length) {
        next += 1;
      }
      push(consumeTrailingBlankLines(lines, next), "code");
      continue;
    }

    if (line.trim() === "$$") {
      let next = index + 1;
      while (next < lines.length && lines[next].value.trim() !== "$$") {
        next += 1;
      }
      if (next < lines.length) {
        next += 1;
      }
      push(consumeTrailingBlankLines(lines, next), "formula");
      continue;
    }

    if (index + 1 < lines.length && isTableRow(line) && isTableDivider(lines[index + 1].value)) {
      let next = index + 2;
      while (next < lines.length && isTableRow(lines[next].value)) {
        next += 1;
      }
      push(consumeTrailingBlankLines(lines, next), "table");
      continue;
    }

    if (listPattern.test(line) || quotePattern.test(line)) {
      const kind = quotePattern.test(line) ? "quote" : "list";
      let next = index + 1;
      while (next < lines.length) {
        const candidate = lines[next].value;
        if (isBlank(candidate)) {
          const afterBlank = consumeTrailingBlankLines(lines, next);
          if (afterBlank < lines.length && (listPattern.test(lines[afterBlank].value) || quotePattern.test(lines[afterBlank].value) || /^[ \t]+/.test(lines[afterBlank].value))) {
            next = afterBlank;
            continue;
          }
          next = afterBlank;
          break;
        }
        if (listPattern.test(candidate) || quotePattern.test(candidate) || /^[ \t]+/.test(candidate)) {
          next += 1;
          continue;
        }
        break;
      }
      push(next, kind);
      continue;
    }

    if (headingPattern.test(line)) {
      push(consumeTrailingBlankLines(lines, index + 1), "heading");
      continue;
    }
    if (rulePattern.test(line)) {
      push(consumeTrailingBlankLines(lines, index + 1), "rule");
      continue;
    }

    let next = index + 1;
    while (next < lines.length && !isBlank(lines[next].value) && !isBlockStart(lines, next)) {
      next += 1;
    }
    push(consumeTrailingBlankLines(lines, next), "paragraph");
  }

  if (start < source.length) {
    chunks.push(makeChunk(source.slice(start), "blank"));
  }
  return chunks.length > 0 ? chunks : [makeChunk(source, "paragraph")];
};

export const assessMarkdownPaste = (source: string, native: boolean): MarkdownPasteAssessment => {
  const chunks = splitMarkdownPasteSource(source);
  const formulaCount = chunks.reduce((total, chunk) => total + chunk.formulaCount, 0);
  const heavyBytes = chunks
    .filter((chunk) => chunk.kind === "code" || chunk.kind === "table")
    .reduce((total, chunk) => total + chunk.source.length, 0);
  const budget = native ? MARKDOWN_PASTE_LIMITS.native : MARKDOWN_PASTE_LIMITS.web;
  const retainRaw = source.length > MARKDOWN_PASTE_LIMITS.maxSourceLength
    || chunks.length > MARKDOWN_PASTE_LIMITS.maxStreamBlocks
    || formulaCount > MARKDOWN_PASTE_LIMITS.maxStreamFormulas
    || chunks.some((chunk) => chunk.source.length > MARKDOWN_PASTE_LIMITS.maxStreamChunkLength);
  const shouldStream = !retainRaw && (
    source.length > budget.immediateLength
    || chunks.length > budget.immediateBlocks
    || formulaCount > budget.immediateFormulas
    || heavyBytes > budget.immediateHeavyBytes
  );
  return { chunks, blockCount: chunks.length, formulaCount, heavyBytes, shouldStream, retainRaw };
};
