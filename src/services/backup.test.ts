import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { BackupPayload, ContentTemplate, RecordBlock, StorageSnapshot } from "../types";
import { snapshotToZip, zipToSnapshot } from "./backup";

const stamp = "2026-06-21T00:00:00.000Z";

const record = (subject: string): RecordBlock => ({
  id: `record-${subject}`,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject,
  tags: [],
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
    expect(snapshot.payload.templates).toEqual([]);
  });

  it("round-trips rich templates through a version 5 full backup", async () => {
    const template: ContentTemplate = {
      id: "template-translation",
      createdAt: stamp,
      updatedAt: stamp,
      title: "翻译复盘",
      contentHtml: "<blockquote>原句</blockquote><ul><li>我的翻译</li></ul><record-formula data-formula-id=\"formula-1\" data-title=\"公式\" data-latex=\"x^2\"></record-formula>",
    };
    const payloadWithTemplate: BackupPayload = {
      ...payload([]),
      manifest: {
        ...payload([]).manifest,
        version: 5,
        counts: { ...payload([]).manifest.counts, templates: 1 },
      },
      templates: [template],
    };
    const snapshot: StorageSnapshot = { payload: payloadWithTemplate, assets: [] };
    const zip = await snapshotToZip(snapshot);
    const file = new File([zip], "backup.zip", { type: "application/zip" });

    const restored = await zipToSnapshot(file);

    expect(restored.payload.manifest.version).toBe(5);
    expect(restored.payload.templates).toEqual([template]);
  });
});
