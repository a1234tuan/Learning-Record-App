import type { AppSettings, RecordBlock, Subject, SubjectConfig } from "../types";
import { nowISO } from "./date";
import { newId } from "./entity";

export const DEFAULT_SUBJECT_NAMES: Subject[] = ["计组", "OS", "计网", "数据结构", "数学", "英语", "政治"];
export const DEFAULT_SUBJECT = "数据结构";

export const normalizeSubjectName = (subject?: string): Subject => {
  const trimmed = subject?.trim();
  if (!trimmed) {
    return DEFAULT_SUBJECT;
  }
  if (trimmed === "408" || trimmed === "其他") {
    return DEFAULT_SUBJECT;
  }
  if (trimmed === "操作系统") {
    return "OS";
  }
  if (trimmed === "计算机网络") {
    return "计网";
  }
  if (trimmed === "组成原理") {
    return "计组";
  }
  return trimmed;
};

export const createSubjectConfig = (name: Subject, order: number, archivedAt?: string): SubjectConfig => {
  const now = nowISO();
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: normalizeSubjectName(name),
    order,
    archivedAt,
  };
};

export const createDefaultSubjects = (): SubjectConfig[] =>
  DEFAULT_SUBJECT_NAMES.map((name, index) => createSubjectConfig(name, index));

const uniqueByName = (subjects: SubjectConfig[]): SubjectConfig[] => {
  const seen = new Set<string>();
  return subjects
    .map((subject) => ({ ...subject, name: normalizeSubjectName(subject.name) }))
    .filter((subject) => {
      if (!subject.name || seen.has(subject.name)) {
        return false;
      }
      seen.add(subject.name);
      return true;
    })
    .sort((a, b) => a.order - b.order)
    .map((subject, index) => ({ ...subject, order: index }));
};

export const deriveSubjectsFromRecords = (
  settingsSubjects: SubjectConfig[] | undefined,
  records: RecordBlock[],
): SubjectConfig[] => {
  const base = settingsSubjects && settingsSubjects.length > 0 ? settingsSubjects : createDefaultSubjects();
  const subjects = uniqueByName(base);
  const known = new Set(subjects.map((subject) => subject.name));
  for (const record of records) {
    const name = normalizeSubjectName(record.subject);
    if (!known.has(name)) {
      known.add(name);
      subjects.push(createSubjectConfig(name, subjects.length));
    }
  }
  return uniqueByName(subjects);
};

export const ensureSettingsSubjects = (settings: AppSettings, records: RecordBlock[] = []): AppSettings => ({
  ...settings,
  subjects: deriveSubjectsFromRecords(settings.subjects, records),
  schemaVersion: 3,
});

export const getActiveSubjects = (settings: AppSettings): SubjectConfig[] =>
  deriveSubjectsFromRecords(settings.subjects, [])
    .filter((subject) => !subject.archivedAt)
    .sort((a, b) => a.order - b.order);

export const getAllSubjects = (settings: AppSettings, records: RecordBlock[] = []): SubjectConfig[] =>
  deriveSubjectsFromRecords(settings.subjects, records);

export const getAllVisibleSubjects = (settings: AppSettings, records: RecordBlock[] = []): SubjectConfig[] => {
  const subjects = getAllSubjects(settings, records);
  const subjectsWithRecords = new Set(records.map((record) => normalizeSubjectName(record.subject)));
  return subjects.filter((subject) => !subject.archivedAt || subjectsWithRecords.has(subject.name));
};

export const validateSubjectName = (
  name: string,
  subjects: SubjectConfig[],
  currentName?: string,
): string | undefined => {
  const normalized = normalizeSubjectName(name);
  if (!normalized) {
    return "学科名称不能为空。";
  }
  const duplicate = subjects.some(
    (subject) => subject.name === normalized && subject.name !== currentName,
  );
  if (duplicate) {
    return "已经有同名学科。";
  }
  if (normalized.length > 24) {
    return "学科名称不宜超过 24 个字符。";
  }
  return undefined;
};

export const nextRecordTitle = (subject: Subject, existingCount: number): string =>
  `${normalizeSubjectName(subject)}记录块${existingCount + 1}`;

export const fallbackSubjectName = (settings: AppSettings): Subject =>
  getActiveSubjects(settings)[0]?.name ?? DEFAULT_SUBJECT;

export const normalizeSubject = normalizeSubjectName;
