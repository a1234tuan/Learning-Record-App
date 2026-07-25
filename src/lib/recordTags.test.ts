import { describe, expect, it } from "vitest";

import type { RecordBlock } from "../types";
import {
  getSubjectRecordTags,
  normalizeRecordTags,
  sameRecordTags,
  stableRecordTagHue,
} from "./recordTags";

const record = (id: string, subject: string, tags: unknown): RecordBlock => ({
  id,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
  type: "record",
  date: "2026-07-25",
  order: 0,
  subject,
  tags: tags as string[],
  title: id,
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

describe("record tags", () => {
  it("trims values, ignores invalid entries, and deduplicates without changing the first display name", () => {
    expect(normalizeRecordTags(["  重点  ", "重点", "重点 ", "", 3, "公式"])).toEqual(["重点", "公式"]);
  });

  it("uses a stable subject-scoped color and treats missing legacy tags as needing migration", () => {
    expect(stableRecordTagHue("数学", "重点")).toBe(stableRecordTagHue("数学", "重点"));
    expect(sameRecordTags(undefined, [])).toBe(false);
  });

  it("collects suggestions only from the active subject", () => {
    const tags = getSubjectRecordTags([
      record("math-1", "数学", ["重点", "积分"]),
      record("math-2", " 数学 ", ["重点", "公式"]),
      record("physics-1", "物理", ["重点", "力学"]),
    ], "数学");

    expect(tags).toEqual(expect.arrayContaining(["重点", "积分", "公式"]));
    expect(tags).not.toContain("力学");
  });
});
