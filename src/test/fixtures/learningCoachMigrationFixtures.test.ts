import { describe, expect, it } from "vitest";

import {
  migrationFixtureCounts,
  openLearningCoachMigrationFixture,
  schema11MigrationFixture,
  schema16MigrationFixture,
} from "./learningCoachMigrationFixtures";

describe("learning coach migration fixtures", () => {
  it.each([schema11MigrationFixture, schema16MigrationFixture])(
    "opens $name as an isolated copy with stable row counts",
    (source) => {
      const opened = openLearningCoachMigrationFixture(source);

      expect(opened).not.toBe(source);
      expect(migrationFixtureCounts(opened)).toEqual(source.expectedCounts);
      expect(opened.tables.blocks).not.toBe(source.tables.blocks);
    },
  );

  it("keeps schema 11 free of legacy coach stores", () => {
    expect(schema11MigrationFixture.schemaVersion).toBe(11);
    expect(schema11MigrationFixture.stores).not.toHaveProperty("learningCoachTasks");
    expect(schema11MigrationFixture.tables.recordReviewLogs[0]).toMatchObject({
      id: "review-log-core-1",
      evaluationText: "出队和标记访问的先后顺序仍需确认",
    });
  });

  it("contains the user-confirmed schema 16 facts that migration must preserve", () => {
    expect(schema16MigrationFixture.schemaVersion).toBe(16);
    expect(schema16MigrationFixture.tables.learningEvidence[0]).toMatchObject({
      kind: "quiz-assessment-confirmed",
      origin: "user-confirmed-ai",
    });
    expect(schema16MigrationFixture.tables.recordKnowledgePointLinks[0]).toMatchObject({
      confirmationSource: "manual",
      status: "active",
    });
    expect(schema16MigrationFixture.tables.knowledgeRelations[0]).toMatchObject({
      origin: "user",
      status: "confirmed",
    });
  });

  it("identifies legacy projections and unconfirmed AI output as non-mastery facts", () => {
    expect(schema16MigrationFixture.doNotPromoteToDecisionBlockState).toEqual(expect.arrayContaining([
      "learningCoachSnapshots",
      "learningCoachAiRuns.candidateTasks",
      "knowledgePointExtractionRuns.proposals:pending",
    ]));
  });
});
