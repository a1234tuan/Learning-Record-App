import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { StudyJournalDatabase } from "../../db/database";
import { snapshotToZip, zipToSnapshot } from "../../services/backup";
import type { RecordBlock, StorageSnapshot } from "../../types";
import {
  DexieReviewCoachRepository,
  getReviewCoachFormalSnapshot,
  restoreReviewCoachFormalSnapshot,
  reviewCoachRestoreTables,
} from "./repository";
import { completeCoachTestSnapshot, coachTestStamp } from "./reviewCoachTestFixtures";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

describe("review coach formal data round trip", () => {
  it("rebuilds the same projection after backup export and import without AI caches", async () => {
    const record: RecordBlock = {
      id: "record-1",
      type: "record",
      date: "2026-09-04",
      order: 0,
      subject: "Data Structures",
      title: "BFS",
      contentHtml: "<p>BFS uses a queue.</p>",
      assets: [],
      formulas: [],
      mistakeRefs: [],
      tags: [],
      createdAt: coachTestStamp,
      updatedAt: coachTestStamp,
    };
    const formal = completeCoachTestSnapshot();
    Object.assign(formal.feedbackInterpretations[0], {
      systemPrompt: "private prompt",
      rawResponse: "private response",
      apiKey: "private key",
    });
    const snapshot: StorageSnapshot = {
      payload: {
        manifest: {
          format: "study-journal",
          version: 6,
          exportedAt: coachTestStamp,
          appVersion: "0.1.0",
          counts: { entries: 0, blocks: 1, mistakes: 0, assets: 0, tags: 0, reviews: 0, studySessions: 0 },
        },
        entries: [],
        blocks: [record],
        templates: [],
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
          schemaVersion: 4,
        },
        reviewCoach: formal,
      },
      assets: [],
    };
    const zip = await snapshotToZip(snapshot);
    const restored = await zipToSnapshot(new File([zip], "backup.zip", { type: "application/zip" }));
    const database = new StudyJournalDatabase(`review-coach-round-trip-${crypto.randomUUID()}`);
    await database.open();
    try {
      await database.blocks.put(record);
      await database.transaction("rw", reviewCoachRestoreTables(database), async () => {
        await restoreReviewCoachFormalSnapshot(database, restored.payload.reviewCoach!);
      });
      const ordinaryExport = await getReviewCoachFormalSnapshot(database);
      expect(JSON.stringify(ordinaryExport)).not.toContain("private prompt");
      expect(JSON.stringify(ordinaryExport)).not.toContain("private response");
      expect(JSON.stringify(ordinaryExport)).not.toContain("private key");
      const repository = new DexieReviewCoachRepository(database);
      const first = await repository.rebuildProjections();
      await database.decisionBlockStates.clear();
      await database.interventionEffectSummaries.clear();
      const second = await repository.rebuildProjections();

      expect(second).toEqual(first);
      expect(second.states).toMatchObject([{ status: "retained" }]);
      expect(restored.payload.reviewCoach).not.toHaveProperty("decisionBlockStates");
      expect(restored.payload.reviewCoach).not.toHaveProperty("interventionEffectSummaries");
    } finally {
      const name = database.name;
      database.close();
      await Dexie.delete(name);
    }
  });
});
