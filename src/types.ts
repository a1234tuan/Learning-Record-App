export type EntityId = string;
export type ISODate = string;
export type ISODateTime = string;

export type Subject = string;
export type MasteryStatus = "待复习" | "复习中" | "已掌握";
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type ReviewResult = "remembered" | "forgot";
export type ExportKind = "full-backup" | "subject-markdown" | "knowledge-json" | "plain-text";

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
  favorite?: boolean;
}

export interface RecordDraft {
  id: EntityId;
  recordId: EntityId;
  baseUpdatedAt: ISODateTime;
  draft: RecordBlock;
  updatedAt: ISODateTime;
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
  lastBackupAt?: ISODateTime;
  lastBackupSize?: number;
  lastError?: string;
  debounceMs: number;
}

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
  title: string;
  kind: "text" | "formula" | "imageOcr";
  content: string;
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
  attachment?: AiContextPack;
  memorySummary?: string;
  lastContextHash?: string;
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
  autoBackup?: AutoBackupSettings;
  ai?: AiProviderConfig;
  schemaVersion?: 1 | 2 | 3;
}

export interface BackupManifest {
  format: "408-study-journal" | "study-journal";
  version: 1 | 2 | 3;
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
  };
}

export interface BackupPayload {
  manifest: BackupManifest;
  entries: DayEntry[];
  blocks: Block[];
  recordDrafts?: RecordDraft[];
  mistakes: MistakeCard[];
  tags: Tag[];
  reviews: ReviewSchedule[];
  studySessions: StudySession[];
  settings: AppSettings;
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

export interface KnowledgeRecord {
  id: EntityId;
  date: ISODate;
  subject: Subject;
  title: string;
  contentText: string;
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
  saveSubjects(subjects: SubjectConfig[]): Promise<void>;
  renameSubject(oldName: Subject, newName: Subject): Promise<void>;
  getOrCreateEntry(date: ISODate): Promise<DayEntry>;
  listEntries(): Promise<DayEntry[]>;
  saveEntry(entry: DayEntry): Promise<DayEntry>;
  listBlocks(date?: ISODate): Promise<Block[]>;
  saveBlock(block: Block): Promise<Block>;
  getRecordDraft(recordId: EntityId): Promise<RecordDraft | undefined>;
  listRecordDrafts(): Promise<RecordDraft[]>;
  saveRecordDraft(draft: RecordDraft): Promise<RecordDraft>;
  deleteRecordDraft(recordId: EntityId): Promise<void>;
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
  saveAsset(file: File, kind: Asset["kind"], title?: string): Promise<Asset>;
  patchAsset(id: EntityId, patch: Partial<Omit<Asset, "id" | "data">>): Promise<Asset | undefined>;
  renameAssetTitle(assetId: EntityId, title: string): Promise<void>;
  resetStaleOcrJobs?(maxAgeMs: number): Promise<void>;
  listAssets(): Promise<Asset[]>;
  getAsset(id: EntityId): Promise<Asset | undefined>;
  createSnapshot(): Promise<StorageSnapshot>;
  restoreSnapshot(snapshot: StorageSnapshot): Promise<void>;
  clearAll(): Promise<void>;
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
  saveAiSecret?(apiKey: string, providerId?: EntityId): Promise<AiSecret>;
  clearAiSecret?(providerId?: EntityId): Promise<void>;
}

export interface SyncAdapter {
  readonly kind: "manual-zip" | "file-system-folder";
  isAvailable(): boolean;
  exportSnapshot(snapshot: StorageSnapshot): Promise<void>;
  importSnapshot?(): Promise<StorageSnapshot | undefined>;
}
