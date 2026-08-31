import type { RecordBlock } from "../types";

const EMBEDDED_LEARNING_CONTENT = /<record-(?:formula|inline-math|asset|mermaid-diagram|code-block|collapse)\b/i;

export const recordLearningText = (record: Pick<RecordBlock, "contentHtml">): string =>
  record.contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The single deterministic definition used by Coach activity and task completion. */
export const isMeaningfulLearningRecord = (record: RecordBlock | undefined): record is RecordBlock =>
  Boolean(record && !record.deletedAt && (recordLearningText(record).length > 0 || EMBEDDED_LEARNING_CONTENT.test(record.contentHtml)));
