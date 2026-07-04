import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { BackupPayload, RecordBlock } from "../types";
import { zipToSnapshot } from "./backup";

const stamp = "2026-06-21T00:00:00.000Z";

const record = (subject: string): RecordBlock => ({
  id: `record-${subject}`,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject,
  title: `${subject}记录`,
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

const payload = (blocks: RecordBlock[]): BackupPayload => ({
  manifest: {
    format: "study-journal",
    version: 4,
    exportedAt: stamp,
    appVersion: "0.1.0",
    counts: {
      entries: 0,
      blocks: blocks.length,
      mistakes: 0,
      assets: 0,
      tags: 0,
      reviews: 0,
      studySessions: 0,
    },
  },
  entries: [],
  blocks,
  recordDrafts: [],
  mistakes: [],
  tags: [],
  reviews: [],
  recordReviews: [],
  recordReviewLogs: [],
  recordReviewDayStats: [],
  studySessions: [],
  settings: {
    id: "settings",
    examDate: "2026-12-27",
    theme: "system",
    accentColor: "#2f6f5e",
    backupReminderDays: 7,
    fontScale: 1,
    lineHeight: 1.7,
    subjects: [],
    schemaVersion: 4,
  },
});

describe("backup import", () => {
  it("creates subject configs for unknown subjects in imported records", async () => {
    const zip = new JSZip();
    zip.file("data.json", JSON.stringify(payload([record("物理")]), null, 2));
    const file = new File([await zip.generateAsync({ type: "blob" })], "backup.zip", { type: "application/zip" });

    const snapshot = await zipToSnapshot(file);

    expect(snapshot.payload.settings.subjects?.map((subject) => subject.name)).toContain("物理");
  });
});
