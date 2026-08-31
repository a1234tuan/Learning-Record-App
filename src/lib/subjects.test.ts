import { describe, expect, it } from "vitest";

import type { AppSettings, RecordBlock } from "../types";
import {
  createDefaultSubjects,
  createSubjectConfig,
  ensureSettingsSubjects,
  getActiveSubjects,
  getAllVisibleSubjects,
  normalizeSubjectName,
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
  tags: [],
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
    expect(migrated.subjects?.map((subject) => subject.name)).toEqual(["OS", "计组", "计网", "数据结构", "数学", "英语", "政治", "CS"]);
  });

  it("exports defaults and inferred subjects deterministically", () => {
    expect(createDefaultSubjects()).toEqual(createDefaultSubjects());
    const first = ensureSettingsSubjects(settings(), [record("物理")]);
    const second = ensureSettingsSubjects(settings(), [record("物理")]);
    expect(first.subjects).toEqual(second.subjects);
  });

  it("keeps an unknown historical subject only when a record still references it", () => {
    const legacy = ["读书笔记", "数学", "英语", "其他"].map((name, order) => createSubjectConfig(name, order));
    const migrated = ensureSettingsSubjects(settings(legacy), [record("其他")]);

    expect(migrated.subjects?.map((subject) => subject.name)).toContain("其他");
    expect(migrated.subjects?.map((subject) => subject.name)).toEqual(["OS", "计组", "计网", "数据结构", "数学", "英语", "政治", "CS", "其他"]);
  });

  it("replaces the old exam-biased default subject set while keeping referenced legacy subjects", () => {
    const legacySubjects = ["计组", "OS", "计网", "数据结构", "数学", "英语", "政治"].map((name, order) =>
      createSubjectConfig(name, order),
    );
    const migrated = ensureSettingsSubjects(settings(legacySubjects), [record("OS")]);

    expect(migrated.subjects?.map((subject) => subject.name)).toEqual(["OS", "计组", "计网", "数据结构", "数学", "英语", "政治", "CS"]);
  });

  it("maps legacy exam labels to canonical identities without changing unrelated labels", () => {
    expect(normalizeSubjectName("操作系统")).toBe("OS");
    expect(normalizeSubjectName("组成原理")).toBe("计组");
    expect(normalizeSubjectName("计算机网络")).toBe("计网");
    expect(normalizeSubjectName("其他")).toBe("其他");
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
