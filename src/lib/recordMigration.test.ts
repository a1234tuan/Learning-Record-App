import { describe, expect, it } from "vitest";

import type { Block } from "../types";
import { migrateBlocksToRecords } from "./recordMigration";
import { createSubjectConfig, nextRecordTitle } from "./subjects";
import { heatmapLevel } from "../components/MonthlyHeatmap";
import { searchAll } from "./search";
import { getFavoriteRecords, getRecordBlocks, getRecentRecordDates, getRecordsBySubject, getSubjectCounts } from "./journalSelectors";

const stamp = "2026-06-21T00:00:00.000Z";

describe("record migration", () => {
  it("wraps legacy rich text and image blocks into records", () => {
    const blocks: Block[] = [
      {
        id: "b1",
        createdAt: stamp,
        updatedAt: stamp,
        type: "richText",
        date: "2026-06-21",
        order: 0,
        content: "<p>动态规划</p>",
      },
      {
        id: "b2",
        createdAt: stamp,
        updatedAt: stamp,
        type: "image",
        date: "2026-06-21",
        order: 1,
        assetId: "a1",
        caption: "学习截图",
      },
    ];

    const migrated = migrateBlocksToRecords(blocks);

    expect(migrated.every((block) => block.type === "record")).toBe(true);
    expect(migrated[0]).toMatchObject({ type: "record", subject: "数据结构" });
    expect(migrated[1]).toMatchObject({
      type: "record",
      assets: [{ id: "a1", title: "学习截图", kind: "image" }],
    });
  });
});

describe("trash and favorites selectors", () => {
  it("keeps deleted records out of normal journal selectors", () => {
    const records = [
      {
        id: "visible",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record" as const,
        date: "2026-06-21",
        order: 0,
        subject: "OS",
        title: "visible",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
      {
        id: "deleted",
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: "2026-06-22T00:00:00.000Z",
        type: "record" as const,
        date: "2026-06-21",
        order: 1,
        subject: "OS",
        title: "deleted",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
    ];

    expect(getRecordBlocks(records).map((record) => record.id)).toEqual(["visible"]);
  });

  it("sorts favorite records by record date and ignores edited time", () => {
    const records = [
      {
        id: "old-edited",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z",
        type: "record" as const,
        date: "2026-06-01",
        order: 0,
        subject: "OS",
        title: "old edited",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
        favorite: true,
      },
      {
        id: "new-created",
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
        type: "record" as const,
        date: "2026-06-20",
        order: 0,
        subject: "OS",
        title: "new created",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
        favorite: true,
      },
      {
        id: "plain",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record" as const,
        date: "2026-06-21",
        order: 0,
        subject: "OS",
        title: "plain",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
    ];

    expect(getFavoriteRecords(records).map((record) => record.id)).toEqual(["new-created", "old-edited"]);
  });
});

describe("record helpers", () => {
  it("generates subject-based record titles", () => {
    expect(nextRecordTitle("OS", 2)).toBe("OS记录块3");
  });

  it("maps heatmap levels", () => {
    expect(heatmapLevel(0)).toBe(0);
    expect(heatmapLevel(1)).toBe(1);
    expect(heatmapLevel(3)).toBe(2);
    expect(heatmapLevel(4)).toBe(3);
  });

  it("searches attachment and audio titles", () => {
    const results = searchAll(
      "录音",
      [],
      [
        {
          id: "r1",
          createdAt: stamp,
          updatedAt: stamp,
          type: "record",
          date: "2026-06-21",
          order: 0,
          subject: "OS",
          title: "OS记录块1",
          contentHtml: "<p></p>",
          assets: [{ id: "a1", title: "进程同步录音", kind: "audio" }],
          formulas: [],
          mistakeRefs: [],
        },
      ],
      [],
    );

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("OS记录块1");
  });

  it("searches image OCR text and returns record/asset jump info", () => {
    const results = searchAll(
      "手写笔记",
      [],
      [
        {
          id: "r1",
          createdAt: stamp,
          updatedAt: stamp,
          type: "record",
          date: "2026-06-21",
          order: 0,
          subject: "数据结构",
          title: "数据结构记录块1",
          contentHtml: "<p></p>",
          assets: [{ id: "a1", title: "截图", kind: "image" }],
          formulas: [],
          mistakeRefs: [],
        },
      ],
      [
        {
          id: "a1",
          createdAt: stamp,
          updatedAt: stamp,
          fileName: "note.png",
          title: "截图",
          mimeType: "image/png",
          size: 1,
          kind: "image",
          data: new Blob(["x"], { type: "image/png" }),
          ocrStatus: "done",
          ocrText: "这是一张手写笔记",
        },
      ],
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      recordId: "r1",
      assetId: "a1",
      matchSource: "assetOcr",
    });
  });

  it("summarizes subject counts and recent days", () => {
    const records = [
      {
        id: "r1",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record" as const,
        date: "2026-06-21",
        order: 0,
        subject: "OS" as const,
        title: "OS记录块1",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: ["old"],
      },
      {
        id: "r2",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record" as const,
        date: "2026-06-20",
        order: 0,
        subject: "数学" as const,
        title: "数学记录块1",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
      {
        id: "r3",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record" as const,
        date: "2026-06-19",
        order: 0,
        subject: "OS" as const,
        title: "OS记录块2",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
    ];

    expect(getSubjectCounts(records, [createSubjectConfig("OS", 0), createSubjectConfig("数学", 1)]).find((item) => item.subject === "OS")?.count).toBe(2);
    expect(getRecentRecordDates(records, 2)).toEqual(["2026-06-21", "2026-06-20"]);
    expect(getRecordsBySubject(records, "OS").map((record) => record.id)).toEqual(["r1", "r3"]);
  });

  it("sorts journal records by record date instead of updated time", () => {
    const records = [
      {
        id: "old-edited",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z",
        type: "record" as const,
        date: "2026-06-01",
        order: 0,
        subject: "OS",
        title: "旧记录后来修改",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
      {
        id: "new-created",
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
        type: "record" as const,
        date: "2026-06-20",
        order: 0,
        subject: "OS",
        title: "较新的创建日期",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
    ];

    expect(getRecentRecordDates(records, 2)).toEqual(["2026-06-20", "2026-06-01"]);
    expect(getRecordsBySubject(records, "OS").map((record) => record.id)).toEqual(["new-created", "old-edited"]);
  });

  it("drops legacy mistake references while migrating", () => {
    const migrated = migrateBlocksToRecords([
      {
        id: "m1",
        createdAt: stamp,
        updatedAt: stamp,
        type: "mistakeRef",
        date: "2026-06-21",
        order: 0,
        mistakeId: "old-mistake",
      },
      {
        id: "r1",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record",
        date: "2026-06-21",
        order: 1,
        subject: "OS",
        title: "OS记录块1",
        contentHtml: "<p></p>",
        assets: [],
        formulas: [],
        mistakeRefs: ["old-mistake"],
      },
    ]);

    expect(migrated).toHaveLength(1);
    expect(migrated.every((block) => block.type === "record" && block.mistakeRefs.length === 0)).toBe(true);
  });
});
