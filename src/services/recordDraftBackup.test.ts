import { describe, expect, it } from "vitest";

import type { StorageSnapshot } from "../types";
import { snapshotToZip, zipToSnapshot } from "./backup";

const stamp = "2026-06-23T00:00:00.000Z";

const snapshot: StorageSnapshot = {
  payload: {
    manifest: {
      format: "study-journal",
      version: 3,
      exportedAt: stamp,
      appVersion: "0.1.0",
      counts: {
        entries: 1,
        blocks: 1,
        mistakes: 0,
        assets: 0,
        tags: 0,
        reviews: 0,
        studySessions: 0,
      },
    },
    entries: [
      {
        id: "entry-1",
        createdAt: stamp,
        updatedAt: stamp,
        date: "2026-06-23",
        title: "2026-06-23",
        tags: [],
        pinned: false,
        favorite: false,
      },
    ],
    blocks: [
      {
        id: "record-1",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record",
        date: "2026-06-23",
        order: 0,
        subject: "Math",
        title: "Saved title",
        contentHtml: "<p>Saved content</p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
    ],
    recordDrafts: [
      {
        id: "record-1",
        recordId: "record-1",
        baseUpdatedAt: stamp,
        updatedAt: "2026-06-23T00:02:00.000Z",
        draft: {
          id: "record-1",
          createdAt: stamp,
          updatedAt: stamp,
          type: "record",
          date: "2026-06-23",
          order: 0,
          subject: "Math",
          title: "Unsaved title",
          contentHtml: "<p>Unsaved draft content</p>",
          assets: [],
          formulas: [],
          mistakeRefs: [],
        },
      },
    ],
    mistakes: [],
    tags: [],
    reviews: [],
    studySessions: [],
    settings: {
      id: "settings",
      examDate: "2026-12-27",
      theme: "system",
      accentColor: "#2f6f5e",
      backupReminderDays: 7,
      fontScale: 1,
      lineHeight: 1.7,
      schemaVersion: 3,
    },
  },
  assets: [],
};

describe("record draft backup", () => {
  it("keeps unsaved record drafts in full backup round-trips", async () => {
    const backup = await snapshotToZip(snapshot);
    const restored = await zipToSnapshot(new File([backup], "study-journal.zip", { type: "application/zip" }));

    expect(restored.payload.blocks[0]).toMatchObject({
      id: "record-1",
      title: "Saved title",
    });
    expect(restored.payload.recordDrafts?.[0]).toMatchObject({
      recordId: "record-1",
      baseUpdatedAt: stamp,
      draft: {
        title: "Unsaved title",
        contentHtml: "<p>Unsaved draft content</p>",
      },
    });
  });
});
