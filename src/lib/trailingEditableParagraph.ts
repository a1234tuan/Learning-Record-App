import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

const managedContainerNames = new Set(["doc", "recordCollapseBlock", "recordHighlightBlock"]);

type ContainerTail = {
  node: ProseMirrorNode;
  pos: number;
};

type TrailingParagraph = {
  containerName: string;
  containerPos: number;
  node: ProseMirrorNode;
  pos: number;
  previous: ProseMirrorNode | null;
};

type AutomaticTrailingParagraph = {
  containerName: string;
  containerPos: number;
  paragraphPos: number;
};

type TrailingEditableParagraphState = {
  automaticParagraphs: readonly AutomaticTrailingParagraph[];
};

type AutomaticParagraphMeta = {
  addedParagraphs: readonly AutomaticTrailingParagraph[];
};

const trailingEditableParagraphKey = new PluginKey<TrailingEditableParagraphState>("trailingEditableParagraph");

const isEmptyParagraph = (node: ProseMirrorNode | null | undefined): boolean =>
  node?.type.name === "paragraph" && node.childCount === 0;

const needsTrailingParagraph = (node: ProseMirrorNode): boolean =>
  managedContainerNames.has(node.type.name) && !isEmptyParagraph(node.lastChild);

const collectMissingContainerTails = (doc: ProseMirrorNode): ContainerTail[] => {
  const tails: ContainerTail[] = [];
  doc.descendants((node, pos) => {
    if (needsTrailingParagraph(node)) {
      tails.push({ node, pos });
    }
  });
  return tails;
};

const collectTrailingParagraphs = (doc: ProseMirrorNode): TrailingParagraph[] => {
  const paragraphs: TrailingParagraph[] = [];
  const collect = (node: ProseMirrorNode, pos: number) => {
    if (!managedContainerNames.has(node.type.name) || !isEmptyParagraph(node.lastChild)) {
      return;
    }
    const lastChild = node.lastChild!;
    const paragraphPos = pos < 0
      ? node.content.size - lastChild.nodeSize
      : pos + node.nodeSize - 1 - lastChild.nodeSize;
    paragraphs.push({
      containerName: node.type.name,
      containerPos: pos,
      node: lastChild,
      pos: paragraphPos,
      previous: node.childCount > 1 ? node.child(node.childCount - 2) : null,
    });
  };

  doc.descendants((node, pos) => collect(node, pos));
  collect(doc, -1);
  return paragraphs;
};

const automaticParagraphsFrom = (tr: Transaction): readonly AutomaticTrailingParagraph[] =>
  (tr.getMeta(trailingEditableParagraphKey) as AutomaticParagraphMeta | undefined)?.addedParagraphs ?? [];

const toAutomaticParagraph = (paragraph: TrailingParagraph): AutomaticTrailingParagraph => ({
  containerName: paragraph.containerName,
  containerPos: paragraph.containerPos,
  paragraphPos: paragraph.pos,
});

const appendTrailingParagraphs = (tr: Transaction, schema: Schema): readonly AutomaticTrailingParagraph[] | undefined => {
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) {
    return undefined;
  }

  const missingTails = collectMissingContainerTails(tr.doc);
  if (needsTrailingParagraph(tr.doc)) {
    // The document is not included by descendants(), so normalize it separately.
    missingTails.push({ node: tr.doc, pos: -1 });
  }
  if (missingTails.length === 0) {
    return undefined;
  }

  // Insert deepest/later containers first. Mapping keeps outer container end positions valid.
  const addedParagraphs: AutomaticTrailingParagraph[] = [];
  missingTails
    .sort((left, right) => right.pos - left.pos)
    .forEach(({ node, pos }) => {
      const end = pos < 0 ? node.content.size : pos + node.nodeSize - 1;
      const insertPos = tr.mapping.map(end);
      tr.insert(insertPos, paragraph.create());
      addedParagraphs.push({
        containerName: node.type.name,
        containerPos: pos,
        paragraphPos: insertPos,
      });
    });
  tr.setMeta("addToHistory", false);
  tr.setMeta(trailingEditableParagraphKey, { addedParagraphs } satisfies AutomaticParagraphMeta);
  return addedParagraphs;
};

const removeRestoredAutomaticParagraphs = (tr: Transaction, state: TrailingEditableParagraphState | undefined): boolean => {
  if (!state || state.automaticParagraphs.length === 0) {
    return false;
  }
  const automaticPositions = new Set(state.automaticParagraphs.map((paragraph) => paragraph.paragraphPos));
  const restored = collectTrailingParagraphs(tr.doc)
    .filter((paragraph) => automaticPositions.has(paragraph.pos) && isEmptyParagraph(paragraph.previous))
    .sort((left, right) => right.pos - left.pos);
  if (restored.length === 0) {
    return false;
  }

  restored.forEach((paragraph) => {
    const from = tr.mapping.map(paragraph.pos);
    tr.delete(from, from + paragraph.node.nodeSize);
  });
  tr.setMeta("addToHistory", false);
  return true;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trailingEditableParagraph: {
      ensureTrailingEditableParagraph: () => ReturnType;
    };
  }
}

export const TrailingEditableParagraph = Extension.create({
  name: "trailingEditableParagraph",

  addCommands() {
    return {
      ensureTrailingEditableParagraph: () => ({ state, dispatch }) => {
        const tr = state.tr;
        if (!appendTrailingParagraphs(tr, state.schema)) {
          return false;
        }
        dispatch?.(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: trailingEditableParagraphKey,
        state: {
          init: (): TrailingEditableParagraphState => ({ automaticParagraphs: [] }),
          apply: (tr, value: TrailingEditableParagraphState, _oldState, newState): TrailingEditableParagraphState => {
            if (tr.getMeta("preventUpdate")) {
              return { automaticParagraphs: [] };
            }
            const trailingParagraphs = collectTrailingParagraphs(newState.doc);
            const findCurrentParagraph = (paragraphPos: number, containerName: string) =>
              trailingParagraphs.find((paragraph) => paragraph.pos === paragraphPos && paragraph.containerName === containerName);
            const mapped = value.automaticParagraphs
              .map((automatic) => {
                const mappedParagraph = findCurrentParagraph(tr.mapping.map(automatic.paragraphPos, 1), automatic.containerName);
                if (mappedParagraph) {
                  return toAutomaticParagraph(mappedParagraph);
                }
                if (!isHistoryTransaction(tr)) {
                  return undefined;
                }
                const mappedContainerPos = automatic.containerPos < 0 ? -1 : tr.mapping.map(automatic.containerPos, 1);
                const restoredParagraph = trailingParagraphs.find((paragraph) =>
                  paragraph.containerName === automatic.containerName && paragraph.containerPos === mappedContainerPos,
                );
                return restoredParagraph ? toAutomaticParagraph(restoredParagraph) : undefined;
              })
              .filter((paragraph): paragraph is AutomaticTrailingParagraph => Boolean(paragraph));
            const added = automaticParagraphsFrom(tr)
              .filter((automatic) => findCurrentParagraph(automatic.paragraphPos, automatic.containerName));
            const automaticParagraphs = [...mapped, ...added].filter((automatic, index, all) =>
              all.findIndex((candidate) => candidate.paragraphPos === automatic.paragraphPos) === index,
            );
            return { automaticParagraphs };
          },
        },
        appendTransaction: (transactions, _oldState, newState) => {
          if (
            !transactions.some((transaction) => transaction.docChanged) ||
            transactions.some((transaction) => transaction.getMeta("preventUpdate"))
          ) {
            return null;
          }

          const tr = newState.tr;
          if (transactions.some(isHistoryTransaction) && removeRestoredAutomaticParagraphs(tr, trailingEditableParagraphKey.getState(newState))) {
            return tr;
          }
          return appendTrailingParagraphs(tr, newState.schema) ? tr : null;
        },
      }),
    ];
  },
});
