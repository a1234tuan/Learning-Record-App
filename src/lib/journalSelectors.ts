import { format } from "date-fns";

import type { Block, RecordBlock, Subject, SubjectConfig } from "../types";
import { normalizeSubjectName } from "./subjects";

export const getRecordBlocks = (blocks: Block[]): RecordBlock[] =>
  blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt);

export const getFavoriteRecords = (records: RecordBlock[]): RecordBlock[] =>
  records
    .filter((record) => record.favorite)
    .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);

export const getRecentRecordDates = (records: RecordBlock[], limit = 5): string[] =>
  Array.from(new Set(records.map((record) => record.date)))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

export const getRecordDatesForMonth = (records: RecordBlock[], month: Date): string[] => {
  const monthKey = format(month, "yyyy-MM");
  return Array.from(new Set(records.map((record) => record.date)))
    .filter((date) => date.startsWith(`${monthKey}-`))
    .sort((a, b) => b.localeCompare(a));
};

const subjectOrderMap = (subjects: SubjectConfig[]): Map<string, number> =>
  new Map(subjects.map((subject, index) => [subject.name, subject.order ?? index]));

export const getSubjectCounts = (
  records: RecordBlock[],
  subjects: SubjectConfig[],
): Array<{ subject: Subject; count: number; config?: SubjectConfig }> => {
  const counts = new Map<Subject, number>();
  for (const record of records) {
    const subject = normalizeSubjectName(record.subject);
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }

  const result: Array<{ subject: Subject; count: number; config?: SubjectConfig }> = subjects.map((subject) => ({
    subject: subject.name,
    count: counts.get(subject.name) ?? 0,
    config: subject,
  }));
  const included = new Set(result.map((item) => item.subject));
  for (const [subject, count] of counts) {
    if (!included.has(subject)) {
      result.push({ subject, count });
    }
  }

  const order = subjectOrderMap(subjects);
  return result.sort((a, b) => (order.get(a.subject) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.subject) ?? Number.MAX_SAFE_INTEGER));
};

export const getRecordsBySubject = (records: RecordBlock[], subject: Subject): RecordBlock[] =>
  records
    .filter((record) => normalizeSubjectName(record.subject) === normalizeSubjectName(subject))
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) {
        return byDate;
      }
      return a.order - b.order;
    });

export const getRecordsForDateSubject = (
  records: RecordBlock[],
  date: string,
  subject: Subject,
): RecordBlock[] =>
  records
    .filter((record) => record.date === date && normalizeSubjectName(record.subject) === normalizeSubjectName(subject))
    .sort((a, b) => a.order - b.order);

export const getSubjectsForRecords = (records: RecordBlock[], subjects: SubjectConfig[]): Array<{ subject: Subject; count: number }> =>
  getSubjectCounts(records, subjects).filter((item) => item.count > 0);
