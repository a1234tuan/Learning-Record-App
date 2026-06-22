import { describe, expect, it } from "vitest";

import type { AppSettings, RecordBlock } from "../types";
import {
  createDefaultSubjects,
  createSubjectConfig,
  ensureSettingsSubjects,
  getActiveSubjects,
  getAllVisibleSubjects,
  validateSubjectName,
} from "./subjects";

const stamp = "2026-06-21T00:00:00.000Z";

const settings = (subjects = createDefaultSubjects()): AppSettings => ({
  id: "settings",
  examDate: "2026-12-27",
  theme: "system",
  accentColor: "#2f6f5e",
  backupReminderDays: 7,
  fontScale: 1,
  lineHeight: 1.7,
  subjects,
  schemaVersion: 3,
});

const record = (subject: string): RecordBlock => ({
  id: subject,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject,
  title: `${subject}记录块1`,
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

describe("dynamic subjects", () => {
  it("creates default subjects for migrated settings", () => {
    const migrated = ensureSettingsSubjects({ ...settings([]), subjects: undefined, schemaVersion: 2 }, []);

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.subjects?.map((subject) => subject.name)).toContain("数据结构");
  });

  it("adds unknown record subjects during migration", () => {
    const migrated = ensureSettingsSubjects(settings(), [record("物理")]);

    expect(migrated.subjects?.map((subject) => subject.name)).toContain("物理");
  });

  it("hides archived subjects from creation but keeps visible ones with records", () => {
    const archived = createSubjectConfig("归档课", 0, stamp);
    const currentSettings = settings([archived, createSubjectConfig("英语", 1)]);

    expect(getActiveSubjects(currentSettings).map((subject) => subject.name)).toEqual(["英语"]);
    expect(getAllVisibleSubjects(currentSettings, [record("归档课")]).map((subject) => subject.name)).toContain("归档课");
  });

  it("validates duplicate subject names", () => {
    expect(validateSubjectName("英语", settings().subjects ?? [])).toBe("已经有同名学科。");
    expect(validateSubjectName("英语", settings().subjects ?? [], "英语")).toBeUndefined();
  });
});
