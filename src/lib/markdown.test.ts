import { describe, expect, it } from "vitest";

import type { Block, DayEntry } from "../types";
import { entryToMarkdown } from "./markdown";

describe("entryToMarkdown", () => {
  it("serializes rich text, formula and todo blocks", () => {
    const entry: DayEntry = {
      id: "e1",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      date: "2026-06-21",
      title: "今天",
      tags: ["数学"],
      pinned: false,
      favorite: false,
    };
    const blocks: Block[] = [
      {
        id: "b1",
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        date: entry.date,
        order: 0,
        type: "richText",
        content: "<h2>今日学了什么</h2><p>高数</p>",
      },
      {
        id: "b2",
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        date: entry.date,
        order: 1,
        type: "formula",
        latex: "a^2+b^2=c^2",
      },
    ];

    const markdown = entryToMarkdown(entry, blocks);
    expect(markdown).toContain("## 今日学了什么");
    expect(markdown).toContain("$$");
    expect(markdown).toContain("a^2+b^2=c^2");
  });
});
