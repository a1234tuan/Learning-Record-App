import type { RecordBlock, Subject } from "../types";

export const normalizeRecordTag = (value: string): string => value.trim();

export const recordTagKey = (value: string): string => normalizeRecordTag(value).toLocaleLowerCase("zh-CN");

export const normalizeRecordTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const tag = normalizeRecordTag(item);
    const key = recordTagKey(tag);
    if (!tag || seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }
  return tags;
};

export const normalizeRecordTagsOnRecord = (record: RecordBlock): RecordBlock => ({
  ...record,
  tags: normalizeRecordTags(record.tags),
});

export const sameRecordTags = (left: readonly string[] | undefined, right: readonly string[]): boolean => {
  return Array.isArray(left) && left.length === right.length && left.every((tag, index) => tag === right[index]);
};

export const subjectTagKey = (subject: Subject, tag: string): string =>
  `${subject.trim().toLocaleLowerCase("zh-CN")}\u0000${recordTagKey(tag)}`;

export const stableRecordTagHue = (subject: Subject, tag: string): number => {
  let hash = 0;
  for (const character of subjectTagKey(subject, tag)) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash % 360;
};

export const getSubjectRecordTags = (records: readonly RecordBlock[], subject: Subject): string[] => {
  const canonicalSubject = subject.trim().toLocaleLowerCase("zh-CN");
  const unique = new Map<string, string>();
  for (const record of records) {
    if (record.subject.trim().toLocaleLowerCase("zh-CN") !== canonicalSubject) {
      continue;
    }
    for (const tag of normalizeRecordTags(record.tags)) {
      unique.set(recordTagKey(tag), tag);
    }
  }
  return Array.from(unique.values()).sort((left, right) => left.localeCompare(right, "zh-CN"));
};
