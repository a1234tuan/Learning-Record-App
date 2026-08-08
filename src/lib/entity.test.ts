import { describe, expect, it } from "vitest";

import { deepEqualIgnoring, shallowEqual, touch } from "./entity";

describe("shallowEqual", () => {
  it("treats identical primitive fields as equal regardless of key order", () => {
    expect(shallowEqual({ title: "笔记", pinned: true }, { pinned: true, title: "笔记" })).toBe(true);
  });

  it("detects a changed primitive field", () => {
    expect(shallowEqual({ title: "笔记" }, { title: "笔记（修订）" })).toBe(false);
  });

  it("detects a field present on only one side", () => {
    expect(shallowEqual({ title: "笔记" }, { title: "笔记", summary: "新增摘要" })).toBe(false);
  });

  it("treats undefined and a missing key as equal", () => {
    expect(shallowEqual({ title: "笔记", summary: undefined }, { title: "笔记" })).toBe(true);
  });
});

describe("deepEqualIgnoring", () => {
  it("treats equal content as equal even when object key insertion order differs", () => {
    const a = { id: "1", title: "笔记", meta: { textLength: 10, includedInAi: true } };
    const b = { meta: { includedInAi: true, textLength: 10 }, title: "笔记", id: "1" };
    expect(deepEqualIgnoring(a, b, [])).toBe(true);
  });

  it("ignores the listed keys (e.g. updatedAt) when comparing", () => {
    const a = { title: "笔记", updatedAt: "2026-01-01T00:00:00.000Z" };
    const b = { title: "笔记", updatedAt: "2026-06-01T00:00:00.000Z" };
    expect(deepEqualIgnoring(a, b, ["updatedAt"])).toBe(true);
  });

  it("detects a genuine change in a nested field", () => {
    const a = { title: "笔记", meta: { textLength: 10 } };
    const b = { title: "笔记", meta: { textLength: 20 } };
    expect(deepEqualIgnoring(a, b, [])).toBe(false);
  });

  it("detects a genuine change in an array field, including order", () => {
    const a = { tags: ["重点", "公式"] };
    const b = { tags: ["公式", "重点"] };
    expect(deepEqualIgnoring(a, b, [])).toBe(false);
  });
});

describe("touch", () => {
  it("always bumps updatedAt to a fresh timestamp", () => {
    const entity = { id: "1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const touched = touch(entity);
    expect(touched.updatedAt).not.toBe(entity.updatedAt);
    expect(touched.id).toBe(entity.id);
    expect(touched.createdAt).toBe(entity.createdAt);
  });
});
