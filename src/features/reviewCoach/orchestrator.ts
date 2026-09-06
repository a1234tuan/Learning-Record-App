import type {
  AdaptiveReviewTask,
  AnalysisBatch,
  AnalysisInputRef,
  AnalysisQueueItem,
  DecisionBlockFeedback,
  SessionBlueprint,
} from "./domain";
import type {
  AnswerEvaluationAiResponse,
  FeedbackInterpretationAiResponse,
  QuestionQualityAiResponse,
  QuizTurnAiResponse,
  SessionBlueprintAiResponse,
} from "./aiSchemas";
import type { ReviewCoachRepository } from "./repository";

export interface ReviewCoachAiGateway {
  interpretFeedback(input: unknown, signal?: AbortSignal): Promise<FeedbackInterpretationAiResponse>;
  planSession(input: unknown, signal?: AbortSignal): Promise<SessionBlueprintAiResponse>;
  generateTurn(input: unknown, signal?: AbortSignal): Promise<QuizTurnAiResponse>;
  reviewQuestion(input: unknown, signal?: AbortSignal): Promise<QuestionQualityAiResponse>;
  evaluateAnswer(input: unknown, signal?: AbortSignal): Promise<AnswerEvaluationAiResponse>;
}

export interface ReviewCoachOrchestratorDependencies {
  repository: ReviewCoachRepository;
  ids: { next(): string };
  clock: { now(): string };
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
}

const priorityRank: Record<AdaptiveReviewTask["priorityTier"], number> = {
  "due-verification": 0,
  "repeated-difficulty": 1,
  "first-difficulty": 2,
  consolidation: 3,
};

export const rankWaitingTasks = (tasks: AdaptiveReviewTask[]): AdaptiveReviewTask[] => [...tasks]
  .filter((task) => task.status === "waiting" || task.status === "deferred")
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

  async prepareAnalysisBatch(input: PrepareAnalysisBatchInput): Promise<AnalysisBatch> {
    if (input.inputRefs.length === 0) throw new Error("An analysis batch requires input.");
    const stamp = this.dependencies.clock.now();
    const subBatches = [];
    const byDecisionBlock = new Map<string, AnalysisInputRef[]>();
    for (const ref of input.inputRefs) {
      const current = byDecisionBlock.get(ref.decisionBlockId) ?? [];
      current.push(ref);
      byDecisionBlock.set(ref.decisionBlockId, current);
    }
    const blockGroups = [...byDecisionBlock.values()];
    for (let index = 0; index < blockGroups.length; index += 3) {
      subBatches.push({
        id: this.dependencies.ids.next(),
        inputRefs: blockGroups.slice(index, index + 3).flat(),
        status: "pending" as const,
      });
    }
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
    });
  }

  acceptBlueprint(blueprint: SessionBlueprint) {
    return this.dependencies.repository.acceptBlueprint(blueprint);
  }

  async selectNextTask(): Promise<AdaptiveReviewTask | undefined> {
    const snapshot = await this.dependencies.repository.getFormalSnapshot();
    const current = snapshot.adaptiveReviewTasks.find((task) => task.status === "current" || task.status === "in-progress");
    if (current) return current;
    const next = rankWaitingTasks(snapshot.adaptiveReviewTasks)[0];
    if (!next) return undefined;
    return this.dependencies.repository.transitionTask(next.id, "current", this.dependencies.clock.now());
  }
}
