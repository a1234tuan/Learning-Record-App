import type {
  AiCompletionUsage,
} from "../../types";
import type {
  AdaptiveReviewTask,
  AnalysisBatch,
  AnalysisInputRef,
  AnalysisQueueItem,
  DecisionBlockFeedback,
  FeedbackInterpretation,
  FeedbackInterpretationStatus,
  SessionBlueprint,
  TaskPriorityTier,
} from "./domain";
import type {
  AnswerEvaluationAiResponse,
  FeedbackInterpretationAiResponse,
  QuestionQualityAiResponse,
  QuizTurnAiResponse,
  SessionBlueprintAiResponse,
  SessionBlueprintAiCandidate,
} from "./aiSchemas";
import type { ReviewCoachRepository } from "./repository";
import { planAnalysisBatches, type AnalysisPlanningBlock } from "./analysisPlanner";

export interface ReviewCoachAiGateway {
  interpretFeedback(input: unknown, signal?: AbortSignal): Promise<FeedbackInterpretationAiCallResult>;
  planSession(input: unknown, signal?: AbortSignal): Promise<SessionPlanningAiCallResult>;
  generateTurn(input: unknown, signal?: AbortSignal): Promise<QuizTurnAiResponse>;
  reviewQuestion(input: unknown, signal?: AbortSignal): Promise<QuestionQualityAiResponse>;
  evaluateAnswer(input: unknown, signal?: AbortSignal): Promise<AnswerEvaluationAiResponse>;
}

export interface FeedbackInterpretationAiCallResult {
  response: FeedbackInterpretationAiResponse;
  usage?: AiCompletionUsage;
  requestId?: string;
}

export interface SessionPlanningAiCallResult {
  response: SessionBlueprintAiResponse;
  usage?: AiCompletionUsage;
  requestId?: string;
}

export interface InterpretFeedbackInput {
  feedbackId: string;
  decisionBlockContent: string;
  provider: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  schemaVersion: number;
  maxRetries?: number;
  force?: boolean;
  signal?: AbortSignal;
}

export interface ReviewCoachOrchestratorDependencies {
  repository: ReviewCoachRepository;
  ids: { next(): string };
  clock: { now(): string };
  aiGateway?: ReviewCoachAiGateway;
}

export interface RecordDecisionBlockFeedbackInput {
  decisionBlockId: string;
  recordId: string;
  contentVersion: number;
  reviewLogId?: string;
  comment: string;
  includeInAnalysis: boolean;
  source?: DecisionBlockFeedback["source"];
  operationId: string;
}

export interface PrepareAnalysisBatchInput {
  inputRefs: AnalysisInputRef[];
  provider: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  schemaVersion: number;
  inputFingerprint: string;
  operationId: string;
  subBatches?: Array<{ inputRefs: AnalysisInputRef[]; estimatedTokens: number }>;
  estimatedTokens?: number;
  allowCrossBlockSupport?: boolean;
}

export interface AnalyzeFeedbackInput {
  blocks: AnalysisPlanningBlock[];
  maxInputTokens: number;
  allowCrossBlockSupport: boolean;
  provider: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  schemaVersion: number;
  operationId: string;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface AnalyzeFeedbackResult {
  batch: AnalysisBatch;
  blueprints: SessionBlueprint[];
  tasks: AdaptiveReviewTask[];
  paused: boolean;
}

const priorityRank: Record<AdaptiveReviewTask["priorityTier"], number> = {
  "due-verification": 0,
  "repeated-difficulty": 1,
  "first-difficulty": 2,
  consolidation: 3,
};

const validateBlueprintCandidates = (
  candidates: SessionBlueprintAiCandidate[],
  blocks: readonly AnalysisPlanningBlock[],
  allowCrossBlockSupport: boolean,
) => {
  const blockById = new Map(blocks.map((item) => [item.decisionBlockId, item]));
  const expectedMainIds = new Set(blockById.keys());
  const seenMainIds = new Set<string>();
  if (candidates.length !== blocks.length) throw new Error("Deep analysis must return one blueprint per selected decision block.");
  for (const candidate of candidates) {
    const main = blockById.get(candidate.mainDecisionBlockId);
    if (!main || seenMainIds.has(candidate.mainDecisionBlockId) || candidate.contentVersion !== main.contentVersion) {
      throw new Error("Blueprint main decision block is missing, duplicated, or stale.");
    }
    seenMainIds.add(candidate.mainDecisionBlockId);
    if (candidate.supportingDecisionBlockIds.some((id) =>
      id === candidate.mainDecisionBlockId || !blockById.has(id) || !allowCrossBlockSupport)) {
      throw new Error("Blueprint references an unconfirmed supporting decision block.");
    }
    const suppliedFeedback = new Set(blocks.flatMap((item) => item.feedback.map((feedback) => feedback.id)));
    const suppliedInterpretations = new Set(blocks.flatMap((item) => item.feedback.map((feedback) => feedback.interpretation?.id).filter((id): id is string => Boolean(id))));
    const mainFeedback = new Set(main.feedback.map((item) => item.id));
    if (candidate.feedbackIds.length === 0 || !candidate.feedbackIds.some((id) => mainFeedback.has(id)) || candidate.feedbackIds.some((id) => !suppliedFeedback.has(id))) {
      throw new Error("Blueprint feedback references are missing or outside the frozen input.");
    }
    if (candidate.interpretationIds.some((id) => !suppliedInterpretations.has(id))) {
      throw new Error("Blueprint interpretation references are outside the frozen input.");
    }
    if (!candidate.evidence.some((item) => item.decisionBlockId === main.decisionBlockId)) {
      throw new Error("Blueprint has no evidence for its main decision block.");
    }
    for (const evidence of candidate.evidence) {
      const source = blockById.get(evidence.decisionBlockId);
      if (!source || evidence.recordId !== source.recordId || evidence.contentVersion !== source.contentVersion || evidence.excerptHash !== source.excerptHash) {
        throw new Error("Blueprint evidence is stale or outside the frozen input.");
      }
    }
  }
  if ([...expectedMainIds].some((id) => !seenMainIds.has(id))) throw new Error("Deep analysis omitted a selected decision block.");
};

const priorityForPlanningBlock = (block: AnalysisPlanningBlock): TaskPriorityTier => {
  if (block.feedback.length > 1) return "repeated-difficulty";
  if (block.feedback.some((item) => item.interpretation?.actionability === "needs_training")) return "first-difficulty";
  return "consolidation";
};

export const rankWaitingTasks = (tasks: AdaptiveReviewTask[], now?: string): AdaptiveReviewTask[] => [...tasks]
  .filter((task) => (task.status === "waiting" || task.status === "deferred") && (!now || !task.notBeforeAt || task.notBeforeAt <= now))
  .sort((left, right) =>
    priorityRank[left.priorityTier] - priorityRank[right.priorityTier] ||
    (left.notBeforeAt ?? left.queuedAt).localeCompare(right.notBeforeAt ?? right.queuedAt) ||
    left.queuedAt.localeCompare(right.queuedAt) ||
    left.id.localeCompare(right.id),
  );

export class ReviewCoachOrchestrator {
  constructor(private readonly dependencies: ReviewCoachOrchestratorDependencies) {}

  async recordFeedback(input: RecordDecisionBlockFeedbackInput): Promise<DecisionBlockFeedback> {
    const comment = input.comment.trim();
    if (!comment) throw new Error("Empty feedback is not recorded.");
    const stamp = this.dependencies.clock.now();
    const feedbackId = this.dependencies.ids.next();
    const feedback: DecisionBlockFeedback = {
      id: feedbackId,
      createdAt: stamp,
      updatedAt: stamp,
      decisionBlockId: input.decisionBlockId,
      recordId: input.recordId,
      contentVersion: input.contentVersion,
      reviewLogId: input.reviewLogId,
      comment,
      includeInAnalysis: input.includeInAnalysis,
      source: input.source ?? "review",
      occurredAt: stamp,
      idempotencyKey: `feedback:${input.operationId}`,
    };
    let queueItem: AnalysisQueueItem | undefined;
    if (input.includeInAnalysis) {
      queueItem = {
        id: this.dependencies.ids.next(),
        createdAt: stamp,
        updatedAt: stamp,
        decisionBlockId: input.decisionBlockId,
        recordId: input.recordId,
        contentVersion: input.contentVersion,
        feedbackId,
        status: "eligible",
        eligibilityReason: "user-feedback",
      };
    }
    return this.dependencies.repository.addFeedback(feedback, queueItem);
  }

  /** Run the quick interpreter without blocking the review transaction. */
  async interpretFeedback(input: InterpretFeedbackInput): Promise<FeedbackInterpretation> {
    if (!this.dependencies.aiGateway) throw new Error("Review coach AI gateway is not configured.");
    const [snapshot, allInterpretations] = await Promise.all([
      this.dependencies.repository.getFormalSnapshot(),
      this.dependencies.repository.listFeedbackInterpretations(),
    ]);
    const feedback = snapshot.decisionBlockFeedback.find((item) => item.id === input.feedbackId && !item.deletedAt);
    if (!feedback) throw new Error(`Feedback ${input.feedbackId} does not exist.`);
    const current = allInterpretations.find((item) => item.feedbackId === feedback.id && !item.deletedAt);
    if (!input.force && current && ["succeeded", "insufficient-context"].includes(current.status)) return current;

    const stamp = this.dependencies.clock.now();
    const interpretationId = current?.id ?? `feedback-interpretation:${feedback.id}`;
    const metadata = {
      feedbackId: feedback.id,
      decisionBlockId: feedback.decisionBlockId,
      contentVersion: feedback.contentVersion,
      aiGenerated: true,
      model: input.model,
      provider: input.provider,
      promptVersion: input.promptVersion,
      policyVersion: input.policyVersion,
      schemaVersion: input.schemaVersion,
    };
    let interpretation: FeedbackInterpretation = current ?? {
      id: interpretationId,
      createdAt: stamp,
      updatedAt: stamp,
      ...metadata,
      status: "pending",
      missingInformation: [],
    };
    if (interpretation.status !== "pending" && interpretation.status !== "running") {
      interpretation = { ...interpretation, ...metadata, status: "pending", updatedAt: stamp, errorCode: undefined };
      await this.dependencies.repository.saveFeedbackInterpretation(interpretation);
    } else if (!current) {
      await this.dependencies.repository.saveFeedbackInterpretation(interpretation);
    }
    interpretation = { ...interpretation, ...metadata, status: "running", updatedAt: this.dependencies.clock.now(), errorCode: undefined };
    await this.dependencies.repository.saveFeedbackInterpretation(interpretation);

    const maxRetries = Math.max(0, Math.min(3, Math.floor(input.maxRetries ?? 2)));
    const feedbackById = new Map(snapshot.decisionBlockFeedback.map((item) => [item.id, item]));
    const historicalTrend = snapshot.feedbackInterpretations
      .filter((item) => item.decisionBlockId === feedback.decisionBlockId && item.feedbackId !== feedback.id && !item.deletedAt)
      .map((item) => ({ feedback: feedbackById.get(item.feedbackId), interpretation: item }))
      .filter((item) => item.feedback && item.feedback.occurredAt < feedback.occurredAt)
      .sort((left, right) => left.feedback!.occurredAt.localeCompare(right.feedback!.occurredAt))
      .map(({ feedback: earlier, interpretation: prior }) => ({
        occurredAt: earlier!.occurredAt,
        originalComment: earlier!.comment,
        status: prior.status,
        actionability: prior.actionability,
        difficultyType: prior.difficultyType,
        stuckAt: prior.stuckAt,
        preferredPractice: prior.preferredPractice,
        confidence: prior.confidence,
        userConfirmed: Boolean(prior.userConfirmedAt),
      }));
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const call = await this.dependencies.aiGateway.interpretFeedback({
          feedbackId: feedback.id,
          decisionBlockId: feedback.decisionBlockId,
          recordId: feedback.recordId,
          contentVersion: feedback.contentVersion,
          comment: feedback.comment,
          decisionBlockContent: input.decisionBlockContent,
          historicalTrend,
        }, input.signal);
        const response = call.response;
        const callMetadata = {
          promptTokens: call.usage?.promptTokens,
          completionTokens: call.usage?.completionTokens,
          totalTokens: call.usage?.totalTokens,
          requestId: call.requestId,
          attemptCount: attempt + 1,
        };
        const next: FeedbackInterpretation = response.status === "insufficient-context"
          ? { ...interpretation, ...callMetadata, status: "insufficient-context", missingInformation: response.missingInformation, actionability: "unclear", confidence: undefined, updatedAt: this.dependencies.clock.now() }
          : { ...interpretation, ...callMetadata, status: "succeeded", actionability: response.actionability, difficultyType: response.difficultyType, stuckAt: response.stuckAt, userHypothesis: response.userHypothesis, preferredPractice: response.preferredPractice, missingInformation: response.missingInformation, confidence: response.confidence, updatedAt: this.dependencies.clock.now() };
        return this.dependencies.repository.saveFeedbackInterpretation(next);
      } catch (error) {
        if (input.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return this.dependencies.repository.saveFeedbackInterpretation({
            ...interpretation,
            status: "pending",
            attemptCount: attempt,
            updatedAt: this.dependencies.clock.now(),
            errorCode: undefined,
          });
        }
        lastError = error;
      }
    }
    const failed: FeedbackInterpretation = {
      ...interpretation,
      status: "failed" as FeedbackInterpretationStatus,
      attemptCount: maxRetries + 1,
      errorCode: lastError instanceof Error ? lastError.message.slice(0, 240) : "interpretation-failed",
      updatedAt: this.dependencies.clock.now(),
    };
    return this.dependencies.repository.saveFeedbackInterpretation(failed);
  }

  async confirmFeedbackInterpretation(
    feedbackId: string,
    patch: Partial<Pick<FeedbackInterpretation, "actionability" | "difficultyType" | "stuckAt" | "userHypothesis" | "preferredPractice" | "missingInformation" | "confidence">> = {},
  ): Promise<FeedbackInterpretation> {
    const snapshot = await this.dependencies.repository.getFormalSnapshot();
    const current = snapshot.feedbackInterpretations.find((item) => item.feedbackId === feedbackId && !item.deletedAt);
    if (!current) throw new Error(`Feedback ${feedbackId} has no interpretation.`);
    const stamp = this.dependencies.clock.now();
    return this.dependencies.repository.saveFeedbackInterpretation({
      ...current,
      ...patch,
      status: "succeeded",
      aiGenerated: false,
      userConfirmedAt: current.userConfirmedAt ?? stamp,
      userEditedAt: Object.keys(patch).length > 0 ? stamp : current.userEditedAt,
      updatedAt: stamp,
      errorCode: undefined,
    });
  }

  async prepareAnalysisBatch(input: PrepareAnalysisBatchInput): Promise<AnalysisBatch> {
    if (input.inputRefs.length === 0) throw new Error("An analysis batch requires input.");
    const stamp = this.dependencies.clock.now();
    const subBatches = input.subBatches?.map((item) => ({
      id: this.dependencies.ids.next(), inputRefs: item.inputRefs, status: "pending" as const, estimatedTokens: item.estimatedTokens,
    })) ?? (() => {
      const generated = [];
      const byDecisionBlock = new Map<string, AnalysisInputRef[]>();
      for (const ref of input.inputRefs) {
        const current = byDecisionBlock.get(ref.decisionBlockId) ?? [];
        current.push(ref);
        byDecisionBlock.set(ref.decisionBlockId, current);
      }
      const blockGroups = [...byDecisionBlock.values()];
      for (let index = 0; index < blockGroups.length; index += 3) {
        generated.push({ id: this.dependencies.ids.next(), inputRefs: blockGroups.slice(index, index + 3).flat(), status: "pending" as const });
      }
      return generated;
    })();
    return this.dependencies.repository.createAnalysisBatch({
      id: this.dependencies.ids.next(),
      createdAt: stamp,
      updatedAt: stamp,
      status: "draft",
      inputRefs: input.inputRefs,
      subBatches,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      policyVersion: input.policyVersion,
      schemaVersion: input.schemaVersion,
      inputFingerprint: input.inputFingerprint,
      idempotencyKey: `analysis:${input.operationId}`,
      estimatedTokens: input.estimatedTokens,
      allowCrossBlockSupport: input.allowCrossBlockSupport,
    });
  }

  async analyzeFeedback(input: AnalyzeFeedbackInput): Promise<AnalyzeFeedbackResult> {
    if (!this.dependencies.aiGateway) throw new Error("Review coach AI gateway is not configured.");
    const plan = planAnalysisBatches(input.blocks, input.maxInputTokens);
    if (plan.oversized.length > 0) throw new Error(`决策块超过模型上下文上限：${plan.oversized.map((item) => item.recordTitle).join("、")}`);
    if (plan.subBatches.length === 0) throw new Error("没有可分析的决策块。");
    const blockById = new Map(input.blocks.map((item) => [item.decisionBlockId, item]));
    let batch = await this.prepareAnalysisBatch({
      inputRefs: plan.subBatches.flatMap((item) => item.blocks.flatMap((block) => block.inputRefs)),
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      policyVersion: input.policyVersion,
      schemaVersion: input.schemaVersion,
      inputFingerprint: plan.inputFingerprint,
      operationId: input.operationId,
      subBatches: plan.subBatches.map((item) => ({ inputRefs: item.blocks.flatMap((block) => block.inputRefs), estimatedTokens: item.estimatedTokens })),
      estimatedTokens: plan.estimatedTokens,
      allowCrossBlockSupport: input.allowCrossBlockSupport,
    });
    if (batch.status === "draft") batch = await this.dependencies.repository.transitionAnalysisBatch(batch.id, "confirmed", this.dependencies.clock.now());
    if (batch.status === "confirmed") batch = await this.dependencies.repository.transitionAnalysisBatch(batch.id, "running", this.dependencies.clock.now());

    const existingSnapshot = await this.dependencies.repository.getFormalSnapshot();
    const blueprints = existingSnapshot.sessionBlueprints.filter((item) => item.batchId === batch.id && item.status === "accepted");
    const existingBlueprintIds = new Set(blueprints.map((item) => item.id));
    const tasks = existingSnapshot.adaptiveReviewTasks.filter((item) => existingBlueprintIds.has(item.blueprintId) && !item.deletedAt);
    const summaries: string[] = [];
    const maxRetries = Math.max(0, Math.min(2, Math.floor(input.maxRetries ?? 1)));
    for (let index = 0; index < batch.subBatches.length; index += 1) {
      const subBatch = batch.subBatches[index];
      if (subBatch.status === "succeeded") continue;
      const blocks = [...new Set(subBatch.inputRefs.map((ref) => ref.decisionBlockId))].map((id) => blockById.get(id)).filter((item): item is AnalysisPlanningBlock => Boolean(item));
      if (blocks.length === 0) throw new Error("冻结批次中的决策块上下文缺失。");
      batch = {
        ...batch,
        updatedAt: this.dependencies.clock.now(),
        subBatches: batch.subBatches.map((item, itemIndex) => itemIndex === index ? { ...item, status: "running", errorCode: undefined } : item),
      };
      batch = await this.dependencies.repository.updateAnalysisBatch(batch);
      let lastError: unknown;
      let completed = false;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const call = await this.dependencies.aiGateway.planSession({
            blocks: blocks.map((block) => ({
              decisionBlockId: block.decisionBlockId,
              recordId: block.recordId,
              contentVersion: block.contentVersion,
              recordTitle: block.recordTitle,
              subject: block.subject,
              contextMarkdown: block.contextMarkdown,
              excerptHash: block.excerptHash,
              feedback: block.feedback.map((feedback) => ({
                id: feedback.id,
                originalComment: feedback.comment,
                occurredAt: feedback.occurredAt,
                analysisNote: feedback.analysisNote,
                interpretation: feedback.interpretation ? {
                  id: feedback.interpretation.id,
                  actionability: feedback.interpretation.actionability,
                  difficultyType: feedback.interpretation.difficultyType,
                  stuckAt: feedback.interpretation.stuckAt,
                  userHypothesis: feedback.interpretation.userHypothesis,
                  preferredPractice: feedback.interpretation.preferredPractice,
                  confidence: feedback.interpretation.confidence,
                  userConfirmed: Boolean(feedback.interpretation.userConfirmedAt),
                } : undefined,
              })),
            })),
            allowedSupportingDecisionBlockIds: input.allowCrossBlockSupport ? blocks.map((block) => block.decisionBlockId) : [],
          }, input.signal);
          if (call.response.status === "insufficient-context") throw new Error(`insufficient-context:${call.response.missingInformation.join("、")}`);
          validateBlueprintCandidates(call.response.blueprints, blocks, input.allowCrossBlockSupport);
          summaries.push(call.response.summary);
          for (const candidate of call.response.blueprints) {
            const persisted = await this.persistAnalysisCandidate(batch, candidate, blockById.get(candidate.mainDecisionBlockId)!, input);
            if (!blueprints.some((item) => item.id === persisted.blueprint.id)) blueprints.push(persisted.blueprint);
            if (!tasks.some((item) => item.id === persisted.task.id)) tasks.push(persisted.task);
          }
          batch = {
            ...batch,
            updatedAt: this.dependencies.clock.now(),
            subBatches: batch.subBatches.map((item, itemIndex) => itemIndex === index ? {
              ...item,
              status: "succeeded",
              promptTokens: call.usage?.promptTokens,
              completionTokens: call.usage?.completionTokens,
              totalTokens: call.usage?.totalTokens,
              requestId: call.requestId,
              attemptCount: attempt + 1,
              errorCode: undefined,
            } : item),
          };
          batch = await this.dependencies.repository.updateAnalysisBatch(batch);
          completed = true;
          break;
        } catch (error) {
          if (input.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            batch = {
              ...batch,
              status: "confirmed",
              updatedAt: this.dependencies.clock.now(),
              subBatches: batch.subBatches.map((item, itemIndex) => itemIndex === index ? { ...item, status: "pending", errorCode: undefined } : item),
            };
            batch = await this.dependencies.repository.updateAnalysisBatch(batch);
            return { batch, blueprints, tasks, paused: true };
          }
          lastError = error;
        }
      }
      if (!completed) {
        batch = {
          ...batch,
          updatedAt: this.dependencies.clock.now(),
          subBatches: batch.subBatches.map((item, itemIndex) => itemIndex === index ? {
            ...item,
            status: "failed",
            attemptCount: maxRetries + 1,
            errorCode: lastError instanceof Error ? lastError.message.slice(0, 240) : "analysis-failed",
          } : item),
        };
        batch = await this.dependencies.repository.updateAnalysisBatch(batch);
      }
    }

    const succeededCount = batch.subBatches.filter((item) => item.status === "succeeded").length;
    const finalStatus = succeededCount === batch.subBatches.length ? "succeeded" : succeededCount > 0 ? "partial" : "failed";
    const successfulSubBatches = batch.subBatches.filter((item) => item.status === "succeeded");
    batch = await this.dependencies.repository.updateAnalysisBatch({
      ...batch,
      status: finalStatus,
      finalSummary: summaries.filter(Boolean).join("\n"),
      promptTokens: successfulSubBatches.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0) || undefined,
      completionTokens: successfulSubBatches.reduce((sum, item) => sum + (item.completionTokens ?? 0), 0) || undefined,
      totalTokens: successfulSubBatches.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0) || undefined,
      completedAt: this.dependencies.clock.now(),
      updatedAt: this.dependencies.clock.now(),
      errorCode: finalStatus === "failed" ? "all-sub-batches-failed" : undefined,
    });

    await this.selectNextTask();
    return { batch, blueprints, tasks, paused: false };
  }

  private async persistAnalysisCandidate(
    batch: AnalysisBatch,
    candidate: SessionBlueprintAiCandidate,
    block: AnalysisPlanningBlock,
    input: AnalyzeFeedbackInput,
  ): Promise<{ blueprint: SessionBlueprint; task: AdaptiveReviewTask }> {
    const stamp = this.dependencies.clock.now();
    const blueprint = await this.dependencies.repository.acceptBlueprint({
        id: this.dependencies.ids.next(),
        batchId: batch.id,
        decisionBlockId: block.decisionBlockId,
        recordId: block.recordId,
        contentVersion: block.contentVersion,
        status: "accepted",
        supportingDecisionBlockIds: candidate.supportingDecisionBlockIds,
        feedbackIds: candidate.feedbackIds,
        interpretationIds: candidate.interpretationIds,
        problemHypothesis: candidate.problemHypothesis,
        hypothesisConfidence: candidate.hypothesisConfidence,
        objective: candidate.objective,
        completionCriteria: candidate.completionCriteria,
        initialPracticeType: candidate.initialPracticeType,
        initialDifficulty: candidate.initialDifficulty,
        expectedKeyPoints: candidate.expectedKeyPoints,
        branches: candidate.branches,
        allowedStrategies: candidate.allowedStrategies,
        forbiddenScope: candidate.forbiddenScope,
        evidence: candidate.evidence.map((item) => ({ ...item, decisionBlockId: item.decisionBlockId })),
        maxTurns: candidate.maxTurns,
        maxRetriesPerTurn: candidate.maxRetriesPerTurn,
        maxEstimatedTokens: candidate.maxEstimatedTokens,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        policyVersion: input.policyVersion,
        schemaVersion: input.schemaVersion,
        idempotencyKey: `blueprint:${batch.id}:${block.decisionBlockId}:${block.contentVersion}`,
        createdAt: stamp,
        updatedAt: stamp,
      });
    const task = await this.dependencies.repository.createTask({
        id: this.dependencies.ids.next(),
        blueprintId: blueprint.id,
        decisionBlockId: blueprint.decisionBlockId,
        recordId: blueprint.recordId,
        contentVersion: blueprint.contentVersion,
        status: "waiting",
        priorityTier: priorityForPlanningBlock(block),
        queuedAt: stamp,
        idempotencyKey: `task:${blueprint.id}`,
        createdAt: stamp,
        updatedAt: stamp,
      });
    return { blueprint, task };
  }

  acceptBlueprint(blueprint: SessionBlueprint) {
    return this.dependencies.repository.acceptBlueprint(blueprint);
  }

  async switchCurrentTask(taskId: string): Promise<AdaptiveReviewTask> {
    return this.dependencies.repository.switchCurrentTask(taskId, this.dependencies.clock.now());
  }

  async deferTask(taskId: string, operationId: string, delayHours = 24): Promise<AdaptiveReviewTask> {
    const snapshot = await this.dependencies.repository.getFormalSnapshot();
    const task = snapshot.adaptiveReviewTasks.find((item) => item.id === taskId && !item.deletedAt);
    if (!task) throw new Error(`Task ${taskId} does not exist.`);
    const stamp = this.dependencies.clock.now();
    const notBeforeAt = new Date(Date.parse(stamp) + Math.max(1, delayHours) * 60 * 60 * 1000).toISOString();
    const deferred = await this.dependencies.repository.commitTaskOutcome(task.id, [{
      id: this.dependencies.ids.next(),
      taskId: task.id,
      decisionBlockId: task.decisionBlockId,
      recordId: task.recordId,
      contentVersion: task.contentVersion,
      kind: "task-disposition",
      disposition: "deferred",
      occurredAt: stamp,
      idempotencyKey: `task-deferred:${operationId}`,
      createdAt: stamp,
      updatedAt: stamp,
    }], "deferred", stamp, notBeforeAt);
    await this.selectNextTask();
    return deferred;
  }

  async selectNextTask(): Promise<AdaptiveReviewTask | undefined> {
    const snapshot = await this.dependencies.repository.getFormalSnapshot();
    const current = snapshot.adaptiveReviewTasks.find((task) => task.status === "current" || task.status === "in-progress");
    if (current) return current;
    const next = rankWaitingTasks(snapshot.adaptiveReviewTasks, this.dependencies.clock.now())[0];
    if (!next) return undefined;
    return this.dependencies.repository.transitionTask(next.id, "current", this.dependencies.clock.now());
  }
}
