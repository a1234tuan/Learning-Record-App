import MarkdownIt from "markdown-it";
import { defaultMarkdownParser, MarkdownParser } from "prosemirror-markdown";
import type { Schema } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";

import { newId } from "./entity";

type MarkdownState = {
  src: string;
  pos: number;
  max: number;
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
  const blockState = state as {
    bMarks: number[];
    eMarks: number[];
    tShift: number[];
    sCount: number[];
    src: string;
    lineMax: number;
    getLines: (begin: number, end: number, indent: number, keepLastLF: boolean) => string;
    line: number;
  };
  if (startLine >= blockState.lineMax) {
    return false;
  }
  const start = blockState.bMarks[startLine] + blockState.tShift[startLine];
  const end = blockState.eMarks[startLine];
  if (blockState.src.slice(start, end).trim() !== "$$") {
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

const createMarkdownIt = (): MarkdownIt => {
  const markdown = new MarkdownIt({ html: false, breaks: false, linkify: false, typographer: false });
  markdown.disable("image");
  markdown.inline.ruler.before("escape", "math_inline", mathInlineRule as never);
  markdown.block.ruler.before("fence", "math_block", mathBlockRule as never);
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
      language: token.info?.trim().split(/\s+/)[0] || null,
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
};

export const markdownToTiptapContent = (schema: Schema, source: string): JSONContent[] => {
  const parser = new MarkdownParser(schema, createMarkdownIt(), markdownTokens);
  const document = parser.parse(source);
  return document.content.toJSON() as JSONContent[];
};

export const looksLikeMarkdown = (source: string): boolean =>
  /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|```|~~~|\$\$)/.test(source) ||
  /(?:\*\*|__|`{1,}|\$[^$\n]+\$)/.test(source);
