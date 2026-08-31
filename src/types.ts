export type EntityId = string;
export type ISODate = string;
export type ISODateTime = string;

export type Subject = string;
export type MasteryStatus = "待复习" | "复习中" | "已掌握";
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type ReviewResult = "remembered" | "forgot";
export type RecordReviewKind = "overview" | "memory";
export type RecordReviewScheduler = "overview-v1" | "fsrs-v6" | "sm2-legacy";
export type RecordReviewRating = "forgot" | "fuzzy" | "good" | "easy" | "remembered";
export type RecordReviewStatus = "active" | "mastered" | "removed";
export type RecordReviewEventType = "rating" | "added" | "reset" | "removed" | "kind-changed" | "rating-undone";
export type ExportKind = "full-backup" | "subject-markdown" | "knowledge-json" | "plain-text";
export type ImportProgressStage =
  | "choosing"
  | "reading"
  | "loading"
  | "indexing"
  | "parsing"
  | "assets"
  | "restoring"
  | "done";
export type ExportProgressStage = "preparing" | "zipping" | "asset" | "writing" | "sharing" | "done";

export interface BaseEntity {
  id: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime;
}

export type BlockType =
  | "record"
  | "richText"
  | "image"
  | "attachment"
  | "code"
  | "formula"
  | "todo"
  | "studySession"
  | "mistakeRef"
  | "quote";

export interface RecordAssetRef {
  id: EntityId;
  title: string;
  kind: "image" | "attachment" | "audio";
}

export interface RecordFormula {
  id: EntityId;
  latex: string;
  title?: string;
}

export interface RecordBlock extends BaseEntity {
  type: "record";
  date: ISODate;
  order: number;
  subject: Subject;
  title: string;
  contentHtml: string;
  assets: RecordAssetRef[];
  formulas: RecordFormula[];
  mistakeRefs: EntityId[];
  tags: string[];
  favorite?: boolean;
}

export interface RecordDraft {
  id: EntityId;
  recordId: EntityId;
  baseUpdatedAt: ISODateTime;
  draft: RecordBlock;
  updatedAt: ISODateTime;
}

/** A reusable rich-text fragment that can be copied into a journal record. */
export interface ContentTemplate extends BaseEntity {
  title: string;
  contentHtml: string;
}

export interface RecordReviewState extends BaseEntity {
  recordId: EntityId;
  status: RecordReviewStatus;
  reviewKind?: RecordReviewKind;
  scheduler?: RecordReviewScheduler;
  easeFactor: number;
  repetition: number;
  intervalDays: number;
  nextReviewDate?: ISODate;
  lastReviewDate?: ISODate;
  lastReviewedAt?: ISODateTime;
  consecutiveRemembered: number;
  totalReviews: number;
  fsrsCard?: RecordReviewFsrsCard;
}

export interface RecordReviewFsrsCard {
  dueDate: ISODate;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReviewDate?: ISODate;
}

export interface RecordReviewLog extends BaseEntity {
  recordId: EntityId;
  rating: RecordReviewRating;
  /** Non-rating operations are immutable sync events and are hidden from rating history. */
  eventType?: RecordReviewEventType;
  /** The rating event neutralized by a synchronized undo action. */
  revertedEventId?: EntityId;
  normalizedRating?: Exclude<RecordReviewRating, "remembered">;
  reviewKind?: RecordReviewKind;
  scheduler?: RecordReviewScheduler;
  evaluationText?: string;
  reviewedAt: ISODateTime;
  previousEaseFactor: number;
  nextEaseFactor: number;
  previousRepetition: number;
  nextRepetition: number;
  previousIntervalDays: number;
  nextIntervalDays: number;
  previousNextReviewDate?: ISODate;
  nextReviewDate?: ISODate;
  previousLastReviewDate?: ISODate;
  previousLastReviewedAt?: ISODateTime;
  previousConsecutiveRemembered?: number;
  previousTotalReviews?: number;
  previousFsrsCard?: RecordReviewFsrsCard;
  nextFsrsCard?: RecordReviewFsrsCard;
  /** The event projection used to rebuild review state after merging cloud events. */
  stateAfter?: RecordReviewState;
}

export interface RecordReviewUndoToken {
  recordId: EntityId;
  reviewedAt: ISODateTime;
  reviewLogId: EntityId;
  previousReview: RecordReviewState;
  previousLog?: RecordReviewLog;
  previousDayStat?: RecordReviewDayStat;
}

export interface RecordReviewRateResult {
  review: RecordReviewState;
  undoToken: RecordReviewUndoToken;
}

export interface RecordReviewDayStat extends BaseEntity {
  date: ISODate;
  dueCountAtFirstOpen: number;
  reviewedCount: number;
  rememberedCount: number;
  fuzzyCount: number;
  forgotCount: number;
  goodCount?: number;
  easyCount?: number;
  completedAt?: ISODateTime;
}

export interface RecordReviewBulkResult {
  added: number;
  reset: number;
  skippedActive: number;
}

export interface RecordReviewStats {
  activeCount: number;
  masteredCount: number;
  dueCount: number;
  overdueCount: number;
  totalReviews: number;
  streakDays: number;
  todayStat?: RecordReviewDayStat;
  dayStats: RecordReviewDayStat[];
  masteryTrend: Array<{ date: ISODate; rememberedRate: number; reviewedCount: number }>;
}

export interface RichTextBlock extends BaseEntity {
  type: "richText";
  date: ISODate;
  order: number;
  content: string;
}

export interface ImageBlock extends BaseEntity {
  type: "image";
  date: ISODate;
  order: number;
  assetId: EntityId;
  caption?: string;
}

export interface AttachmentBlock extends BaseEntity {
  type: "attachment";
  date: ISODate;
  order: number;
  assetId: EntityId;
  note?: string;
}

export interface CodeBlock extends BaseEntity {
  type: "code";
  date: ISODate;
  order: number;
  language: string;
  code: string;
}

export interface FormulaBlock extends BaseEntity {
  type: "formula";
  date: ISODate;
  order: number;
  latex: string;
}

export interface TodoItem {
  id: EntityId;
  text: string;
  done: boolean;
}

export interface TodoBlock extends BaseEntity {
  type: "todo";
  date: ISODate;
  order: number;
  title: string;
  items: TodoItem[];
}

export interface StudySessionBlock extends BaseEntity {
  type: "studySession";
  date: ISODate;
  order: number;
  subject: Subject;
  minutes: number;
  note?: string;
}

export interface MistakeRefBlock extends BaseEntity {
  type: "mistakeRef";
  date: ISODate;
  order: number;
  mistakeId: EntityId;
}

export interface QuoteBlock extends BaseEntity {
  type: "quote";
  date: ISODate;
  order: number;
  text: string;
  source?: string;
}

export type Block =
  | RecordBlock
  | RichTextBlock
  | ImageBlock
  | AttachmentBlock
  | CodeBlock
  | FormulaBlock
  | TodoBlock
  | StudySessionBlock
  | MistakeRefBlock
  | QuoteBlock;

export interface DayEntry extends BaseEntity {
  date: ISODate;
  title: string;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  summary?: string;
}

export interface Tag extends BaseEntity {
  name: string;
  parent?: string;
  color?: string;
}

export interface SubjectConfig extends BaseEntity {
  name: Subject;
  order: number;
  archivedAt?: ISODateTime;
}

export interface AutoBackupSettings {
  enabled: boolean;
  folderName?: string;
  backupFormat?: "zip-latest" | "folder-repository-v1";
  lastBackupAt?: ISODateTime;
  lastBackupSize?: number;
  lastBackupBytesWritten?: number;
  lastBackupRepositorySize?: number;
  lastBackupAssetCount?: number;
  lastBackupSnapshotId?: string;
  lastBackupFileName?: string;
  lastBackupUri?: string;
  lastBackupVerifiedAt?: ISODateTime;
  lastBackupFileModifiedAt?: ISODateTime;
  lastBackupWarning?: string;
  lastError?: string;
  debounceMs: number;
}

/** Stored in a local-only Dexie table, never synced to the cloud. */
export type AutoBackupStateRecord = AutoBackupSettings & { id: "autoBackup" };

export interface AiPromptPreset extends BaseEntity {
  title: string;
  prompt: string;
  order: number;
  mode?: "recall" | "application" | "trap" | "feynman" | "correction" | "custom";
}

export interface AiProviderProfile {
  id: EntityId;
  providerName: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindowTokens?: number;
  memoryTurns?: number;
  builtIn?: "deepseek" | "nvidia" | "aliyun" | "custom-proxy";
}

export interface AiProviderConfig {
  currentProviderId: EntityId;
  providers: AiProviderProfile[];
  presets: AiPromptPreset[];
  imageInputMode?: "vision" | "local-ocr" | "disabled";
}

export interface AiSecret {
  id: EntityId;
  apiKey: string;
  /** Second credential for providers needing a key pair (e.g. Tencent Cloud SecretId + SecretKey). */
  apiKeySecondary?: string;
  updatedAt: ISODateTime;
}

export interface AiSkippedAsset {
  id: EntityId;
  title: string;
  kind: "image" | "attachment" | "audio";
  reason: string;
}

export interface AiLogContextAttachment {
  date: ISODate;
  scope?: AiKnowledgeScope;
  scopeTitle?: string;
  recordIds: EntityId[];
  markdown: string;
  warnings: string[];
  skippedAssets: AiSkippedAsset[];
  missingOcrAssetIds: EntityId[];
  ocrSummary?: {
    includedImages: number;
    skippedImages: number;
  };
}

export interface AiContextChunk {
  chunkId: EntityId;
  recordId: EntityId;
  date: ISODate;
  subject: Subject;
  tags?: string[];
  title: string;
  kind: "text" | "formula" | "imageOcr";
  content: string;
  markdown?: string;
  sourceLabel: string;
  order: number;
}

export interface AiContextPack extends AiLogContextAttachment {
  summary: string;
  selectedChunks: AiContextChunk[];
  allChunks: AiContextChunk[];
  totalChunks: number;
  estimatedChars: number;
  contextHash: string;
}

export interface AiChatSession extends BaseEntity {
  title: string;
  sourceDate?: ISODate;
  scope?: AiKnowledgeScope;
  scopeTitle?: string;
  attachment?: AiContextPack;
  memorySummary?: string;
  lastContextHash?: string;
  /** Local-only metadata for the learning coach single-question flow. */
  coachQuiz?: {
    taskId?: EntityId;
    knowledgePointId?: EntityId;
    recordIds: EntityId[];
    contextFingerprint: string;
    questionMessageId?: EntityId;
    answerEvidenceId?: EntityId;
    assessment?: {
      assistantMessageId: EntityId;
      status: "proposed" | "accepted" | "rejected";
      suggestedOutcome: "needs-review" | "satisfactory";
    };
  };
}

export interface AiCompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedPromptTokens?: number;
}

export interface AiCompletionResult {
  content: string;
  finishReason?: string;
  usage?: AiCompletionUsage;
  requestId?: string;
}

export type TtsProviderId = "fish-audio" | "aliyun" | "tencent" | "google" | "doubao";

export interface TtsProviderProfile {
  id: EntityId;
  providerId: TtsProviderId;
  providerName: string;
  model: string;
  voice: string;
  /** Tencent Cloud requires a signing region (e.g. ap-guangzhou). */
  region?: string;
  /** Google Cloud TTS voices are scoped to a BCP-47 language code (e.g. cmn-CN). */
  languageCode?: string;
}

export interface TtsProviderConfig {
  currentProviderId: EntityId;
  providers: TtsProviderProfile[];
}

/** The per-episode editorial brief used to steer a knowledge-podcast script. */
export interface KnowledgePodcastCreativeBrief {
  objective?: string;
  audience?: string;
  narratorRole?: string;
  tone?: string;
  organization?: string;
  mustCover?: string;
  avoid?: string;
  chapterRequirements?: string;
  openingRequirements?: string;
  closingRequirements?: string;
  supplementaryRequirements?: string;
}

/** A reusable, user-authored direction for knowledge-podcast scripts. */
export interface KnowledgePodcastModeTemplate extends BaseEntity {
  title: string;
  /**
   * An advanced authoring template. It may contain supported {{变量}} tokens;
   * the system appends the source and JSON constraints separately.
   */
  prompt: string;
  order: number;
}

export type KnowledgePodcastMode = "summary" | "explain" | "custom";

/** A copy of a selected template so historical episodes remain reproducible. */
export interface KnowledgePodcastCustomModeSnapshot {
  templateId: EntityId;
  title: string;
  prompt: string;
}

export interface KnowledgePodcastSegment {
  id: EntityId;
  order: number;
  title: string;
  text: string;
  sourceRecordIds: EntityId[];
  textHash: string;
  audioAssetId?: EntityId;
  audioStatus: "pending" | "generating" | "ready" | "failed";
  durationSeconds?: number;
  error?: string;
}

export type KnowledgePodcastAudioUnitKind = "opening" | "segment" | "closing";

export interface KnowledgePodcastAudioUnit {
  id: EntityId;
  kind: KnowledgePodcastAudioUnitKind;
  order: number;
  title: string;
  segmentId?: EntityId;
  textHash: string;
  audioAssetId?: EntityId;
  audioStatus: "pending" | "generating" | "ready" | "failed";
  durationSeconds?: number;
  error?: string;
}

export type KnowledgePodcastGenerationStage =
  | "preparing"
  | "building-context"
  | "requesting-ai"
  | "retrying-ai"
  | "parsing-script"
  | "saving-script"
  | "preparing-audio"
  | "generating-segment"
  | "saving-audio"
  | "completed"
  | "failed"
  | "cancelled";

export interface KnowledgePodcastGenerationProgress {
  kind: "script" | "audio";
  status: "running" | "completed" | "failed" | "cancelled";
  stage: KnowledgePodcastGenerationStage;
  message: string;
  startedAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Updated by the active runner; a stale heartbeat means the runner is gone. */
  heartbeatAt?: ISODateTime;
  requestStartedAt?: ISODateTime;
  nativeJobId?: string;
  providerName?: string;
  model?: string;
  attempt?: number;
  current?: number;
  total?: number;
  partCurrent?: number;
  partTotal?: number;
}

export interface KnowledgePodcastTtsDiagnostic {
  at: ISODateTime;
  unitId?: EntityId;
  unitTitle?: string;
  partCurrent?: number;
  partTotal?: number;
  attempt?: number;
  httpStatus?: number;
  requestId?: string;
  message: string;
}

export interface KnowledgePodcastScriptDiagnostic {
  providerName: string;
  model: string;
  finishReason?: string;
  usage?: AiCompletionUsage;
  requestId?: string;
  attempts: number;
}

export interface KnowledgePodcast extends BaseEntity {
  title: string;
  mode: KnowledgePodcastMode;
  customMode?: KnowledgePodcastCustomModeSnapshot;
  /** Structured episode-specific direction, independent from the reusable mode. */
  creativeBrief?: KnowledgePodcastCreativeBrief;
  /** One-off direction for this episode, independent from the global mode. */
  focusInstruction?: string;
  targetMinutes: 3 | 5 | 10;
  speechCharacterCount?: number;
  estimatedDurationSeconds?: number;
  durationTargetDeviation?: number;
  scope: AiKnowledgeScope;
  sourceRecordIds: EntityId[];
  contextHash: string;
  scriptStatus: "idle" | "generating" | "ready" | "failed";
  audioStatus: "idle" | "generating" | "partial" | "ready" | "failed";
  opening?: string;
  segments: KnowledgePodcastSegment[];
  closing?: string;
  /** Version 2 stores opening, chapters and closing as independent audio units. */
  audioLayoutVersion?: 2;
  audioUnits?: KnowledgePodcastAudioUnit[];
  /** Generated assets superseded by a script or audio layout change, removed after a complete replacement succeeds. */
  pendingAudioCleanupAssetIds?: EntityId[];
  lastError?: string;
  generation?: KnowledgePodcastGenerationProgress;
  scriptDiagnostic?: KnowledgePodcastScriptDiagnostic;
  ttsDiagnostics?: KnowledgePodcastTtsDiagnostic[];
  playback?: { unitId?: EntityId; segmentId?: EntityId; positionSeconds: number };
  ttsConfig: {
    providerId: TtsProviderId;
    model: string;
    voiceId: string;
    format: "mp3";
    /** Tencent Cloud requires a signing region (e.g. ap-guangzhou). */
    region?: string;
    /** Google Cloud TTS voices are scoped to a BCP-47 language code (e.g. cmn-CN). */
    languageCode?: string;
  };
}

export interface AiChatMessage extends BaseEntity {
  sessionId: EntityId;
  role: "user" | "assistant" | "system";
  content: string;
  attachmentIds?: EntityId[];
  error?: string;
}

export interface AiChatAttachment extends BaseEntity {
  sessionId: EntityId;
  messageId?: EntityId;
  fileName: string;
  mimeType: string;
  size: number;
  data: Blob;
  ocrStatus?: "idle" | "queued" | "running" | "done" | "failed" | "timeout";
  ocrText?: string;
  ocrError?: string;
  ocrJobId?: string;
  ocrUpdatedAt?: ISODateTime;
  sentMode?: "vision" | "local-ocr-markdown";
}

export interface Asset extends BaseEntity {
  fileName: string;
  title?: string;
  mimeType: string;
  size: number;
  kind: "image" | "attachment" | "audio";
  generatedBy?: "knowledge-podcast";
  generatedForPodcastId?: EntityId;
  generatedForAudioUnitId?: EntityId;
  data: Blob;
  durationSeconds?: number;
  ocrStatus?: "idle" | "queued" | "running" | "done" | "failed" | "timeout";
  ocrText?: string;
  ocrError?: string;
  ocrJobId?: string;
  ocrUpdatedAt?: ISODateTime;
  ocrResultSummary?: {
    textLength: number;
    includedInAi: boolean;
    parserVersion: string;
  };
}

export type AiKnowledgeScope =
  | { kind: "date"; date: ISODate }
  | { kind: "tag"; subject: Subject; tag: string }
  | { kind: "recent"; days: 7 | 14 | 30 }
  | { kind: "records"; recordIds: EntityId[] };

export interface RecordTransferManifest {
  format: "study-journal-record-transfer";
  version: 1;
  exportedAt: ISODateTime;
  appVersion: string;
  counts: {
    records: number;
    assets: number;
  };
}

export interface RecordTransferPayload {
  manifest: RecordTransferManifest;
  records: RecordBlock[];
  subjects: Subject[];
  assets: Array<Omit<Asset, "data"> & { path: string }>;
}

export interface RecordTransferPackage {
  payload: RecordTransferPayload;
  /** Reads one validated resource on demand without retaining every Blob. */
  readAsset: (id: EntityId, signal?: AbortSignal) => Promise<File>;
}

export interface RecordTransferSummary {
  records: number;
  assets: number;
  images: number;
  audio: number;
  attachments: number;
  subjects: number;
}

export interface MistakeCard extends BaseEntity {
  title: string;
  subject: Subject;
  chapter?: string;
  source?: string;
  prompt: string;
  promptAssetIds: EntityId[];
  wrongAnswer?: string;
  correctAnswer: string;
  reason?: string;
  reflection?: string;
  tags: string[];
  difficulty: Difficulty;
  mastery: MasteryStatus;
  reviewStage: number;
  nextReviewAt?: ISODate;
  lastReviewedAt?: ISODate;
  linkedEntryDate?: ISODate;
  pinned: boolean;
  favorite: boolean;
}

export interface ReviewSchedule extends BaseEntity {
  mistakeId: EntityId;
  stage: number;
  dueAt: ISODate;
  completedAt?: ISODate;
  result?: ReviewResult;
}

export interface StudySession extends BaseEntity {
  date: ISODate;
  subject: Subject;
  minutes: number;
  note?: string;
  blockId?: EntityId;
}

export type LearningScenario = "general" | "postgraduate-exam";
export type PostgraduateExamStage = "基础" | "强化" | "刷题" | "冲刺";
export type LearningCoachDiagnosisCode =
  | "profile-incomplete"
  | "review-overdue"
  | "review-due"
  | "task-carryover"
  | "subject-gap"
  | "subject-imbalance"
  | "quiz-follow-up"
  | "kp-assessment-needs-review"
  | "kp-linked-review-overdue";

/** Kept in a local-only table so coach preferences never affect cloud settings sync. */
export interface LearningCoachSettings {
  id: "learning-coach";
  scenario: LearningScenario;
  dashboardEnabled: boolean;
  postgraduateExamProfile?: {
    examDate: ISODate;
    weeklyAvailableMinutes: number;
    stages: Partial<Record<"数学" | "政治" | "英语" | "408", PostgraduateExamStage>>;
  };
  updatedAt: ISODateTime;
}

export interface LearningEvidence extends BaseEntity {
  date: ISODate;
  occurredAt: ISODateTime;
  subject?: Subject;
  kind: "task-started" | "task-outcome" | "task-completed" | "task-skipped" | "quiz-answer" | "quiz-assessment-confirmed";
  origin: "local" | "user-confirmed-ai";
  source: { type: "coach-task" | "ai-session" | "record" | "review-log"; id: EntityId };
  target?: { type: "record" | "knowledge-point"; id: EntityId };
  supportingEvidenceRefs?: LearningCoachEvidenceRef[];
  payload: Record<string, unknown>;
}

export type LearningCoachIssueStatus = "new" | "ongoing" | "improved" | "resolved";
export type LearningCoachEvidenceRefType = "record" | "study-session" | "review-state" | "review-log" | "learning-evidence" | "coach-task" | "knowledge-point" | "record-knowledge-point-link";

export interface LearningCoachEvidenceRef {
  type: LearningCoachEvidenceRefType;
  id: EntityId;
}

export interface LearningCoachDiagnosis {
  issueKey?: string;
  code: LearningCoachDiagnosisCode;
  status?: LearningCoachIssueStatus;
  priority: 1 | 2 | 3;
  subject?: Subject;
  recordIds: EntityId[];
  message: string;
  /** Human-readable explanation of the deterministic condition. */
  reason?: string;
  metric?: { current: number; threshold: number; unit: string; direction: "above" | "below" };
  evidenceRefs?: LearningCoachEvidenceRef[];
  firstDetectedAt?: ISODateTime;
  lastEvaluatedAt?: ISODateTime;
  resolvedAt?: ISODateTime;
  lastStatusChangedAt?: ISODateTime;
  lastRelevantInputFingerprint?: string;
  interventionState?: "actionable" | "in-progress" | "awaiting-new-evidence" | "satisfied";
  latestIntervention?: {
    taskId: EntityId;
    interventionKey?: string;
    outcomeEvidenceId?: EntityId;
    outcome?: "completed" | "skipped";
    occurredAt: ISODateTime;
  };
  resolutionEvidenceRefs?: LearningCoachEvidenceRef[];
  statusHistory?: Array<{ status: LearningCoachIssueStatus; occurredAt: ISODateTime; evidenceRefs?: LearningCoachEvidenceRef[] }>;
  deferredUntil?: ISODate;
  deferReason?: LearningCoachSkipReason;
  /** Phase 2 refinement metadata. Record-level diagnoses leave these fields absent. */
  level?: "record" | "knowledge-point";
  knowledgePointId?: EntityId;
  parentIssueKey?: string;
}

/** A user-confirmed directional dependency used only by the Phase 3 decision layer. */
export interface KnowledgeRelation extends BaseEntity {
  fromKnowledgePointId: EntityId;
  toKnowledgePointId: EntityId;
  type: "prerequisite-of";
  status: "confirmed" | "retired";
  sourceRefs: LearningCoachEvidenceRef[];
  origin: "user" | "ai-proposal";
  confirmedAt: ISODateTime;
  retiredAt?: ISODateTime;
  retirementReason?: "user-revoked" | "endpoint-invalid";
}

export interface LearningCoachDecisionFactor {
  issueKey: string;
  knowledgePointId?: EntityId;
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  activeChildIssueCount: number;
  overdueReviewCount: number;
  firstDetectedAt?: ISODateTime;
  interventionState?: LearningCoachDiagnosis["interventionState"];
  hasNewStrongEvidence: boolean;
  hasExecutableTask: boolean;
}

/** Snapshot-scoped recommendation; it is not a diagnosis or an official fact. */
export interface LearningCoachDecision {
  status: "recommended" | "no-action";
  recommendedKnowledgePointId?: EntityId;
  recommendedTaskId?: EntityId;
  priorityRationale: string;
  supportingIssueKeys: string[];
  supportingRelationIds: EntityId[];
  decisionInputsFingerprint: string;
  policyVersion: number;
  evaluatedAt: ISODateTime;
  consideredIssueKeys?: string[];
  factors?: LearningCoachDecisionFactor[];
}

export interface KnowledgeRelationProposal {
  id: EntityId;
  fromKnowledgePointId: EntityId;
  toKnowledgePointId: EntityId;
  type: "prerequisite-of";
  rationale: string;
  sourceRefs: LearningCoachEvidenceRef[];
  decision: "pending" | "accepted" | "rejected" | "stale";
  decidedAt?: ISODateTime;
}

/** A stable, user-confirmed concept. It is never an AI-inferred mastery state. */
export interface KnowledgePoint extends BaseEntity {
  subject: Subject;
  name: string;
  normalizedKey: string;
  aliases: string[];
  definition?: string;
  status: "active" | "merged" | "archived";
  mergedIntoId?: EntityId;
  mergeOperationId?: EntityId;
  mergedAt?: ISODateTime;
  mergeAliasesAdded?: string[];
}

/** Formal provenance between an official Record fact and a confirmed KnowledgePoint. */
export interface RecordKnowledgePointLink extends BaseEntity {
  recordId: EntityId;
  knowledgePointId: EntityId;
  role: "primary" | "supporting";
  sourceQuote?: string;
  recordFingerprint: string;
  confirmationSource: "manual" | "ai-proposal";
  confirmedAt: ISODateTime;
  status: "active" | "removed" | "superseded";
  removedAt?: ISODateTime;
  removalReason?: "user-unlinked" | "knowledge-point-merge" | "merge-undone";
  supersededByLinkId?: EntityId;
  mergeOperationId?: EntityId;
}

export interface KnowledgePointProposal {
  id: EntityId;
  name: string;
  normalizedKey: string;
  definition?: string;
  sourceQuote: string;
  suggestedExistingKnowledgePointId?: EntityId;
  decision: "pending" | "accepted" | "rejected" | "stale";
  decidedAt?: ISODateTime;
  createdKnowledgePointId?: EntityId;
  createdLinkId?: EntityId;
}

/** A user-triggered, single-Record AI extraction run. Proposals are not formal data. */
export interface KnowledgePointExtractionRun extends BaseEntity {
  recordId: EntityId;
  subject: Subject;
  inputFingerprint: string;
  catalogFingerprint: string;
  status: "running" | "succeeded" | "failed" | "stale";
  phase?: "preparing-context" | "calling-provider" | "validating-result";
  requestedAt: ISODateTime;
  completedAt?: ISODateTime;
  proposals: KnowledgePointProposal[];
  error?: string;
}

export interface KnowledgePointDerivedState {
  knowledgePointId: EntityId;
  subject: Subject;
  linkedRecordIds: EntityId[];
  latestCoveredDate?: ISODate;
  dueReviewRecordIds: EntityId[];
  overdueReviewRecordIds: EntityId[];
  latestAssessment?: {
    outcome: "needs-review" | "satisfactory";
    evidenceId: EntityId;
    occurredAt: ISODateTime;
  };
  latestInterventionTaskId?: EntityId;
  latestInterventionEvidenceId?: EntityId;
}

/** Traceable derived projection; never an official fact or stored mastery score. */
export interface KnowledgePointCoachSnapshot extends BaseEntity {
  date: ISODate;
  inputFingerprint: string;
  evaluatedAt: ISODateTime;
  states: KnowledgePointDerivedState[];
  diagnoses: LearningCoachDiagnosis[];
  taskIds: EntityId[];
  previousSnapshotId?: EntityId;
}

export interface LearningCoachSubjectState {
  subject: Subject;
  lastActivityDate?: ISODate;
  recordCountLast7Days: number;
  studyMinutesLast7Days: number;
  dueReviewCount: number;
  overdueReviewCount: number;
  latestConfirmedQuizOutcome?: "needs-review" | "satisfactory";
}

export type LearningCoachTaskActionType = "review-queue" | "ai-quiz" | "create-record";
export type LearningCoachSkipReason = "no-time" | "too-large" | "not-relevant" | "other";

export interface LearningCoachTaskAction {
  type: LearningCoachTaskActionType;
  subject?: Subject;
  recordIds: EntityId[];
  createdRecordId?: EntityId;
  knowledgePointId?: EntityId;
}

export interface LearningCoachCompletionPolicy {
  type: "review-logs" | "confirmed-quiz" | "meaningful-record" | "meaningful-record-with-knowledge-point-link";
  targetRecordIds?: EntityId[];
  knowledgePointId?: EntityId;
}

export interface LearningCoachLocalSummary {
  dueReviews: number;
  overdueReviews: number;
  pendingTasks: number;
  studyMinutesLast7Days: number;
  recordCountLast7Days: number;
  examDaysRemaining?: number;
}

export interface LearningCoachTaskCandidate {
  issueKey?: string;
  subject?: Subject;
  kind: "review" | "revisit-record" | "practice";
  title: string;
  recordIds: EntityId[];
  reason: string;
  actionLabel?: string;
  action?: LearningCoachTaskAction;
}

export interface LearningCoachSnapshot extends BaseEntity {
  date: ISODate;
  scenario: LearningScenario;
  inputFingerprint: string;
  localSummary: LearningCoachLocalSummary;
  diagnoses: LearningCoachDiagnosis[];
  taskIds: EntityId[];
  evaluatedAt?: ISODateTime;
  previousSnapshotId?: EntityId;
  subjectStates?: LearningCoachSubjectState[];
  changes?: Record<LearningCoachIssueStatus, string[]>;
  aiRunIds?: EntityId[];
  aiAnalysis?: {
    status: "idle" | "success" | "failed";
    inputFingerprint: string;
    generatedAt?: ISODateTime;
    content?: string;
    candidateTasks?: LearningCoachTaskCandidate[];
    error?: string;
  };
  decision?: LearningCoachDecision;
}

export interface LearningCoachTask extends BaseEntity {
  snapshotId: EntityId;
  date: ISODate;
  subject?: Subject;
  kind: "review" | "revisit-record" | "practice";
  source: "rule" | "ai-proposal";
  proposalStatus?: "proposed" | "accepted" | "rejected";
  status: "pending" | "in-progress" | "completed" | "skipped" | "cancelled";
  priority: 1 | 2 | 3;
  reasonCode: LearningCoachDiagnosisCode;
  title: string;
  recordIds: EntityId[];
  /** Explicit action and evidence explanation shown before the user starts. */
  actionLabel?: string;
  reason?: string;
  completedEvidenceId?: EntityId;
  skippedEvidenceId?: EntityId;
  issueKey?: string;
  action?: LearningCoachTaskAction;
  completionPolicy?: LearningCoachCompletionPolicy;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  skippedAt?: ISODateTime;
  cancelledAt?: ISODateTime;
  progress?: { current: number; total: number };
  completionEvidenceIds?: EntityId[];
  skipReason?: LearningCoachSkipReason;
  skipNote?: string;
  deferredUntil?: ISODate;
  /** Unique while this task is pending/in-progress; absent for terminal tasks. */
  activeSlotKey?: string;
  interventionKey?: string;
  replanKey?: string;
  parentTaskId?: EntityId;
  cancellationReason?: "issue-resolved" | "duplicate-active-task" | "superseded-replan";
  duplicateOfTaskId?: EntityId;
  cleanedAt?: ISODateTime;
  cleanupVersion?: number;
  completionEvidenceRefs?: LearningCoachEvidenceRef[];
  scope?: "record" | "knowledge-point";
  knowledgePointId?: EntityId;
  parentIssueKey?: string;
}

export interface LearningCoachAiRun extends BaseEntity {
  date: ISODate;
  snapshotId: EntityId;
  inputFingerprint: string;
  issueKeys: string[];
  status: "queued" | "running" | "succeeded" | "failed" | "stale";
  phase?: "preparing-context" | "calling-provider" | "validating-result";
  sourceRecords: Array<{ recordId: EntityId; subject: Subject; date: ISODate; title: string; sourceLabel: string }>;
  requestedAt: ISODateTime;
  completedAt?: ISODateTime;
  analysis?: string;
  candidateTasks?: LearningCoachTaskCandidate[];
  relationProposals?: KnowledgeRelationProposal[];
  error?: string;
}

export interface AppSettings {
  id: "settings";
  examDate: ISODate;
  theme: "system" | "light" | "dark";
  accentColor: string;
  backupReminderDays: number;
  lastBackupAt?: ISODateTime;
  syncFolderName?: string;
  fontScale: number;
  lineHeight: number;
  subjects?: SubjectConfig[];
  ai?: AiProviderConfig;
  tts?: TtsProviderConfig;
  knowledgePodcastModeTemplates?: KnowledgePodcastModeTemplate[];
  schemaVersion?: 1 | 2 | 3 | 4 | 5;
}

export interface BackupManifest {
  format: "408-study-journal" | "study-journal";
  version: 1 | 2 | 3 | 4 | 5;
  exportedAt: ISODateTime;
  appVersion: string;
  counts: {
    entries: number;
    blocks: number;
    mistakes: number;
    assets: number;
    tags: number;
    reviews: number;
    studySessions: number;
    recordReviews?: number;
    recordReviewLogs?: number;
    recordReviewDayStats?: number;
    templates?: number;
  };
}

export interface BackupPayload {
  manifest: BackupManifest;
  entries: DayEntry[];
  blocks: Block[];
  templates?: ContentTemplate[];
  recordDrafts?: RecordDraft[];
  mistakes: MistakeCard[];
  tags: Tag[];
  reviews: ReviewSchedule[];
  recordReviews?: RecordReviewState[];
  recordReviewLogs?: RecordReviewLog[];
  recordReviewDayStats?: RecordReviewDayStat[];
  studySessions: StudySession[];
  settings: AppSettings;
  podcasts?: KnowledgePodcast[];
  /** Local-only learning coach data. Full backups include it; cloud snapshots do not. */
  learningCoachSettings?: LearningCoachSettings;
  learningEvidence?: LearningEvidence[];
  learningCoachSnapshots?: LearningCoachSnapshot[];
  learningCoachTasks?: LearningCoachTask[];
  learningCoachAiRuns?: LearningCoachAiRun[];
  knowledgePoints?: KnowledgePoint[];
  recordKnowledgePointLinks?: RecordKnowledgePointLink[];
  knowledgePointExtractionRuns?: KnowledgePointExtractionRun[];
  knowledgePointCoachSnapshots?: KnowledgePointCoachSnapshot[];
  knowledgeRelations?: KnowledgeRelation[];
}

export interface SearchResult {
  id: EntityId;
  type: "entry" | "block";
  title: string;
  excerpt: string;
  date?: ISODate;
  tags: string[];
  recordId?: EntityId;
  assetId?: EntityId;
  matchSource?: "content" | "assetMeta" | "assetOcr" | "entry";
}

export interface StorageSnapshot {
  payload: BackupPayload;
  assets: Asset[];
  recordDrafts?: RecordDraft[];
}

export type CloudSyncEntityType =
  | "entry"
  | "block"
  | "template"
  | "draft"
  | "tag"
  | "study-session"
  | "settings"
  | "asset"
  | "review-state"
  | "review-day-stat";

/** Local-only cursor and device identity for the incremental cloud protocol. */
export interface CloudSyncStateRecord {
  id: "state";
  deviceId: string;
  userId?: string;
  lastPulledRevision: number;
  lastReviewEventRevision: number;
  lastSyncedAt?: ISODateTime;
  /** Monotonic local write epoch used to prevent a remote restore overwriting a newer edit. */
  mutationEpoch?: number;
  /** The revision through which the local ledger represents the complete remote key set. */
  remoteDatasetCompleteThroughRevision?: number;
  /** Last time background recovery-snapshot maintenance completed successfully. */
  lastSnapshotMaintenanceAt?: ISODateTime;
  /** Most recent non-blocking recovery-snapshot maintenance failure, shown in cloud sync settings. */
  lastSnapshotMaintenanceError?: string;
  /** When the current recovery-snapshot maintenance failure was recorded. */
  lastSnapshotMaintenanceFailedAt?: ISODateTime;
  /** Last automatic recovery-snapshot maintenance outcome. */
  lastSnapshotMaintenanceStatus?: "completed" | "deferred-cost" | "failed";
  /** When automatic maintenance was deferred because the account was too large. */
  lastSnapshotMaintenanceDeferredAt?: ISODateTime;
}

/** Local-only knowledge of the last cloud version of one synchronized entity. */
export interface CloudSyncLedgerRecord {
  id: string;
  entityType: CloudSyncEntityType | "review-event";
  entityId: string;
  contentHash: string;
  /** Hash format used for this ledger row. Older rows omit this field. */
  contentHashVersion?: number;
  /** Algorithm used for contentHash. Older rows infer this from the hash prefix. */
  contentHashAlgorithm?: "sha256" | "fnv1a";
  cloudRevision: number;
  assetHash?: string;
  /** Last common payload for small entities that support three-way field merging. */
  basePayload?: Record<string, unknown>;
}

export type CloudSyncOperationStatus = "pending" | "succeeded" | "failed" | "unknown" | "superseded";
export type CloudSyncOperationPhase = "acquiring" | "uploading" | "committing" | "releasing" | "reconciling";

export interface CloudSyncExpectedValue {
  key: string;
  contentHash: string;
}

/** Durable context for a publish whose network result may be unknown after a timeout. */
export interface CloudSyncOperationRecord {
  id: string;
  operationId: string;
  userId: string;
  deviceId: string;
  revision: number;
  previousHeadRevision: number;
  expectedEntities: CloudSyncExpectedValue[];
  expectedEvents: CloudSyncExpectedValue[];
  phase: CloudSyncOperationPhase;
  status: CloudSyncOperationStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  errorMessage?: string;
  /** A later visible revision safely replaced an operation whose final response was lost. */
  supersededByRevision?: number;
  reconciliationReason?: string;
  reconciledAt?: ISODateTime;
  /** Last error encountered while releasing or recovering the operation lock. */
  lockReleaseError?: string;
  lockReleaseErrorAt?: ISODateTime;
  lockReleaseAttempts?: number;
}

export interface CloudSyncMutationRecord {
  id: "local";
  epoch: number;
}

export type BackupAssetMeta = Omit<Asset, "data">;

export interface StreamableBackupSnapshot {
  payload: BackupPayload;
  assets: BackupAssetMeta[];
  recordDrafts?: RecordDraft[];
}

export type StreamedAssetReader = (
  asset: BackupAssetMeta,
  index: number,
  total: number,
) => Promise<Asset | undefined>;

export interface ImportSummary {
  records: number;
  days: number;
  deletedRecords: number;
  assets: number;
  images: number;
  audio: number;
  attachments: number;
  version: BackupManifest["version"];
  missingAssets: number;
}

export interface ImportProgress {
  stage: ImportProgressStage;
  message: string;
  current?: number;
  total?: number;
}

export interface ImportOptions {
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

export interface ExportProgress {
  stage: ExportProgressStage;
  message: string;
  current?: number;
  total?: number;
}

export interface ExportOptions {
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface StreamingExportOptions extends ExportOptions {}

export interface StreamingImportOptions extends ImportOptions {}

export interface KnowledgeRecord {
  id: EntityId;
  date: ISODate;
  subject: Subject;
  title: string;
  tags: string[];
  contentText: string;
  contentMarkdown: string;
  formulas: string[];
  assetTexts: string[];
  ocrTexts: string[];
  updatedAt: ISODateTime;
}

export interface KnowledgeExportPayload {
  format: "408-study-journal-knowledge" | "study-journal-knowledge";
  version: 1;
  exportedAt: ISODateTime;
  records: KnowledgeRecord[];
}

export interface StorageAdapter {
  initialize(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  getAutoBackupState(): Promise<AutoBackupSettings>;
  saveAutoBackupState(state: AutoBackupSettings): Promise<void>;
  saveSubjects(subjects: SubjectConfig[]): Promise<void>;
  renameSubject(oldName: Subject, newName: Subject): Promise<void>;
  getOrCreateEntry(date: ISODate): Promise<DayEntry>;
  listEntries(): Promise<DayEntry[]>;
  saveEntry(entry: DayEntry): Promise<DayEntry>;
  listBlocks(date?: ISODate): Promise<Block[]>;
  saveBlock(block: Block): Promise<Block>;
  listTemplates(): Promise<ContentTemplate[]>;
  saveTemplate(template: ContentTemplate): Promise<ContentTemplate>;
  deleteTemplate(templateId: EntityId): Promise<void>;
  getRecordDraft(recordId: EntityId): Promise<RecordDraft | undefined>;
  listRecordDrafts(): Promise<RecordDraft[]>;
  saveRecordDraft(draft: RecordDraft): Promise<RecordDraft>;
  deleteRecordDraft(recordId: EntityId): Promise<void>;
  listRecordReviews(): Promise<RecordReviewState[]>;
  getRecordReview(recordId: EntityId): Promise<RecordReviewState | undefined>;
  listDueRecordReviews(date: ISODate): Promise<RecordReviewState[]>;
  addRecordToReview(recordId: EntityId, kind?: RecordReviewKind): Promise<RecordReviewState | undefined>;
  addRecordsToReview(recordIds: EntityId[], kind?: RecordReviewKind): Promise<RecordReviewBulkResult>;
  setRecordReviewKind(recordId: EntityId, kind: RecordReviewKind): Promise<RecordReviewState | undefined>;
  rateRecordReview(recordId: EntityId, rating: RecordReviewRating, reviewedAt?: ISODateTime, evaluationText?: string): Promise<RecordReviewRateResult | undefined>;
  undoRecordReview(token: RecordReviewUndoToken): Promise<RecordReviewState | undefined>;
  resetRecordReview(recordId: EntityId): Promise<RecordReviewState | undefined>;
  removeRecordFromReview(recordId: EntityId): Promise<RecordReviewState | undefined>;
  listRecordReviewLogs(recordId?: EntityId): Promise<RecordReviewLog[]>;
  getRecordReviewStats(date?: ISODate): Promise<RecordReviewStats>;
  ensureRecordReviewDay(date: ISODate, dueCountAtFirstOpen: number): Promise<RecordReviewDayStat>;
  deleteBlock(blockId: EntityId): Promise<void>;
  listDeletedBlocks(): Promise<RecordBlock[]>;
  restoreBlock(blockId: EntityId): Promise<RecordBlock | undefined>;
  permanentlyDeleteBlock(blockId: EntityId): Promise<void>;
  purgeExpiredDeletedBlocks(retentionDays: number): Promise<number>;
  toggleRecordFavorite(blockId: EntityId, favorite: boolean): Promise<RecordBlock | undefined>;
  reorderBlocks(date: ISODate, blockIds: EntityId[]): Promise<void>;
  listMistakes(): Promise<MistakeCard[]>;
  saveMistake(mistake: MistakeCard): Promise<MistakeCard>;
  listDueMistakes(date: ISODate): Promise<MistakeCard[]>;
  listReviews(mistakeId?: EntityId): Promise<ReviewSchedule[]>;
  saveReview(review: ReviewSchedule): Promise<ReviewSchedule>;
  listTags(): Promise<Tag[]>;
  upsertTag(name: string): Promise<Tag>;
  listStudySessions(): Promise<StudySession[]>;
  saveStudySession(session: StudySession): Promise<StudySession>;
  getLearningCoachSettings(): Promise<LearningCoachSettings>;
  saveLearningCoachSettings(settings: LearningCoachSettings): Promise<LearningCoachSettings>;
  listLearningEvidence(): Promise<LearningEvidence[]>;
  saveLearningEvidence(evidence: LearningEvidence): Promise<LearningEvidence>;
  listLearningCoachSnapshots(): Promise<LearningCoachSnapshot[]>;
  getLearningCoachSnapshot(date: ISODate): Promise<LearningCoachSnapshot | undefined>;
  saveLearningCoachSnapshot(snapshot: LearningCoachSnapshot): Promise<LearningCoachSnapshot>;
  listLearningCoachTasks(): Promise<LearningCoachTask[]>;
  saveLearningCoachTask(task: LearningCoachTask): Promise<LearningCoachTask>;
  updateLearningCoachTaskStatus(taskId: EntityId, status: LearningCoachTask["status"]): Promise<LearningCoachTask | undefined>;
  completeLearningCoachTask(taskId: EntityId, status: "completed" | "skipped", evidence: LearningEvidence): Promise<LearningCoachTask | undefined>;
  listLearningCoachAiRuns(): Promise<LearningCoachAiRun[]>;
  saveLearningCoachAiRun(run: LearningCoachAiRun): Promise<LearningCoachAiRun>;
  listKnowledgePoints(): Promise<KnowledgePoint[]>;
  listRecordKnowledgePointLinks(recordId?: EntityId): Promise<RecordKnowledgePointLink[]>;
  createKnowledgePointLink(input: { recordId: EntityId; subject: Subject; name: string; definition?: string; role?: RecordKnowledgePointLink["role"]; sourceQuote?: string; confirmationSource: RecordKnowledgePointLink["confirmationSource"]; existingKnowledgePointId?: EntityId }): Promise<{ knowledgePoint: KnowledgePoint; link: RecordKnowledgePointLink }>;
  removeRecordKnowledgePointLink(linkId: EntityId): Promise<RecordKnowledgePointLink | undefined>;
  mergeKnowledgePoints(sourceId: EntityId, targetId: EntityId): Promise<KnowledgePoint | undefined>;
  undoKnowledgePointMerge(sourceId: EntityId): Promise<KnowledgePoint | undefined>;
  listKnowledgePointExtractionRuns(recordId?: EntityId): Promise<KnowledgePointExtractionRun[]>;
  saveKnowledgePointExtractionRun(run: KnowledgePointExtractionRun): Promise<KnowledgePointExtractionRun>;
  decideKnowledgePointProposal(runId: EntityId, proposalId: EntityId, decision: "accepted" | "rejected", existingKnowledgePointId?: EntityId): Promise<KnowledgePointExtractionRun | undefined>;
  listKnowledgePointCoachSnapshots(): Promise<KnowledgePointCoachSnapshot[]>;
  getKnowledgePointCoachSnapshot(date: ISODate): Promise<KnowledgePointCoachSnapshot | undefined>;
  saveKnowledgePointCoachSnapshot(snapshot: KnowledgePointCoachSnapshot): Promise<KnowledgePointCoachSnapshot>;
  listKnowledgeRelations(): Promise<KnowledgeRelation[]>;
  saveKnowledgeRelation(relation: KnowledgeRelation): Promise<KnowledgeRelation>;
  retireKnowledgeRelation(relationId: EntityId): Promise<KnowledgeRelation | undefined>;
  decideKnowledgeRelationProposal(runId: EntityId, proposalId: EntityId, decision: "accepted" | "rejected"): Promise<LearningCoachAiRun | undefined>;
  saveAsset(file: File, kind: Asset["kind"], title?: string): Promise<Asset>;
  patchAsset(
    id: EntityId,
    patch: Partial<Omit<Asset, "id" | "data">>,
    options?: { mutation?: "content" | "operational" },
  ): Promise<Asset | undefined>;
  renameAssetTitle(assetId: EntityId, title: string): Promise<void>;
  resetStaleOcrJobs?(maxAgeMs: number): Promise<void>;
  listAssets(): Promise<Asset[]>;
  getAsset(id: EntityId): Promise<Asset | undefined>;
  deleteAsset?(id: EntityId): Promise<void>;
  stageRecordTransferAsset(sessionId: string, asset: Asset): Promise<void>;
  commitRecordTransfer(sessionId: string, records: RecordBlock[]): Promise<RecordTransferSummary>;
  discardRecordTransfer(sessionId: string): Promise<void>;
  createSnapshot(): Promise<StorageSnapshot>;
  createCloudSyncSnapshot(): Promise<StorageSnapshot>;
  getCloudSyncMutationEpoch(): Promise<number>;
  createStreamableSnapshot(): Promise<StreamableBackupSnapshot>;
  restoreSnapshot(snapshot: StorageSnapshot): Promise<void>;
  restoreCloudSyncSnapshot(snapshot: StorageSnapshot): Promise<void>;
  restoreCloudSyncSnapshotIfUnchanged(snapshot: StorageSnapshot, expectedEpoch: number): Promise<void>;
  restoreStreamableSnapshot(
    snapshot: StreamableBackupSnapshot,
    readAsset: StreamedAssetReader,
    options?: StreamingImportOptions,
  ): Promise<void>;
  clearAll(): Promise<void>;
  listKnowledgePodcasts?(): Promise<KnowledgePodcast[]>;
  getKnowledgePodcast?(id: EntityId): Promise<KnowledgePodcast | undefined>;
  saveKnowledgePodcast?(podcast: KnowledgePodcast): Promise<KnowledgePodcast>;
  deleteKnowledgePodcast?(id: EntityId): Promise<void>;
  recoverInterruptedKnowledgePodcastJobs?(activePodcastIds?: Set<EntityId>): Promise<void>;
  listAiSessions?(): Promise<AiChatSession[]>;
  getAiSession?(id: EntityId): Promise<AiChatSession | undefined>;
  saveAiSession?(session: AiChatSession): Promise<AiChatSession>;
  deleteAiSession?(id: EntityId): Promise<void>;
  listAiMessages?(sessionId: EntityId): Promise<AiChatMessage[]>;
  saveAiMessage?(message: AiChatMessage): Promise<AiChatMessage>;
  saveAiAttachment?(attachment: AiChatAttachment): Promise<AiChatAttachment>;
  listAiAttachments?(sessionId: EntityId): Promise<AiChatAttachment[]>;
  getAiAttachment?(id: EntityId): Promise<AiChatAttachment | undefined>;
  deleteAiAttachment?(id: EntityId): Promise<void>;
  deleteAiAttachmentsForSession?(sessionId: EntityId): Promise<void>;
  getAiSecret?(providerId?: EntityId): Promise<AiSecret | undefined>;
  saveAiSecret?(apiKey: string, providerId?: EntityId, apiKeySecondary?: string): Promise<AiSecret>;
  clearAiSecret?(providerId?: EntityId): Promise<void>;
}

export interface SyncAdapter {
  readonly kind: "manual-zip" | "file-system-folder";
  isAvailable(): boolean;
  exportSnapshot(snapshot: StorageSnapshot, options?: ExportOptions): Promise<void>;
  importSnapshot?(options?: ImportOptions): Promise<StorageSnapshot | undefined>;
  importAndRestoreSnapshot?(
    store: StorageAdapter,
    options?: StreamingImportOptions,
  ): Promise<ImportSummary | undefined>;
}
