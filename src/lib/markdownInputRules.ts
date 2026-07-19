import { Extension, InputRule, markInputRule } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { newId } from "./entity";

const strongStarInput = /(?<!\\)\*\*(?!\s)([^*\n]+?)\*\*(?!\*)$/;
const strongUnderscoreInput = /(?<!\\)__(?!\s)([^_\n]+?)__(?!_)$/;
const italicStarInput = /(?<!\\)\*(?![\s*])([^*\n]+?)\*(?!\*)$/;
const italicUnderscoreInput = /(?<!\\)_(?![\s_])([^_\n]+?)_(?!_)$/;
const inlineMathInput = /(?<!\\)\$([^$\n]+?)\$(?!\$)$/;
const blockMathInput = /^\$\$(?:\s|\n)$/;

const hasOpenInlineCode = (source: string, end = source.length): boolean => {
  let openDelimiterLength = 0;
  for (let index = 0; index < end;) {
    if (source[index] !== "`" || source[index - 1] === "\\") {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (runEnd < end && source[runEnd] === "`") {
      runEnd += 1;
    }
    const runLength = runEnd - index;
    if (openDelimiterLength === 0) {
      openDelimiterLength = runLength;
    } else if (openDelimiterLength === runLength) {
      openDelimiterLength = 0;
    }
    index = runEnd;
  }
  return openDelimiterLength > 0;
};

const isCodeContext = (state: EditorState): boolean => {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) {
    return true;
  }
  const code = state.schema.marks.code;
  return Boolean(code && ($from.marks().some((mark) => mark.type === code) || $from.nodeBefore?.marks.some((mark) => mark.type === code)));
};

const composedMarkdownToken = /(?<!\\)\*\*(?!\s)([^*\n]+?)\*\*(?!\*)|(?<!\\)__(?!\s)([^_\n]+?)__(?!_)|(?<!\\)\*(?![\s*])([^*\n]+?)\*(?!\*)|(?<!\\)_(?![\s_])([^_\n]+?)_(?!_)|(?<!\\)\$([^$\n]+?)\$(?!\$)/g;

const transformComposedMarkdown = (state: EditorState): Transaction | null => {
  if (!(state.selection instanceof TextSelection) || !state.selection.empty || isCodeContext(state)) {
    return null;
  }

  const { $from } = state.selection;
  if (!$from.parent.isTextblock) {
    return null;
  }

  const replacements: Array<{
    from: number;
    to: number;
    markerLength: number;
    content: string;
    kind: "bold" | "italic" | "math";
  }> = [];
  const parentStart = $from.start();
  $from.parent.descendants((node, position) => {
    if (!node.isText || node.marks.some((mark) => mark.type === state.schema.marks.code)) {
      return true;
    }
    const text = node.text ?? "";
    composedMarkdownToken.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = composedMarkdownToken.exec(text))) {
      if (hasOpenInlineCode(text, match.index)) {
        continue;
      }
      const contentIndex = match.findIndex((value, index) => index > 0 && Boolean(value));
      const content = contentIndex > 0 ? match[contentIndex] : "";
      if (!content?.trim()) {
        continue;
      }
      replacements.push({
        from: parentStart + position + match.index,
        to: parentStart + position + match.index + match[0].length,
        markerLength: contentIndex === 5 ? 1 : contentIndex <= 2 ? 2 : 1,
        content,
        kind: contentIndex === 5 ? "math" : contentIndex <= 2 ? "bold" : "italic",
      });
    }
    return true;
  });

  if (replacements.length === 0) {
    return null;
  }

  const tr = state.tr;
  const inlineMath = state.schema.nodes.recordInlineMath;
  for (const replacement of replacements.sort((left, right) => right.from - left.from)) {
    if (replacement.kind === "math") {
      if (!inlineMath) {
        continue;
      }
      tr.replaceWith(
        replacement.from,
        replacement.to,
        inlineMath.create({ formulaId: newId(), latex: replacement.content }),
      );
      continue;
    }
    const mark = replacement.kind === "bold" ? state.schema.marks.bold : state.schema.marks.italic;
    if (!mark) {
      continue;
    }
    tr.delete(replacement.from, replacement.from + replacement.markerLength);
    tr.delete(replacement.from + replacement.content.length, replacement.from + replacement.content.length + replacement.markerLength);
    tr.addMark(replacement.from, replacement.from + replacement.content.length, mark.create());
    tr.removeStoredMark(mark);
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(state.selection.from))));
  return tr;
};

const dispatchComposedMarkdownTransform = (view: EditorView) => {
  if (!view.editable || view.composing) {
    return;
  }
  const tr = transformComposedMarkdown(view.state);
  if (tr) {
    view.dispatch(tr.scrollIntoView());
  }
};

export const MarkdownTypingExtension = Extension.create({
  name: "recordMarkdownTyping",

  addInputRules() {
    const bold = this.editor.schema.marks.bold;
    const italic = this.editor.schema.marks.italic;
    const inlineMath = this.editor.schema.nodes.recordInlineMath;
    const blockMath = this.editor.schema.nodes.recordFormula;
    const rules: InputRule[] = [];

    if (bold) {
      rules.push(
        markInputRule({ find: strongStarInput, type: bold }),
        markInputRule({ find: strongUnderscoreInput, type: bold }),
      );
    }
    if (italic) {
      rules.push(
        markInputRule({ find: italicStarInput, type: italic }),
        markInputRule({ find: italicUnderscoreInput, type: italic }),
      );
    }
    if (inlineMath) {
      rules.push(new InputRule({
        find: inlineMathInput,
        handler: ({ state, range, match }) => {
          const latex = match[1] ?? "";
          if (!latex.trim()) {
            return null;
          }
          const node = inlineMath.create({ formulaId: newId(), latex });
          state.tr.replaceWith(range.from, range.to, node);
          state.tr.setSelection(TextSelection.create(state.tr.doc, range.from + node.nodeSize));
        },
      }));
    }
    if (blockMath) {
      rules.push(new InputRule({
        find: blockMathInput,
        handler: ({ state }) => {
          const { $from } = state.selection;
          if ($from.parent.type.name !== "paragraph" || $from.parent.textContent.trim() !== "$$") {
            return null;
          }
          const formula = blockMath.create({ formulaId: newId(), title: "", latex: "", editing: true });
          const paragraph = state.schema.nodes.paragraph.create();
          const from = $from.before();
          state.tr.replaceWith(from, $from.after(), Fragment.fromArray([formula, paragraph]));
          state.tr.setSelection(NodeSelection.create(state.tr.doc, from));
        },
      }));
    }

    return rules;
  },

  addProseMirrorPlugins() {
    let scheduled = false;
    const schedule = (view: EditorView) => {
      if (scheduled) {
        return false;
      }
      scheduled = true;
      // Android may deliver committed text through input without a compositionend event.
      setTimeout(() => {
        scheduled = false;
        dispatchComposedMarkdownTransform(view);
      }, 0);
      return false;
    };
    return [new Plugin({
      props: {
        handleDOMEvents: {
          compositionend: schedule,
          input: schedule,
        },
      },
    })];
  },
});
