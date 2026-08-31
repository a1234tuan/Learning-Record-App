import type { KnowledgePoint, RecordBlock } from "../types";
import { canonicalStudySubject } from "./subjects";

export const normalizeKnowledgePointName = (name: string): string =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");

export const knowledgePointHash = (value: unknown, prefix = "kp"): string => {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
};

export const knowledgePointCatalogFingerprint = (points: KnowledgePoint[]): string => knowledgePointHash(
  points.filter((point) => point.status === "active").map(({ id, subject, normalizedKey, updatedAt }) => [id, canonicalStudySubject(subject), normalizedKey, updatedAt]).sort(),
  "kp-catalog-v1",
);

export const recordKnowledgeFingerprint = (record: Pick<RecordBlock, "id" | "subject" | "title" | "contentHtml" | "updatedAt">): string =>
  knowledgePointHash([record.id, canonicalStudySubject(record.subject), record.title, record.contentHtml, record.updatedAt], "kp-record-v1");
