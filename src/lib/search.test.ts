import { describe, expect, it } from "vitest";

import type { Asset, DayEntry, RecordBlock } from "../types";
import { searchAllAsync } from "./search";

const stamp = "2026-07-19T00:00:00.000Z";

const record: RecordBlock = {
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-07-19",
  order: 0,
  subject: "数学",
  title: "勾股定理",
  contentHtml: '<p>直角三角形 <record-inline-math data-formula-id="f1" data-latex="a^2+b^2=c^2"></record-inline-math></p>',
  assets: [],
  formulas: [{ id: "f1", latex: "a^2+b^2=c^2" }],
  mistakeRefs: [],
};

describe("searchAllAsync", () => {
  it("searches semantic text and inline formulas without rendering editor content", async () => {
    const results = await searchAllAsync("a^2+b^2", [] as DayEntry[], [record], [] as Asset[]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ recordId: "record-1", matchSource: "content" });
  });

  it("honors cancellation before a large scan", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(searchAllAsync("勾股", [], [record], [], 201, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
