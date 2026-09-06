import Dexie, { type Table } from "dexie";

import { db as defaultDatabase, type StudyJournalDatabase } from "../../db/database";
import type { RecordBlock } from "../../types";
import type {
  AdaptiveQuizTurn,
  AdaptiveQuizTurnStatus,
  AdaptiveReviewTask,
  AdaptiveReviewTaskStatus,
  AiRoleConfig,
  AnalysisBatch,
  AnalysisBatchStatus,
  AnalysisQueueItem,
  AnalysisQueueStatus,
  DecisionBlock,
  DecisionBlockArchive,
  DecisionBlockFeedback,
  DecisionBlockState,
  DelayedVerification,
  DelayedVerificationStatus,
  FeedbackInterpretation,
  FeedbackInterpretationStatus,
  InterventionEffectSummary,
  ReviewCoachFormalSnapshot,
  SessionBlueprint,
  TaskOutcomeEvent,
} from "./domain";
import { replayAllDecisionBlockStates, replayInterventionEffectSummaries } from "./replay";
import {
  transitionAdaptiveQuizTurn,
  transitionAdaptiveReviewTask,
  transitionAnalysisBatch,
  transitionAnalysisQueueItem,
  transitionDelayedVerification,
  transitionFeedbackInterpretation,
  transitionFeedbackStatus,
} from "./stateMachines";
import {
  ReviewCoachValidationError,
  assertBlueprintCapabilityWhitelist,
  assertCurrentDecisionBlockRef,
  assertPositiveContentVersion,
  assertTaskOutcomeShape,
  isOpenTaskStatus,
  openTargetKeyFor,
  validateReviewCoachFormalSnapshot,
} from "./validation";
import type { PreparedDecisionBlockContent } from "./decisionBlockContent";

export interface ReviewCoachRepository {
  getFormalSnapshot(): Promise<ReviewCoachFormalSnapshot>;
  saveDecisionBlock(block: DecisionBlock): Promise<DecisionBlock>;
  archiveDecisionBlock(archive: DecisionBlockArchive): Promise<DecisionBlockArchive>;
  softDeleteDecisionBlock(archive: DecisionBlockArchive): Promise<DecisionBlock>;
  saveRecordWithDecisionBlocks(record: RecordBlock, prepared: PreparedDecisionBlockContent, recordChanged?: boolean): Promise<RecordBlock>;
  listRestorableDecisionBlockArchives(recordId: string): Promise<DecisionBlockArchive[]>;
  addFeedback(feedback: DecisionBlockFeedback, queueItem?: AnalysisQueueItem): Promise<DecisionBlockFeedback>;
  deleteFeedback(feedbackId: string, deletedAt: string): Promise<DecisionBlockFeedback>;
  updateQueueItemAnalysisNote(id: string, analysisNote: string, updatedAt: string): Promise<AnalysisQueueItem>;
  saveFeedbackInterpretation(interpretation: FeedbackInterpretation): Promise<FeedbackInterpretation>;
  transitionQueueItem(id: string, status: AnalysisQueueStatus, updatedAt: string, batchId?: string): Promise<AnalysisQueueItem>;
  createAnalysisBatch(batch: AnalysisBatch): Promise<AnalysisBatch>;
  transitionAnalysisBatch(id: string, status: AnalysisBatchStatus, updatedAt: string): Promise<AnalysisBatch>;
  acceptBlueprint(blueprint: SessionBlueprint): Promise<SessionBlueprint>;
  createTask(task: AdaptiveReviewTask): Promise<AdaptiveReviewTask>;
  transitionTask(id: string, status: AdaptiveReviewTaskStatus, updatedAt: string, reason?: string): Promise<AdaptiveReviewTask>;
  addQuizTurn(turn: AdaptiveQuizTurn): Promise<AdaptiveQuizTurn>;
  transitionQuizTurn(id: string, status: AdaptiveQuizTurnStatus, updatedAt: string): Promise<AdaptiveQuizTurn>;
  addOutcome(event: TaskOutcomeEvent): Promise<TaskOutcomeEvent>;
  commitTaskOutcome(
    taskId: string,
    events: TaskOutcomeEvent[],
    status: "deferred" | "completed" | "not-achieved" | "invalid" | "abandoned",
    updatedAt: string,
  ): Promise<AdaptiveReviewTask>;
  scheduleVerification(verification: DelayedVerification): Promise<DelayedVerification>;
  transitionVerification(id: string, status: DelayedVerificationStatus, updatedAt: string, outcome?: DelayedVerification["verificationOutcome"]): Promise<DelayedVerification>;
  saveAiRoleConfig(config: AiRoleConfig): Promise<AiRoleConfig>;
  rebuildProjections(): Promise<{ states: DecisionBlockState[]; effects: InterventionEffectSummary[] }>;
}

const ACTIVE_QUEUE_STATUSES = new Set<AnalysisQueueStatus>(["eligible", "excluded", "batched"]);
const ACTIVE_BATCH_STATUSES = new Set<AnalysisBatchStatus>(["draft", "confirmed", "running", "succeeded", "partial"]);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
      const next = (value as Record<string, unknown>)[key];
      if (next !== undefined) result[key] = canonicalize(next);
      return result;
    }, {});
  }
  return value;
};

const sameEntity = (left: unknown, right: unknown) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const ensureIdempotentInsert = async <T extends { id: string; idempotencyKey: string }>(
  table: Table<T, string>,
  value: T,
): Promise<T | undefined> => {
  const byId = await table.get(value.id);
  const byKey = await table.where("idempotencyKey").equals(value.idempotencyKey).first();
  if (byId && byKey && byId.id !== byKey.id) {
    throw new ReviewCoachValidationError("duplicate-event", `Entity ID ${value.id} and idempotency key ${value.idempotencyKey} refer to different facts.`);
  }
  const existing = byId ?? byKey;
  if (!existing) return undefined;
  if (!sameEntity(existing, value)) {
    throw new ReviewCoachValidationError("duplicate-event", `Idempotency key ${value.idempotencyKey} already has different content.`);
  }
  return existing;
};

const sameFeedbackOperation = (left: DecisionBlockFeedback, right: DecisionBlockFeedback) =>
  left.decisionBlockId === right.decisionBlockId
  && left.recordId === right.recordId
  && left.contentVersion === right.contentVersion
  && left.comment === right.comment
  && left.includeInAnalysis === right.includeInAnalysis
  && left.source === right.source;

export const persistDecisionBlockFeedbackInTransaction = async (
  database: StudyJournalDatabase,
  feedback: DecisionBlockFeedback,
  queueItem?: AnalysisQueueItem,
): Promise<{ feedback: DecisionBlockFeedback; created: boolean }> => {
  if (!feedback.comment.trim()) throw new ReviewCoachValidationError("empty-feedback", "Empty feedback is not a formal event.");
  const existingByKey = await database.decisionBlockFeedback.where("idempotencyKey").equals(feedback.idempotencyKey).first();
  if (existingByKey) {
    if (!sameFeedbackOperation(existingByKey, feedback)) {
      throw new ReviewCoachValidationError("duplicate-event", `Idempotency key ${feedback.idempotencyKey} already has different feedback content.`);
    }
    return { feedback: existingByKey, created: false };
  }
  const existingById = await database.decisionBlockFeedback.get(feedback.id);
  if (existingById) {
    throw new ReviewCoachValidationError("duplicate-event", `Feedback ID ${feedback.id} already exists.`);
  }
  assertCurrentDecisionBlockRef(await database.decisionBlocks.get(feedback.decisionBlockId), feedback);
  if (feedback.reviewLogId) {
    const log = await database.recordReviewLogs.get(feedback.reviewLogId);
    if (!log || log.recordId !== feedback.recordId) throw new ReviewCoachValidationError("dangling-review-log", "Feedback review log does not exist or belongs to another record.");
  }
  if (feedback.includeInAnalysis) {
    if (!queueItem || queueItem.feedbackId !== feedback.id) throw new ReviewCoachValidationError("missing-queue-item", "Analysis-enabled feedback requires a matching queue item.");
    if (queueItem.decisionBlockId !== feedback.decisionBlockId || queueItem.contentVersion !== feedback.contentVersion || queueItem.recordId !== feedback.recordId) {
      throw new ReviewCoachValidationError("dangling-queue-item", "Queue item does not match feedback.");
    }
  } else if (queueItem) {
    throw new ReviewCoachValidationError("unexpected-queue-item", "Opted-out feedback cannot create a queue item.");
  }
  await database.decisionBlockFeedback.add(feedback);
  if (queueItem) await database.analysisQueueItems.add(queueItem);
  return { feedback, created: true };
};

export const reviewCoachFormalTables = (database: StudyJournalDatabase) => [
  database.decisionBlocks,
  database.decisionBlockArchives,
  database.decisionBlockFeedback,
  database.feedbackInterpretations,
  database.analysisQueueItems,
  database.analysisBatches,
  database.sessionBlueprints,
  database.adaptiveReviewTasks,
  database.adaptiveQuizTurns,
  database.taskOutcomeEvents,
  database.delayedVerifications,
  database.decisionBlockStates,
  database.interventionEffectSummaries,
  database.aiRoleConfigs,
  database.learningEvidence,
  database.knowledgePoints,
  database.recordKnowledgePointLinks,
  database.knowledgeRelations,
];

const formalTables = (database: StudyJournalDatabase) => [
  database.blocks,
  ...reviewCoachFormalTables(database),
];

export const reviewCoachRestoreTables = (database: StudyJournalDatabase) => [
  ...reviewCoachFormalTables(database),
  database.learningCoachSettings,
  database.learningCoachSnapshots,
  database.learningCoachTasks,
  database.learningCoachAiRuns,
  database.knowledgePointExtractionRuns,
  database.knowledgePointCoachSnapshots,
];

/** Remove coach facts owned by a permanently deleted record.
 * The caller must include all formal tables in its surrounding read-write transaction.
 */
export const purgeReviewCoachFactsForRecord = async (database: StudyJournalDatabase, recordId: string): Promise<void> => {
  const [blocks, archives, feedback, interpretations, queueItems, batches, blueprints, tasks, turns, outcomes, verifications] = await Promise.all([
    database.decisionBlocks.where("recordId").equals(recordId).toArray(),
    database.decisionBlockArchives.where("recordId").equals(recordId).toArray(),
    database.decisionBlockFeedback.where("recordId").equals(recordId).toArray(),
    database.feedbackInterpretations.toArray(),
    database.analysisQueueItems.toArray(),
    database.analysisBatches.toArray(),
    database.sessionBlueprints.toArray(),
    database.adaptiveReviewTasks.toArray(),
    database.adaptiveQuizTurns.toArray(),
    database.taskOutcomeEvents.toArray(),
    database.delayedVerifications.toArray(),
  ]);
  const blockIds = new Set(blocks.map((item) => item.id));
  const feedbackIds = new Set(feedback.map((item) => item.id));
  const interpretationIds = new Set(interpretations.filter((item) => feedbackIds.has(item.feedbackId)).map((item) => item.id));
  const queueIds = new Set(queueItems.filter((item) => blockIds.has(item.decisionBlockId) || feedbackIds.has(item.feedbackId)).map((item) => item.id));
  const batchIds = new Set<string>();
  const prunedBatches: AnalysisBatch[] = [];
  for (const batch of batches) {
    const keepRef = (ref: AnalysisBatch["inputRefs"][number]) => !(
      blockIds.has(ref.decisionBlockId)
      || queueIds.has(ref.queueItemId)
      || feedbackIds.has(ref.feedbackId)
      || Boolean(ref.interpretationId && interpretationIds.has(ref.interpretationId))
    );
    const inputRefs = batch.inputRefs.filter(keepRef);
    if (inputRefs.length === batch.inputRefs.length) continue;
    if (inputRefs.length === 0) {
      batchIds.add(batch.id);
      continue;
    }
    prunedBatches.push({
      ...batch,
      inputRefs,
      subBatches: batch.subBatches
        .map((subBatch) => ({ ...subBatch, inputRefs: subBatch.inputRefs.filter(keepRef) }))
        .filter((subBatch) => subBatch.inputRefs.length > 0),
    });
  }
  const blueprintIds = new Set(blueprints.filter((item) => (
    blockIds.has(item.decisionBlockId)
    || batchIds.has(item.batchId)
    || item.supportingDecisionBlockIds.some((id) => blockIds.has(id))
    || item.evidence.some((ref) => blockIds.has(ref.decisionBlockId))
    || item.feedbackIds.some((id) => feedbackIds.has(id))
    || item.interpretationIds.some((id) => interpretationIds.has(id))
  )).map((item) => item.id));
  const taskIds = new Set(tasks.filter((item) => item.recordId === recordId || blockIds.has(item.decisionBlockId) || blueprintIds.has(item.blueprintId)).map((item) => item.id));
  const turnIds = new Set(turns.filter((item) => item.recordId === recordId || taskIds.has(item.taskId) || blockIds.has(item.decisionBlockId)).map((item) => item.id));
  const outcomeIds = new Set(outcomes.filter((item) => item.recordId === recordId || taskIds.has(item.taskId) || blockIds.has(item.decisionBlockId)).map((item) => item.id));
  const verificationIds = new Set(verifications
    .filter((item) => item.recordId === recordId || blockIds.has(item.decisionBlockId) || outcomeIds.has(item.sourceOutcomeEventId))
    .map((item) => item.id));

  await Promise.all([
    ...prunedBatches.map((batch) => database.analysisBatches.put(batch)),
    ...[...verificationIds].map((id) => database.delayedVerifications.delete(id)),
    ...[...outcomeIds].map((id) => database.taskOutcomeEvents.delete(id)),
    ...[...turnIds].map((id) => database.adaptiveQuizTurns.delete(id)),
    ...[...taskIds].map((id) => database.adaptiveReviewTasks.delete(id)),
    ...[...blueprintIds].map((id) => database.sessionBlueprints.delete(id)),
    ...[...batchIds].map((id) => database.analysisBatches.delete(id)),
    ...[...queueIds].map((id) => database.analysisQueueItems.delete(id)),
    ...[...interpretationIds].map((id) => database.feedbackInterpretations.delete(id)),
    ...[...feedbackIds].map((id) => database.decisionBlockFeedback.delete(id)),
    ...[...archives.map((item) => item.id)].map((id) => database.decisionBlockArchives.delete(id)),
    database.recordKnowledgePointLinks.where("recordId").equals(recordId).delete(),
    ...[...blockIds].map((id) => database.decisionBlockStates.delete(id)),
    ...[...blockIds].map((id) => database.decisionBlocks.delete(id)),
  ]);
};

export const getReviewCoachFormalSnapshot = async (database: StudyJournalDatabase): Promise<ReviewCoachFormalSnapshot> => {
  const [
    decisionBlocks,
    decisionBlockArchives,
    decisionBlockFeedback,
    feedbackInterpretations,
    analysisQueueItems,
    analysisBatches,
    sessionBlueprints,
    adaptiveReviewTasks,
    adaptiveQuizTurns,
    taskOutcomeEvents,
    delayedVerifications,
    aiRoleConfigs,
    learningEvidence,
    knowledgePoints,
    recordKnowledgePointLinks,
    knowledgeRelations,
  ] = await Promise.all([
    database.decisionBlocks.toArray(),
    database.decisionBlockArchives.toArray(),
    database.decisionBlockFeedback.toArray(),
    database.feedbackInterpretations.toArray(),
    database.analysisQueueItems.toArray(),
    database.analysisBatches.toArray(),
    database.sessionBlueprints.toArray(),
    database.adaptiveReviewTasks.toArray(),
    database.adaptiveQuizTurns.toArray(),
    database.taskOutcomeEvents.toArray(),
    database.delayedVerifications.toArray(),
    database.aiRoleConfigs.toArray(),
    database.learningEvidence.toArray(),
    database.knowledgePoints.toArray(),
    database.recordKnowledgePointLinks.toArray(),
    database.knowledgeRelations.toArray(),
  ]);
  return {
    decisionBlocks,
    decisionBlockArchives,
    decisionBlockFeedback,
    feedbackInterpretations: feedbackInterpretations.filter((item) => item.status === "succeeded" || item.status === "insufficient-context"),
    analysisQueueItems,
    analysisBatches,
    sessionBlueprints: sessionBlueprints.filter((item) => item.status !== "rejected"),
    adaptiveReviewTasks,
    adaptiveQuizTurns,
    taskOutcomeEvents,
    delayedVerifications,
    aiRoleConfigs,
    legacyLearningEvidence: learningEvidence.filter((item) => item.origin === "user-confirmed-ai" || item.kind.endsWith("-confirmed")),
    legacyKnowledgePoints: knowledgePoints,
    legacyRecordKnowledgePointLinks: recordKnowledgePointLinks.filter((item) => item.status === "active"),
    legacyKnowledgeRelations: knowledgeRelations.filter((item) => item.status === "confirmed"),
  };
};

export const restoreReviewCoachFormalSnapshot = async (
  database: StudyJournalDatabase,
  snapshot: ReviewCoachFormalSnapshot,
) => {
  await Promise.all([
    database.decisionBlocks.clear(),
    database.decisionBlockArchives.clear(),
    database.decisionBlockFeedback.clear(),
    database.feedbackInterpretations.clear(),
    database.analysisQueueItems.clear(),
    database.analysisBatches.clear(),
    database.sessionBlueprints.clear(),
    database.adaptiveReviewTasks.clear(),
    database.adaptiveQuizTurns.clear(),
    database.taskOutcomeEvents.clear(),
    database.delayedVerifications.clear(),
    database.decisionBlockStates.clear(),
    database.interventionEffectSummaries.clear(),
    database.aiRoleConfigs.clear(),
    database.learningEvidence.clear(),
    database.knowledgePoints.clear(),
    database.recordKnowledgePointLinks.clear(),
    database.knowledgeRelations.clear(),
    database.learningCoachSettings.clear(),
    database.learningCoachSnapshots.clear(),
    database.learningCoachTasks.clear(),
    database.learningCoachAiRuns.clear(),
    database.knowledgePointExtractionRuns.clear(),
    database.knowledgePointCoachSnapshots.clear(),
  ]);
  await Promise.all([
    database.decisionBlocks.bulkPut(snapshot.decisionBlocks),
    database.decisionBlockArchives.bulkPut(snapshot.decisionBlockArchives),
    database.decisionBlockFeedback.bulkPut(snapshot.decisionBlockFeedback),
    database.feedbackInterpretations.bulkPut(snapshot.feedbackInterpretations),
    database.analysisQueueItems.bulkPut(snapshot.analysisQueueItems),
    database.analysisBatches.bulkPut(snapshot.analysisBatches),
    database.sessionBlueprints.bulkPut(snapshot.sessionBlueprints),
    database.adaptiveReviewTasks.bulkPut(snapshot.adaptiveReviewTasks),
    database.adaptiveQuizTurns.bulkPut(snapshot.adaptiveQuizTurns),
    database.taskOutcomeEvents.bulkPut(snapshot.taskOutcomeEvents),
    database.delayedVerifications.bulkPut(snapshot.delayedVerifications),
    database.aiRoleConfigs.bulkPut(snapshot.aiRoleConfigs),
    database.learningEvidence.bulkPut(snapshot.legacyLearningEvidence),
    database.knowledgePoints.bulkPut(snapshot.legacyKnowledgePoints),
    database.recordKnowledgePointLinks.bulkPut(snapshot.legacyRecordKnowledgePointLinks),
    database.knowledgeRelations.bulkPut(snapshot.legacyKnowledgeRelations),
  ]);
};

const latestFactTime = (snapshot: ReviewCoachFormalSnapshot) => {
  const times = [
    ...snapshot.decisionBlocks.map((item) => item.updatedAt),
    ...snapshot.decisionBlockFeedback.map((item) => item.updatedAt),
    ...snapshot.sessionBlueprints.map((item) => item.updatedAt),
    ...snapshot.adaptiveReviewTasks.map((item) => item.updatedAt),
    ...snapshot.taskOutcomeEvents.map((item) => item.updatedAt),
    ...snapshot.delayedVerifications.map((item) => item.updatedAt),
  ].sort();
  return times.at(-1) ?? "1970-01-01T00:00:00.000Z";
};

export const rebuildReviewCoachProjectionsInTransaction = async (database: StudyJournalDatabase) => {
  const snapshot = await getReviewCoachFormalSnapshot(database);
  const records = (await database.blocks.toArray()).filter((block) => block.type === "record").map((block) => block.id);
  validateReviewCoachFormalSnapshot(snapshot, new Set(records));
  const replayedAt = latestFactTime(snapshot);
  const states = replayAllDecisionBlockStates(snapshot, replayedAt);
  const effects = replayInterventionEffectSummaries({
    interpretations: snapshot.feedbackInterpretations,
    blueprints: snapshot.sessionBlueprints,
    tasks: snapshot.adaptiveReviewTasks,
    turns: snapshot.adaptiveQuizTurns,
    outcomes: snapshot.taskOutcomeEvents,
    verifications: snapshot.delayedVerifications,
    replayedAt,
  });
  await Promise.all([
    database.decisionBlockStates.clear(),
    database.interventionEffectSummaries.clear(),
  ]);
  await Promise.all([
    database.decisionBlockStates.bulkPut(states),
    database.interventionEffectSummaries.bulkPut(effects),
  ]);
  return { states, effects };
};

export const tombstoneDecisionBlockFeedbackInTransaction = async (
  database: StudyJournalDatabase,
  feedbackIds: readonly string[],
  reviewLogId: string,
  deletedAt: string,
): Promise<DecisionBlockFeedback[]> => {
  const linked = await database.decisionBlockFeedback.where("reviewLogId").equals(reviewLogId).toArray();
  const ids = new Set([...feedbackIds, ...linked.map((feedback) => feedback.id)]);
  const feedback = (await Promise.all([...ids].map((id) => database.decisionBlockFeedback.get(id))))
    .filter((item): item is DecisionBlockFeedback => Boolean(item));
  const tombstoned: DecisionBlockFeedback[] = [];
  for (const item of feedback) {
    if (item.deletedAt) continue;
    transitionFeedbackStatus("active", "deleted");
    const updated = { ...item, deletedAt, updatedAt: deletedAt };
    await database.decisionBlockFeedback.put(updated);
    const queue = await database.analysisQueueItems.where("feedbackId").equals(item.id).first();
    if (queue && queue.status !== "deleted") {
      transitionAnalysisQueueItem(queue.status, "deleted");
      await database.analysisQueueItems.put({ ...queue, status: "deleted", deletedAt, updatedAt: deletedAt });
    }
    tombstoned.push(updated);
  }
  return tombstoned;
};

export class DexieReviewCoachRepository implements ReviewCoachRepository {
  constructor(private readonly database: StudyJournalDatabase = defaultDatabase) {}

  getFormalSnapshot(): Promise<ReviewCoachFormalSnapshot> {
    return getReviewCoachFormalSnapshot(this.database);
  }

  private async bumpMutation() {
    const current = await this.database.cloudSyncMutation.get("local");
    await this.database.cloudSyncMutation.put({ id: "local", epoch: (current?.epoch ?? 0) + 1 });
  }

  private async staleDerivedWork(decisionBlockId: string, contentVersion: number, stamp: string, reason: string) {
    const [queueItems, batches, blueprints, tasks, verifications] = await Promise.all([
      this.database.analysisQueueItems.where("decisionBlockId").equals(decisionBlockId).toArray(),
      this.database.analysisBatches.toArray(),
      this.database.sessionBlueprints.where("decisionBlockId").equals(decisionBlockId).toArray(),
      this.database.adaptiveReviewTasks.where("decisionBlockId").equals(decisionBlockId).toArray(),
      this.database.delayedVerifications.where("decisionBlockId").equals(decisionBlockId).toArray(),
    ]);
    await Promise.all([
      ...queueItems.filter((item) => item.contentVersion <= contentVersion && ACTIVE_QUEUE_STATUSES.has(item.status)).map((item) => this.database.analysisQueueItems.put({ ...item, status: "stale", updatedAt: stamp })),
      ...batches.filter((batch) => ACTIVE_BATCH_STATUSES.has(batch.status) && batch.inputRefs.some((ref) => ref.decisionBlockId === decisionBlockId && ref.contentVersion <= contentVersion)).map((batch) => this.database.analysisBatches.put({ ...batch, status: "stale", updatedAt: stamp })),
      ...blueprints.filter((item) => item.contentVersion <= contentVersion && item.status === "accepted").map((item) => this.database.sessionBlueprints.put({ ...item, status: "stale", updatedAt: stamp })),
      ...tasks.filter((item) => item.contentVersion <= contentVersion && isOpenTaskStatus(item.status)).map((item) => this.database.adaptiveReviewTasks.put({ ...item, status: "stale", activeSlotKey: undefined, openTargetKey: undefined, terminalReason: reason, endedAt: stamp, updatedAt: stamp })),
      ...verifications.filter((item) => item.contentVersion <= contentVersion && !["completed", "cancelled", "stale"].includes(item.status)).map((item) => this.database.delayedVerifications.put({ ...item, status: "stale", updatedAt: stamp })),
    ]);
  }

  private async rebuildProjectionsInTransaction() {
    return rebuildReviewCoachProjectionsInTransaction(this.database);
  }

  async saveDecisionBlock(block: DecisionBlock): Promise<DecisionBlock> {
    assertPositiveContentVersion(block.contentVersion);
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const record = await this.database.blocks.get(block.recordId);
      if (!record || record.type !== "record" || record.deletedAt) {
        throw new ReviewCoachValidationError("dangling-record", `Record ${block.recordId} does not exist.`);
      }
      const current = await this.database.decisionBlocks.get(block.id);
      if (!current && block.contentVersion !== 1) {
        throw new ReviewCoachValidationError("invalid-content-version", "A new decision block must start at contentVersion 1.");
      }
      if (current) {
        if (current.recordId !== block.recordId) throw new ReviewCoachValidationError("record-mismatch", "A decision block cannot move to another record.");
        if (block.contentVersion < current.contentVersion || block.contentVersion > current.contentVersion + 1) {
          throw new ReviewCoachValidationError("invalid-content-version", "Decision block contentVersion must stay current or increment by one.");
        }
        if (!current.deletedAt && block.deletedAt) {
          throw new ReviewCoachValidationError("missing-decision-block-archive", "Use softDeleteDecisionBlock so deletion and recoverable content are atomic.");
        }
      }
      if (!current && block.deletedAt) throw new ReviewCoachValidationError("invalid-decision-block", "A new decision block cannot start deleted.");
      await this.database.decisionBlocks.put(block);
      if (current && block.contentVersion > current.contentVersion) {
        await this.staleDerivedWork(block.id, current.contentVersion, block.updatedAt, "content-version-changed");
      }
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return block;
    });
  }

  async archiveDecisionBlock(archive: DecisionBlockArchive): Promise<DecisionBlockArchive> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const existing = await ensureIdempotentInsert(this.database.decisionBlockArchives, archive);
      if (existing) return existing;
      const block = await this.database.decisionBlocks.get(archive.decisionBlockId);
      if (!block || block.recordId !== archive.recordId || archive.contentVersion > block.contentVersion) {
        throw new ReviewCoachValidationError("dangling-archive", "Archive does not match its decision block.");
      }
      await this.database.decisionBlockArchives.add(archive);
      await this.bumpMutation();
      return archive;
    });
  }

  async softDeleteDecisionBlock(archive: DecisionBlockArchive): Promise<DecisionBlock> {
    if (archive.reason !== "deleted" && archive.reason !== "converted-to-plain") {
      throw new ReviewCoachValidationError("invalid-archive-reason", "Content-conflict archives do not delete their source block.");
    }
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const block = await this.database.decisionBlocks.get(archive.decisionBlockId);
      const existing = await ensureIdempotentInsert(this.database.decisionBlockArchives, archive);
      if (existing) {
        const deleted = block;
        if (deleted?.deletedAt) return deleted;
        throw new ReviewCoachValidationError("incomplete-delete-retry", "Archive exists but its decision block is still active.");
      }
      if (!block || block.deletedAt || block.recordId !== archive.recordId || block.contentVersion !== archive.contentVersion) {
        throw new ReviewCoachValidationError("dangling-archive", "Deletion archive must match the current active decision block version.");
      }
      const deleted = { ...block, deletedAt: archive.archivedAt, updatedAt: archive.archivedAt };
      await Promise.all([
        this.database.decisionBlockArchives.add(archive),
        this.database.decisionBlocks.put(deleted),
      ]);
      await this.staleDerivedWork(block.id, block.contentVersion, archive.archivedAt, "decision-block-deleted");
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return deleted;
    });
  }

  async saveRecordWithDecisionBlocks(record: RecordBlock, prepared: PreparedDecisionBlockContent, recordChanged = true): Promise<RecordBlock> {
    return this.database.transaction(
      "rw",
      [this.database.blocks, this.database.recordDrafts, this.database.cloudSyncMutation, ...formalTables(this.database)],
      async () => {
        const currentRows = await this.database.decisionBlocks.where("recordId").equals(record.id).toArray();
        const currentById = new Map(currentRows.map((block) => [block.id, block]));
        const nextIds = new Set(prepared.blocks.map((block) => block.decisionBlockId));
        const coachChanged = prepared.removals.length > 0 || prepared.blocks.some((block) => {
          const current = currentById.get(block.decisionBlockId);
          return !current || Boolean(current.deletedAt) || current.contentVersion !== block.contentVersion || current.position !== block.position;
        });
        if (nextIds.size !== prepared.blocks.length) {
          throw new ReviewCoachValidationError("duplicate-decision-block", "A record cannot contain duplicate decision block IDs.");
        }

        await this.database.blocks.put(record);
        await this.database.recordDrafts.delete(record.id);

        for (const parsed of prepared.blocks) {
          const current = currentById.get(parsed.decisionBlockId);
          const existingById = current ?? await this.database.decisionBlocks.get(parsed.decisionBlockId);
          if (existingById && existingById.recordId !== record.id) {
            throw new ReviewCoachValidationError("record-mismatch", "A decision block ID cannot be reused by another record.");
          }
          if (!current && parsed.contentVersion !== 1) {
            throw new ReviewCoachValidationError("invalid-content-version", "A new decision block must start at contentVersion 1.");
          }
          if (current) {
            if (parsed.contentVersion < current.contentVersion || parsed.contentVersion > current.contentVersion + 1) {
              throw new ReviewCoachValidationError("invalid-content-version", "Decision block contentVersion must stay current or increment by one.");
            }
            if (!current.deletedAt && parsed.contentVersion > current.contentVersion) {
              await this.staleDerivedWork(current.id, current.contentVersion, parsed.updatedAt, "content-version-changed");
            }
          }
          const next: DecisionBlock = {
            id: parsed.decisionBlockId,
            recordId: record.id,
            contentVersion: parsed.contentVersion,
            position: parsed.position,
            contentUpdatedAt: parsed.updatedAt,
            createdAt: current?.createdAt ?? parsed.createdAt,
            updatedAt: parsed.updatedAt,
          };
          await this.database.decisionBlocks.put(next);
        }

        for (const removal of prepared.removals) {
          const current = currentById.get(removal.decisionBlockId);
          if (!current || current.deletedAt || current.recordId !== record.id) {
            throw new ReviewCoachValidationError("dangling-archive", "Removed decision block does not match an active index row.");
          }
          if (removal.contentVersion < current.contentVersion || removal.contentVersion > current.contentVersion + 1) {
            throw new ReviewCoachValidationError("invalid-content-version", "Removed decision block version must stay current or increment by one.");
          }
          const archiveStamp = removal.archivedAt || record.updatedAt;
          const archiveKey = [
            "decision-block-archive",
            record.id,
            removal.decisionBlockId,
            removal.contentVersion,
            removal.reason,
            archiveStamp,
          ].join(":");
          const archive: DecisionBlockArchive = {
            id: archiveKey,
            decisionBlockId: removal.decisionBlockId,
            recordId: record.id,
            contentVersion: removal.contentVersion,
            contentHtml: removal.contentHtml,
            archivedAt: archiveStamp,
            reason: removal.reason,
            idempotencyKey: archiveKey,
            createdAt: archiveStamp,
            updatedAt: archiveStamp,
          };
          await this.database.decisionBlockArchives.put(archive);
          await this.database.decisionBlocks.put({
            ...current,
            contentVersion: removal.contentVersion,
            contentUpdatedAt: removal.updatedAt,
            deletedAt: archiveStamp,
            updatedAt: archiveStamp,
          });
          await this.staleDerivedWork(current.id, current.contentVersion, archiveStamp, "decision-block-deleted");
        }

        const unexpectedlyMissing = currentRows.filter((block) => !block.deletedAt && !nextIds.has(block.id)
          && !prepared.removals.some((removal) => removal.decisionBlockId === block.id));
        if (unexpectedlyMissing.length > 0) {
          throw new ReviewCoachValidationError("missing-decision-block-archive", "Every removed decision block requires recoverable HTML.");
        }

        if (coachChanged) await this.rebuildProjectionsInTransaction();
        if (recordChanged || coachChanged) await this.bumpMutation();
        return record;
      },
    );
  }

  async listRestorableDecisionBlockArchives(recordId: string): Promise<DecisionBlockArchive[]> {
    const [archives, blocks] = await Promise.all([
      this.database.decisionBlockArchives.where("recordId").equals(recordId).toArray(),
      this.database.decisionBlocks.where("recordId").equals(recordId).toArray(),
    ]);
    const deletedById = new Map(blocks.filter((block) => block.deletedAt).map((block) => [block.id, block]));
    return archives
      .filter((archive) => {
        const block = deletedById.get(archive.decisionBlockId);
        return block?.contentVersion === archive.contentVersion && !archive.deletedAt;
      })
      .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt))
      .filter((archive, index, all) => all.findIndex((item) => item.decisionBlockId === archive.decisionBlockId) === index);
  }

  async addFeedback(feedback: DecisionBlockFeedback, queueItem?: AnalysisQueueItem): Promise<DecisionBlockFeedback> {
    return this.database.transaction("rw", [this.database.recordReviewLogs, this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const persisted = await persistDecisionBlockFeedbackInTransaction(this.database, feedback, queueItem);
      if (!persisted.created) return persisted.feedback;
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return persisted.feedback;
    });
  }

  async deleteFeedback(feedbackId: string, deletedAt: string): Promise<DecisionBlockFeedback> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const feedback = await this.database.decisionBlockFeedback.get(feedbackId);
      if (!feedback) throw new ReviewCoachValidationError("missing-feedback", `Feedback ${feedbackId} does not exist.`);
      transitionFeedbackStatus(feedback.deletedAt ? "deleted" : "active", "deleted");
      const updated = { ...feedback, deletedAt, updatedAt: deletedAt };
      await this.database.decisionBlockFeedback.put(updated);
      const queue = await this.database.analysisQueueItems.where("feedbackId").equals(feedbackId).first();
      if (queue && queue.status !== "deleted") await this.database.analysisQueueItems.put({ ...queue, status: "deleted", deletedAt, updatedAt: deletedAt });
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return updated;
    });
  }

  async updateQueueItemAnalysisNote(id: string, analysisNote: string, updatedAt: string): Promise<AnalysisQueueItem> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const current = await this.database.analysisQueueItems.get(id);
      if (!current || current.status === "deleted" || current.status === "stale" || current.status === "consumed") {
        throw new ReviewCoachValidationError("inactive-queue-item", `Queue item ${id} cannot be edited.`);
      }
      const normalizedNote = analysisNote.trim();
      const next = { ...current, analysisNote: normalizedNote || undefined, updatedAt };
      await this.database.analysisQueueItems.put(next);
      await this.bumpMutation();
      return next;
    });
  }

  async saveFeedbackInterpretation(interpretation: FeedbackInterpretation): Promise<FeedbackInterpretation> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const feedback = await this.database.decisionBlockFeedback.get(interpretation.feedbackId);
      if (!feedback || feedback.decisionBlockId !== interpretation.decisionBlockId || feedback.contentVersion !== interpretation.contentVersion) {
        throw new ReviewCoachValidationError("dangling-feedback", "Interpretation does not match feedback.");
      }
      assertCurrentDecisionBlockRef(await this.database.decisionBlocks.get(interpretation.decisionBlockId), feedback);
      const current = await this.database.feedbackInterpretations.where("feedbackId").equals(interpretation.feedbackId).first();
      if (current && current.id !== interpretation.id) throw new ReviewCoachValidationError("duplicate-feedback-interpretation", "Feedback already has an interpretation.");
      if (current) transitionFeedbackInterpretation(current.status, interpretation.status);
      if (interpretation.confidence !== undefined && (interpretation.confidence < 0 || interpretation.confidence > 1)) throw new ReviewCoachValidationError("invalid-confidence", "Interpretation confidence must be between 0 and 1.");
      await this.database.feedbackInterpretations.put(interpretation);
      await this.bumpMutation();
      return interpretation;
    });
  }

  async transitionQueueItem(id: string, status: AnalysisQueueStatus, updatedAt: string, batchId?: string): Promise<AnalysisQueueItem> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const current = await this.database.analysisQueueItems.get(id);
      if (!current) throw new ReviewCoachValidationError("missing-queue-item", `Queue item ${id} does not exist.`);
      transitionAnalysisQueueItem(current.status, status);
      if (status === "batched" && !batchId) throw new ReviewCoachValidationError("missing-analysis-batch", "Batched queue item requires batchId.");
      const next = {
        ...current,
        status,
        updatedAt,
        batchId: status === "batched" ? batchId : undefined,
        excludedAt: status === "excluded" ? updatedAt : status === "eligible" ? undefined : current.excludedAt,
        consumedAt: status === "consumed" ? updatedAt : current.consumedAt,
        deletedAt: status === "deleted" ? updatedAt : current.deletedAt,
      };
      await this.database.analysisQueueItems.put(next);
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return next;
    });
  }

  async createAnalysisBatch(batch: AnalysisBatch): Promise<AnalysisBatch> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const existing = await ensureIdempotentInsert(this.database.analysisBatches, batch);
      if (existing) return existing;
      const snapshot = await getReviewCoachFormalSnapshot(this.database);
      const blocks = new Map(snapshot.decisionBlocks.map((block) => [block.id, block]));
      const partitionedRefs = batch.subBatches.flatMap((item) => item.inputRefs.map((ref) => ref.queueItemId));
      const expectedRefs = batch.inputRefs.map((ref) => ref.queueItemId);
      if (
        batch.inputRefs.length === 0 ||
        batch.subBatches.some((item) => item.inputRefs.length === 0 || new Set(item.inputRefs.map((ref) => ref.decisionBlockId)).size > 3) ||
        partitionedRefs.length !== expectedRefs.length ||
        new Set(partitionedRefs).size !== partitionedRefs.length ||
        expectedRefs.some((id) => !partitionedRefs.includes(id))
      ) {
        throw new ReviewCoachValidationError("invalid-analysis-batch-size", "Analysis sub-batches must contain one to three decision blocks.");
      }
      for (const ref of batch.inputRefs) {
        assertCurrentDecisionBlockRef(blocks.get(ref.decisionBlockId), ref);
        const queueItem = snapshot.analysisQueueItems.find((item) => item.id === ref.queueItemId);
        if (!queueItem || queueItem.feedbackId !== ref.feedbackId || queueItem.status !== "eligible") {
          throw new ReviewCoachValidationError("invalid-analysis-input", `Queue item ${ref.queueItemId} is not eligible.`);
        }
      }
      await this.database.analysisBatches.add(batch);
      await Promise.all(batch.inputRefs.map(async (ref) => {
        const item = await this.database.analysisQueueItems.get(ref.queueItemId);
        if (item) await this.database.analysisQueueItems.put({ ...item, status: "batched", batchId: batch.id, updatedAt: batch.updatedAt });
      }));
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return batch;
    });
  }

  async transitionAnalysisBatch(id: string, status: AnalysisBatchStatus, updatedAt: string): Promise<AnalysisBatch> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const current = await this.database.analysisBatches.get(id);
      if (!current) throw new ReviewCoachValidationError("missing-analysis-batch", `Analysis batch ${id} does not exist.`);
      transitionAnalysisBatch(current.status, status);
      const next = {
        ...current,
        status,
        requestedAt: status === "running" ? current.requestedAt ?? updatedAt : current.requestedAt,
        completedAt: ["succeeded", "partial", "failed", "cancelled"].includes(status) ? updatedAt : current.completedAt,
        updatedAt,
      };
      await this.database.analysisBatches.put(next);
      await this.bumpMutation();
      return next;
    });
  }

  async acceptBlueprint(blueprint: SessionBlueprint): Promise<SessionBlueprint> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const existing = await ensureIdempotentInsert(this.database.sessionBlueprints, blueprint);
      if (existing) return existing;
      if (blueprint.status !== "accepted") throw new ReviewCoachValidationError("non-formal-blueprint", "Only accepted blueprints are formal repository data.");
      assertBlueprintCapabilityWhitelist(blueprint);
      assertCurrentDecisionBlockRef(await this.database.decisionBlocks.get(blueprint.decisionBlockId), blueprint);
      const batch = await this.database.analysisBatches.get(blueprint.batchId);
      if (!batch || !["succeeded", "partial"].includes(batch.status)) throw new ReviewCoachValidationError("invalid-analysis-batch", "Blueprint requires a completed analysis batch.");
      const suppliedBlockIds = new Set(batch.inputRefs.map((ref) => ref.decisionBlockId));
      if (!suppliedBlockIds.has(blueprint.decisionBlockId) || blueprint.supportingDecisionBlockIds.some((id) => !suppliedBlockIds.has(id))) {
        throw new ReviewCoachValidationError("unsupplied-blueprint-source", "Blueprint references a decision block outside the frozen analysis input.");
      }
      for (const evidence of blueprint.evidence) {
        const block = await this.database.decisionBlocks.get(evidence.decisionBlockId);
        if (!block || block.recordId !== evidence.recordId || block.contentVersion !== evidence.contentVersion || !suppliedBlockIds.has(evidence.decisionBlockId)) {
          throw new ReviewCoachValidationError("invalid-blueprint-evidence", "Blueprint evidence is missing, stale, or outside the frozen input.");
        }
      }
      await this.database.sessionBlueprints.add(blueprint);
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return blueprint;
    });
  }

  async createTask(task: AdaptiveReviewTask): Promise<AdaptiveReviewTask> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const existing = await ensureIdempotentInsert(this.database.adaptiveReviewTasks, task);
      if (existing) return existing;
      const blueprint = await this.database.sessionBlueprints.get(task.blueprintId);
      if (!blueprint || blueprint.status !== "accepted" || blueprint.decisionBlockId !== task.decisionBlockId || blueprint.contentVersion !== task.contentVersion) {
        throw new ReviewCoachValidationError("dangling-blueprint", "Task requires a matching accepted blueprint.");
      }
      assertCurrentDecisionBlockRef(await this.database.decisionBlocks.get(task.decisionBlockId), task);
      const normalized: AdaptiveReviewTask = {
        ...task,
        activeSlotKey: task.status === "current" || task.status === "in-progress" ? "global-current" : undefined,
        openTargetKey: isOpenTaskStatus(task.status) ? openTargetKeyFor(task) : undefined,
      };
      try {
        await this.database.adaptiveReviewTasks.add(normalized);
      } catch (error) {
        if (error instanceof Dexie.ConstraintError) throw new ReviewCoachValidationError("task-uniqueness", "Only one current task and one open task per block version are allowed.");
        throw error;
      }
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return normalized;
    });
  }

  async transitionTask(id: string, status: AdaptiveReviewTaskStatus, updatedAt: string, reason?: string): Promise<AdaptiveReviewTask> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const current = await this.database.adaptiveReviewTasks.get(id);
      if (!current) throw new ReviewCoachValidationError("missing-task", `Task ${id} does not exist.`);
      transitionAdaptiveReviewTask(current.status, status);
      if (status !== "stale" && status !== "deleted") assertCurrentDecisionBlockRef(await this.database.decisionBlocks.get(current.decisionBlockId), current);
      const terminal = ["completed", "not-achieved", "invalid", "abandoned", "stale", "deleted"].includes(status);
      const next: AdaptiveReviewTask = {
        ...current,
        status,
        activeSlotKey: status === "current" || status === "in-progress" ? "global-current" : undefined,
        openTargetKey: isOpenTaskStatus(status) ? openTargetKeyFor(current) : undefined,
        startedAt: status === "in-progress" ? current.startedAt ?? updatedAt : current.startedAt,
        endedAt: terminal ? updatedAt : current.endedAt,
        terminalReason: reason ?? current.terminalReason,
        deletedAt: status === "deleted" ? updatedAt : current.deletedAt,
        updatedAt,
      };
      try {
        await this.database.adaptiveReviewTasks.put(next);
      } catch (error) {
        if (error instanceof Dexie.ConstraintError) throw new ReviewCoachValidationError("task-uniqueness", "Only one current task and one open task per block version are allowed.");
        throw error;
      }
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return next;
    });
  }

  async addQuizTurn(turn: AdaptiveQuizTurn): Promise<AdaptiveQuizTurn> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const existing = await ensureIdempotentInsert(this.database.adaptiveQuizTurns, turn);
      if (existing) return existing;
      const task = await this.database.adaptiveReviewTasks.get(turn.taskId);
      if (!task || task.decisionBlockId !== turn.decisionBlockId || task.contentVersion !== turn.contentVersion) throw new ReviewCoachValidationError("dangling-task", "Quiz turn does not match its task.");
      if (task.status !== "in-progress") throw new ReviewCoachValidationError("inactive-task", "Quiz turns can only be displayed for an in-progress task.");
      if (turn.status !== "displayed") throw new ReviewCoachValidationError("non-formal-quiz-turn", "A quiz turn becomes formal only when displayed.");
      assertCurrentDecisionBlockRef(await this.database.decisionBlocks.get(turn.decisionBlockId), turn);
      try {
        await this.database.adaptiveQuizTurns.add(turn);
      } catch (error) {
        if (error instanceof Dexie.ConstraintError) throw new ReviewCoachValidationError("duplicate-quiz-turn", "Task sequence or idempotency key already exists.");
        throw error;
      }
      await this.bumpMutation();
      return turn;
    });
  }

  async transitionQuizTurn(id: string, status: AdaptiveQuizTurnStatus, updatedAt: string): Promise<AdaptiveQuizTurn> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const current = await this.database.adaptiveQuizTurns.get(id);
      if (!current) throw new ReviewCoachValidationError("missing-quiz-turn", `Quiz turn ${id} does not exist.`);
      transitionAdaptiveQuizTurn(current.status, status);
      const next = { ...current, status, updatedAt };
      await this.database.adaptiveQuizTurns.put(next);
      await this.bumpMutation();
      return next;
    });
  }

  async addOutcome(event: TaskOutcomeEvent): Promise<TaskOutcomeEvent> {
    assertTaskOutcomeShape(event);
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const existing = await ensureIdempotentInsert(this.database.taskOutcomeEvents, event);
      if (existing) return existing;
      const task = await this.database.adaptiveReviewTasks.get(event.taskId);
      if (!task || task.decisionBlockId !== event.decisionBlockId || task.contentVersion !== event.contentVersion) throw new ReviewCoachValidationError("dangling-task", "Outcome does not match its task.");
      if (event.turnId) {
        const turn = await this.database.adaptiveQuizTurns.get(event.turnId);
        if (!turn || turn.taskId !== event.taskId) throw new ReviewCoachValidationError("dangling-turn", "Outcome does not match its quiz turn.");
      }
      await this.database.taskOutcomeEvents.add(event);
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return event;
    });
  }

  async commitTaskOutcome(
    taskId: string,
    events: TaskOutcomeEvent[],
    status: "deferred" | "completed" | "not-achieved" | "invalid" | "abandoned",
    updatedAt: string,
  ): Promise<AdaptiveReviewTask> {
    if (events.length === 0) throw new ReviewCoachValidationError("missing-outcome-events", "A task outcome commit requires formal events.");
    events.forEach(assertTaskOutcomeShape);
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const current = await this.database.adaptiveReviewTasks.get(taskId);
      if (!current) throw new ReviewCoachValidationError("missing-task", `Task ${taskId} does not exist.`);
      if (current.status === status) {
        for (const event of events) {
          const existing = await ensureIdempotentInsert(this.database.taskOutcomeEvents, event);
          if (!existing) throw new ReviewCoachValidationError("incomplete-outcome-retry", "Task is terminal but an outcome event is missing.");
        }
        return current;
      }
      transitionAdaptiveReviewTask(current.status, status);
      for (const event of events) {
        if (event.taskId !== taskId || event.decisionBlockId !== current.decisionBlockId || event.recordId !== current.recordId || event.contentVersion !== current.contentVersion) {
          throw new ReviewCoachValidationError("dangling-task", `Outcome ${event.id} does not match task ${taskId}.`);
        }
        if (event.turnId) {
          const turn = await this.database.adaptiveQuizTurns.get(event.turnId);
          if (!turn || turn.taskId !== taskId) throw new ReviewCoachValidationError("dangling-turn", `Outcome ${event.id} does not match its quiz turn.`);
        }
        const existing = await ensureIdempotentInsert(this.database.taskOutcomeEvents, event);
        if (!existing) await this.database.taskOutcomeEvents.add(event);
      }
      const next: AdaptiveReviewTask = {
        ...current,
        status,
        activeSlotKey: undefined,
        openTargetKey: status === "deferred" ? openTargetKeyFor(current) : undefined,
        endedAt: status === "deferred" ? current.endedAt : updatedAt,
        updatedAt,
      };
      await this.database.adaptiveReviewTasks.put(next);
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return next;
    });
  }

  async scheduleVerification(verification: DelayedVerification): Promise<DelayedVerification> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const existing = await ensureIdempotentInsert(this.database.delayedVerifications, verification);
      if (existing) return existing;
      const source = await this.database.taskOutcomeEvents.get(verification.sourceOutcomeEventId);
      if (!source || source.kind !== "self-assessment" || source.subjectiveOutcome !== "mastered" || source.decisionBlockId !== verification.decisionBlockId || source.contentVersion !== verification.contentVersion) {
        throw new ReviewCoachValidationError("invalid-verification-source", "Delayed verification requires a matching mastered self-assessment.");
      }
      if (verification.status !== "scheduled") throw new ReviewCoachValidationError("invalid-verification-status", "A new delayed verification must be scheduled.");
      await this.database.delayedVerifications.add(verification);
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return verification;
    });
  }

  async transitionVerification(id: string, status: DelayedVerificationStatus, updatedAt: string, outcome?: DelayedVerification["verificationOutcome"]): Promise<DelayedVerification> {
    return this.database.transaction("rw", [this.database.cloudSyncMutation, ...formalTables(this.database)], async () => {
      const current = await this.database.delayedVerifications.get(id);
      if (!current) throw new ReviewCoachValidationError("missing-verification", `Verification ${id} does not exist.`);
      transitionDelayedVerification(current.status, status);
      if (status === "completed" && !outcome) throw new ReviewCoachValidationError("missing-verification-outcome", "Completed verification requires an outcome.");
      if (status !== "completed" && outcome) throw new ReviewCoachValidationError("unexpected-verification-outcome", "Only completed verification can record an outcome.");
      const next = {
        ...current,
        status,
        verificationOutcome: status === "completed" ? outcome : current.verificationOutcome,
        lastVerifiedAt: status === "completed" ? updatedAt : current.lastVerifiedAt,
        updatedAt,
      };
      await this.database.delayedVerifications.put(next);
      await this.rebuildProjectionsInTransaction();
      await this.bumpMutation();
      return next;
    });
  }

  async saveAiRoleConfig(config: AiRoleConfig): Promise<AiRoleConfig> {
    return this.database.transaction("rw", [this.database.aiRoleConfigs, this.database.cloudSyncMutation], async () => {
      const byRole = await this.database.aiRoleConfigs.where("role").equals(config.role).first();
      if (byRole && byRole.id !== config.id) throw new ReviewCoachValidationError("duplicate-ai-role", `AI role ${config.role} already has a configuration.`);
      await this.database.aiRoleConfigs.put(config);
      await this.bumpMutation();
      return config;
    });
  }

  async rebuildProjections(): Promise<{ states: DecisionBlockState[]; effects: InterventionEffectSummary[] }> {
    return this.database.transaction("rw", formalTables(this.database), () => this.rebuildProjectionsInTransaction());
  }
}

export const reviewCoachRepository = new DexieReviewCoachRepository();
