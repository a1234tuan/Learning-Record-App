import { Extension, InputRule, markInputRule } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import { newId } from "./entity";

const strongStarInput = /(?<!\\)\*\*(?!\s)([^*\n]+?)\*\*(?!\*)$/;
const strongUnderscoreInput = /(?<!\\)__(?!\s)([^_\n]+?)__(?!_)$/;
const italicStarInput = /(?<!\\)\*(?![\s*])([^*\n]+?)\*(?!\*)$/;
const italicUnderscoreInput = /(?<!\\)_(?![\s_])([^_\n]+?)_(?!_)$/;
const inlineMathInput = /(?<!\\)\$([^$\n]+?)\$(?!\$)$/;
const blockMathInput = /^\$\$(?:\s|\n)$/;

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
});
