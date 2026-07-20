import MarkdownIt from "markdown-it";
import { defaultMarkdownParser, MarkdownParser } from "prosemirror-markdown";
import type { Schema } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";

import { normalizeClipboardText } from "./clipboard";
import { newId } from "./entity";
import { createComparisonColumn, createComparisonRow, serializeStructureData } from "./recordStructureBlocks";

export const MAX_MARKDOWN_PASTE_LENGTH = 262144;

type MarkdownState = {
  src: string;
  pos: number;
  max: number;
};

type MarkdownBlockState = {
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  src: string;
  lineMax: number;
  line: number;
};

export const normalizeCodeLanguage = (language: string | null | undefined): string | null => {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case "plain":
    case "plaintext":
    case "text":
      return null;
    case "c++":
    case "cc":
    case "cpp":
    case "cxx":
      return "cpp";
    case "java":
      return "java";
    case "py":
    case "python":
      return "python";
    case "js":
    case "javascript":
    case "node":
    case "nodejs":
    case "ts":
    case "typescript":
      return "javascript";
    default:
      return normalized;
  }
};

const findUnescapedDollar = (source: string, start: number): number => {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] !== "$" || source[index - 1] === "\\") {
      continue;
    }
    return index;
  }
  return -1;
};

const mathInlineRule = (state: MarkdownState, silent: boolean): boolean => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 36 || state.src.charCodeAt(start + 1) === 36) {
    return false;
  }
  const end = findUnescapedDollar(state.src, start + 1);
  if (end < 0 || end === start + 1 || state.src.slice(start + 1, end).includes("\n")) {
    return false;
  }
  if (!silent) {
    const token = (state as unknown as { push: (type: string, tag: string, nesting: number) => { content: string; meta?: unknown } })
      .push("math_inline", "math", 0);
    token.content = state.src.slice(start + 1, end);
    token.meta = { formulaId: newId() };
  }
  state.pos = end + 1;
  return true;
};

const mathBlockRule = (state: unknown, startLine: number, endLine: number, silent: boolean): boolean => {
  const blockState = state as MarkdownBlockState & {
    getLines: (begin: number, end: number, indent: number, keepLastLF: boolean) => string;
  };
  if (startLine >= blockState.lineMax) {
    return false;
  }
  const start = blockState.bMarks[startLine] + blockState.tShift[startLine];
  const end = blockState.eMarks[startLine];
  const line = blockState.src.slice(start, end).trim();
  const singleLineMatch = /^\$\$([\s\S]*?)\$\$$/.exec(line);
  if (singleLineMatch?.[1].trim()) {
    if (silent) {
      return true;
    }
    const token = (blockState as unknown as { push: (type: string, tag: string, nesting: number) => { content: string; meta?: unknown; map?: number[] } })
      .push("math_block", "math", 0);
    token.content = singleLineMatch[1].trim();
    token.meta = { formulaId: newId() };
    token.map = [startLine, startLine + 1];
    blockState.line = startLine + 1;
    return true;
  }
  if (line !== "$$") {
    return false;
  }
  let nextLine = startLine + 1;
  while (nextLine < endLine) {
    const lineStart = blockState.bMarks[nextLine] + blockState.tShift[nextLine];
    const lineEnd = blockState.eMarks[nextLine];
    if (blockState.src.slice(lineStart, lineEnd).trim() === "$$") {
      break;
    }
    nextLine += 1;
  }
  if (nextLine >= endLine || silent) {
    return nextLine < endLine;
  }
  const content = blockState.getLines(startLine + 1, nextLine, 0, true).trim();
  const token = (blockState as unknown as { push: (type: string, tag: string, nesting: number) => { content: string; meta?: unknown; map?: number[] } })
    .push("math_block", "math", 0);
  token.content = content;
  token.meta = { formulaId: newId() };
  token.map = [startLine, nextLine + 1];
  blockState.line = nextLine + 1;
  return true;
};

const tableLine = (state: MarkdownBlockState, line: number): string => {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
};

const splitTableRow = (source: string): string[] | undefined => {
  let row = source.trim();
  if (!row.includes("|")) {
    return undefined;
  }
  if (row.startsWith("|")) {
    row = row.slice(1);
  }
  if (row.endsWith("|")) {
    row = row.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  let codeDelimiterLength = 0;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === "\\" && row[index + 1] === "|") {
      cell += "\\|";
      index += 1;
      continue;
    }
    if (character === "`") {
      let runEnd = index + 1;
      while (row[runEnd] === "`") {
        runEnd += 1;
      }
      const runLength = runEnd - index;
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (codeDelimiterLength === runLength) {
        codeDelimiterLength = 0;
      }
      cell += row.slice(index, runEnd);
      index = runEnd - 1;
      continue;
    }
    if (character === "|" && codeDelimiterLength === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
};

const isTableSeparator = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));

const markdownTableRule = (state: unknown, startLine: number, endLine: number, silent: boolean): boolean => {
  const blockState = state as MarkdownBlockState & {
    push: (type: string, tag: string, nesting: number) => { meta?: unknown; map?: number[] };
  };
  if (startLine + 1 >= endLine || startLine >= blockState.lineMax) {
    return false;
  }
  const headers = splitTableRow(tableLine(blockState, startLine));
  const separator = splitTableRow(tableLine(blockState, startLine + 1));
  if (!headers || !separator || headers.length !== separator.length || !isTableSeparator(separator)) {
    return false;
  }

  let nextLine = startLine + 2;
  const rows: string[][] = [];
  while (nextLine < endLine) {
    const row = splitTableRow(tableLine(blockState, nextLine));
    if (!row || row.length !== headers.length) {
      break;
    }
    rows.push(row);
    nextLine += 1;
  }
  if (silent) {
    return true;
  }

  const columns = headers.map((label) => createComparisonColumn(label));
  const dataRows = rows.map((cells) => {
    const row = createComparisonRow(columns);
    for (const [index, column] of columns.entries()) {
      row.cells[column.id] = cells[index] ?? "";
    }
    return row;
  });
  const token = blockState.push("markdown_table", "table", 0);
  token.meta = {
    data: serializeStructureData({ title: "", columns, rows: dataRows }),
  };
  token.map = [startLine, nextLine];
  blockState.line = nextLine;
  return true;
};

const createMarkdownIt = (): MarkdownIt => {
  const markdown = new MarkdownIt({ html: false, breaks: false, linkify: false, typographer: false });
  markdown.disable("image");
  markdown.disable("table");
  markdown.inline.ruler.before("escape", "math_inline", mathInlineRule as never);
  markdown.block.ruler.before("fence", "math_block", mathBlockRule as never, { alt: ["paragraph", "reference", "blockquote", "list"] });
  markdown.block.ruler.before("fence", "markdown_table", markdownTableRule as never, { alt: ["paragraph", "reference"] });
  return markdown;
};

const { image: _unsupportedImageToken, ...supportedMarkdownTokens } = defaultMarkdownParser.tokens;

const markdownTokens = {
  ...supportedMarkdownTokens,
  list_item: {
    ...defaultMarkdownParser.tokens.list_item,
    block: "listItem",
  },
  bullet_list: {
    ...defaultMarkdownParser.tokens.bullet_list,
    block: "bulletList",
  },
  ordered_list: {
    ...defaultMarkdownParser.tokens.ordered_list,
    block: "orderedList",
    getAttrs: (token: { attrGet: (name: string) => string | null }) => ({
      start: Number(token.attrGet("start")) || 1,
    }),
  },
  code_block: {
    ...defaultMarkdownParser.tokens.code_block,
    block: "codeBlock",
    getAttrs: () => ({ language: null }),
  },
  fence: {
    ...defaultMarkdownParser.tokens.fence,
    block: "codeBlock",
    getAttrs: (token: { info?: string }) => ({
      language: normalizeCodeLanguage(token.info?.trim().split(/\s+/)[0]),
    }),
  },
  hr: {
    ...defaultMarkdownParser.tokens.hr,
    node: "horizontalRule",
  },
  hardbreak: {
    ...defaultMarkdownParser.tokens.hardbreak,
    node: "hardBreak",
  },
  em: {
    ...defaultMarkdownParser.tokens.em,
    mark: "italic",
  },
  strong: {
    ...defaultMarkdownParser.tokens.strong,
    mark: "bold",
  },
  math_inline: {
    node: "recordInlineMath",
    noCloseToken: true,
    getAttrs: (token: { content: string; meta?: { formulaId?: string } }) => ({
      formulaId: token.meta?.formulaId ?? newId(),
      latex: token.content,
    }),
  },
  math_block: {
    node: "recordFormula",
    noCloseToken: true,
    getAttrs: (token: { content: string; meta?: { formulaId?: string } }) => ({
      formulaId: token.meta?.formulaId ?? newId(),
      title: "",
      latex: token.content,
    }),
  },
  markdown_table: {
    node: "recordComparisonTable",
    noCloseToken: true,
    getAttrs: (token: { meta?: { data?: string } }) => ({
      data: token.meta?.data ?? serializeStructureData({ title: "", columns: [], rows: [] }),
      format: "markdown",
    }),
  },
};

export const markdownToTiptapContent = (schema: Schema, source: string): JSONContent[] => {
  const parser = new MarkdownParser(schema, createMarkdownIt(), markdownTokens);
  const document = parser.parse(source);
  return document.content.toJSON() as JSONContent[];
};

const markdownBlockPattern = /(^|\n)[ \t]{0,3}(?:#{1,6}(?=\s)|>\s|(?:[-+*]|\d+[.)])\s|```|~~~|\$\$|(?:-{3,}|_{3,}|\*{3,})[ \t]*$)/m;
const markdownTablePattern = /(^|\n)[ \t]*\|?[^|\n]+(?:\|[^|\n]+)+\|?[ \t]*\n[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*(?:\n|$)/m;
const markdownInlinePattern = /(?<!\\)(?:\*\*(?!\s)[^*\n]+?(?<!\\)\*\*(?!\*)|__(?!\s)[^_\n]+?(?<!\\)__(?!_)|\*(?![\s*])[^*\n]+?(?<!\\)\*(?!\*)|_(?![\s_])[^_\n]+?(?<!\\)_(?!_)|`[^`\n]+`|\[[^\]\n]+\]\([^\)\n]+\)|\$[^$\n]+\$)/;

export const looksLikeMarkdown = (source: string): boolean =>
  markdownBlockPattern.test(source) || markdownTablePattern.test(source) || markdownInlinePattern.test(source);

export const selectMarkdownPasteSource = (
  markdown: string,
  plainText: string,
): string | undefined => selectMarkdownPasteSources([markdown, plainText])[0];

export const selectMarkdownPasteSources = (
  candidates: readonly (string | undefined)[],
): string[] => {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = normalizeClipboardText(candidate);
    if (
      !normalized ||
      normalized.length > MAX_MARKDOWN_PASTE_LENGTH ||
      !looksLikeMarkdown(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    sources.push(normalized);
  }
  return sources;
};
