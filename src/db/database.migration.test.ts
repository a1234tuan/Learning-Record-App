import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  openLearningCoachMigrationFixture,
  schema11MigrationFixture,
  schema16MigrationFixture,
  type LearningCoachMigrationFixture,
} from "../test/fixtures/learningCoachMigrationFixtures";
import { StudyJournalDatabase } from "./database";
import {
  REVIEW_COACH_SCHEMA_17_STORES,
  REVIEW_COACH_SCHEMA_18_STORES,
  buildSchema17MigrationBackup,
} from "./reviewCoachSchema";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const names = new Set<string>();

const createFixtureDatabase = async (fixtureSource: LearningCoachMigrationFixture) => {
  const fixture = openLearningCoachMigrationFixture(fixtureSource);
  const name = `review-coach-migration-${fixture.schemaVersion}-${crypto.randomUUID()}`;
  names.add(name);
  const legacy = new Dexie(name);
  legacy.version(fixture.schemaVersion).stores(fixture.stores);
  await legacy.open();
  await legacy.transaction("rw", legacy.tables, async () => {
    for (const [table, rows] of Object.entries(fixture.tables)) {
      await legacy.table(table).bulkPut(rows);
    }
  });
  legacy.close();
  return name;
};

afterEach(async () => {
  await Promise.all([...names].map((name) => Dexie.delete(name)));
  names.clear();
});

describe("StudyJournalDatabase review-coach migrations", () => {
  it("upgrades schema 11 without inventing block-level facts", async () => {
    const name = await createFixtureDatabase(schema11MigrationFixture);
    const database = new StudyJournalDatabase(name);

    await database.open();

    expect(database.verno).toBe(18);
    expect(await database.blocks.count()).toBe(1);
    expect(await database.recordReviewLogs.count()).toBe(1);
    expect(await database.decisionBlocks.count()).toBe(0);
    expect(await database.decisionBlockFeedback.count()).toBe(0);
    expect(await database.taskOutcomeEvents.count()).toBe(0);
    expect(await database.coachMigrationBackups.get("schema-17")).toMatchObject({
      sourceVersion: 11,
      coreCounts: { blocks: 1, recordReviews: 1, recordReviewLogs: 1, studySessions: 1 },
    });
    database.close();
  });

  it("upgrades schema 16 while preserving only confirmed legacy facts in its checkpoint", async () => {
    const name = await createFixtureDatabase(schema16MigrationFixture);
    const database = new StudyJournalDatabase(name);

    await database.open();

    expect(database.verno).toBe(18);
    expect(await database.learningEvidence.count()).toBe(1);
    expect(await database.knowledgePoints.count()).toBe(2);
    expect(await database.recordKnowledgePointLinks.count()).toBe(1);
    expect(await database.knowledgeRelations.count()).toBe(1);
    expect(await database.learningCoachSnapshots.count()).toBe(1);
    expect(await database.learningCoachTasks.count()).toBe(1);
    expect(await database.decisionBlockStates.count()).toBe(0);
    const checkpoint = await database.coachMigrationBackups.get("schema-17");
    expect(checkpoint).toMatchObject({
      sourceVersion: 16,
      legacyLearningEvidence: [{ id: "learning-evidence-confirmed-1" }],
      legacyKnowledgePoints: [{ id: "knowledge-point-bfs" }, { id: "knowledge-point-queue" }],
      legacyRecordKnowledgePointLinks: [{ id: "record-kp-link-confirmed-1" }],
      legacyKnowledgeRelations: [{ id: "knowledge-relation-confirmed-1" }],
    });
    database.close();
  });

  it("rolls back the schema and data when the upgrade transaction fails", async () => {
    const name = await createFixtureDatabase(schema16MigrationFixture);
    const failing = new Dexie(name);
    failing.version(16).stores(schema16MigrationFixture.stores);
    failing.version(17).stores(REVIEW_COACH_SCHEMA_17_STORES).upgrade(async (transaction) => {
      await buildSchema17MigrationBackup(transaction);
      throw new Error("injected migration failure");
    });

    await expect(failing.open()).rejects.toThrow("injected migration failure");
    failing.close();

    const legacy = new Dexie(name);
    legacy.version(16).stores(schema16MigrationFixture.stores);
    await legacy.open();
    expect(legacy.verno).toBe(16);
    expect(await legacy.table("blocks").count()).toBe(1);
    expect(await legacy.table("knowledgeRelations").count()).toBe(1);
    expect(legacy.tables.map((table) => table.name)).not.toContain("decisionBlocks");
    legacy.close();
  });

  it("upgrades schema 17 so intervention and verification tasks can reuse one blueprint", async () => {
    const name = `review-coach-migration-17-${crypto.randomUUID()}`;
    names.add(name);
    const legacy = new Dexie(name);
    legacy.version(17).stores(REVIEW_COACH_SCHEMA_17_STORES);
    await legacy.open();
    await legacy.table("adaptiveReviewTasks").put({
      id: "intervention-task", blueprintId: "blueprint-1", decisionBlockId: "block-1", recordId: "record-1", contentVersion: 1,
      status: "completed", priorityTier: "first-difficulty", queuedAt: "2026-09-01T08:00:00.000Z", endedAt: "2026-09-01T09:00:00.000Z",
      idempotencyKey: "intervention-task", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z",
    });
    legacy.close();

    const database = new StudyJournalDatabase(name);
    await database.open();
    await database.adaptiveReviewTasks.put({
      id: "verification-task", blueprintId: "blueprint-1", decisionBlockId: "block-1", recordId: "record-1", contentVersion: 1,
      status: "waiting", priorityTier: "due-verification", queuedAt: "2026-09-07T08:00:00.000Z", openTargetKey: "block-1:1",
      idempotencyKey: "verification-task", createdAt: "2026-09-07T08:00:00.000Z", updatedAt: "2026-09-07T08:00:00.000Z",
    });

    expect(database.verno).toBe(18);
    expect(await database.adaptiveReviewTasks.where("blueprintId").equals("blueprint-1").count()).toBe(2);
    database.close();
  });
});
