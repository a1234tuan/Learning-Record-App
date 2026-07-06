import Dexie, { liveQuery } from "dexie";

import type {
  AiChatAttachment,
  AiChatMessage,
  AiChatSession,
  AiSecret,
  AppSettings,
  Asset,
  BackupAssetMeta,
  Block,
  DayEntry,
  MistakeCard,
  RecordDraft,
  RecordBlock,
  RecordReviewBulkResult,
  RecordReviewDayStat,
  RecordReviewLog,
  RecordReviewKind,
  RecordReviewRating,
  RecordReviewState,
  RecordReviewStats,
  ReviewSchedule,
  StorageAdapter,
  StorageSnapshot,
  StreamableBackupSnapshot,
  StreamedAssetReader,
  StreamingImportOptions,
  Subject,
  SubjectConfig,
  StudySession,
  Tag,
} from "../types";
import { db } from "../db/database";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TAGS,
  createDayEntry,
  isCodeBiasedDefaultAiPresetSet,
  isCurrentDefaultAiPresetSetWithoutModes,
  isLegacyDefaultAiPresetSet,
} from "../db/defaults";
import { addDaysISO, isoDateTimeToLocalDate, nowISO, todayISO } from "../lib/date";
import { createBaseEntity, touch } from "../lib/entity";
import { migrateBlocksToRecords } from "../lib/recordMigration";
import { hasLinearRecordNodes, renameRecordAssetTitle, syncRecordRefsFromContent } from "../lib/recordContent";
import { ensureSettingsSubjects, normalizeSubjectName } from "../lib/subjects";
import { normalizeAiConfig } from "../lib/aiProviders";
import {
  DEFAULT_REVIEW_EASE,
  DEFAULT_REVIEW_KIND,
  FSRS_REVIEW_SCHEDULER,
  OVERVIEW_REVIEW_SCHEDULER,
  applyRecordReview,
  createInitialFsrsCard,
  isReviewDueOn,
  normalizeLegacyRating,
  schedulerForKind,
} from "../lib/reviewScheduler";

const assetToMeta = (asset: Asset): BackupAssetMeta => {
  const { data: _data, ...meta } = asset;
  return meta;
};

const isSuccessfulRecordReviewRating = (rating: RecordReviewRating): boolean => {
  const normalized = normalizeLegacyRating(rating);
  return normalized === "good" || normalized === "easy";
};

const adjustCount = (value: number | undefined, delta: number): number =>
  Math.max(0, (value ?? 0) + delta);

const updateDayStatForRatingCorrection = (
  stat: RecordReviewDayStat,
  previousRating: RecordReviewRating,
  nextRating: RecordReviewRating,
): RecordReviewDayStat => {
  const previous = normalizeLegacyRating(previousRating);
  const next = normalizeLegacyRating(nextRating);
  const rememberedDelta = (isSuccessfulRecordReviewRating(next) ? 1 : 0) - (isSuccessfulRecordReviewRating(previous) ? 1 : 0);
  return {
    ...stat,
    rememberedCount: adjustCount(stat.rememberedCount, rememberedDelta),
    fuzzyCount: adjustCount(stat.fuzzyCount, (next === "fuzzy" ? 1 : 0) - (previous === "fuzzy" ? 1 : 0)),
    forgotCount: adjustCount(stat.forgotCount, (next === "forgot" ? 1 : 0) - (previous === "forgot" ? 1 : 0)),
    goodCount: adjustCount(stat.goodCount, (next === "good" ? 1 : 0) - (previous === "good" ? 1 : 0)),
    easyCount: adjustCount(stat.easyCount, (next === "easy" ? 1 : 0) - (previous === "easy" ? 1 : 0)),
    updatedAt: nowISO(),
  };
};

const reviewStateBeforeLog = (current: RecordReviewState, log: RecordReviewLog): RecordReviewState => {
  const previousRating = normalizeLegacyRating(log.normalizedRating ?? log.rating);
  const previousConsecutiveRemembered = log.previousConsecutiveRemembered ??
    (isSuccessfulRecordReviewRating(previousRating)
      ? Math.max(0, current.consecutiveRemembered - 1)
      : current.consecutiveRemembered);
  return {
    ...current,
    easeFactor: log.previousEaseFactor,
    repetition: log.previousRepetition,
    intervalDays: log.previousIntervalDays,
    nextReviewDate: log.previousNextReviewDate,
    lastReviewDate: log.previousLastReviewDate,
    lastReviewedAt: log.previousLastReviewedAt,
    consecutiveRemembered: previousConsecutiveRemembered,
    totalReviews: log.previousTotalReviews ?? Math.max(0, current.totalReviews - 1),
    fsrsCard: log.previousFsrsCard,
  };
};

export class DexieStorageAdapter implements StorageAdapter {
  async initialize(): Promise<void> {
    await db.open();
    const settings = await db.settings.get("settings");
    if (!settings) {
      await db.settings.put(DEFAULT_SETTINGS);
    }

    for (const tagName of DEFAULT_TAGS) {
      await this.upsertTag(tagName);
    }

    await this.migrateLegacyBlocks();
    await this.migrateRecordsToLinearContent();
    await this.migrateSettingsToDynamicSubjects();
    await this.migrateAiSettings();
    await this.purgeMistakeAndReviewData();
    await this.migrateRecordReviewsToMixedSystem();
    await this.resetStaleOcrJobs(10 * 60 * 1000);
    await this.getOrCreateEntry(todayISO());
  }

  private async recordBlocks(): Promise<RecordBlock[]> {
    return (await db.blocks.toArray()).filter((block): block is RecordBlock => block.type === "record");
  }

  private async activeRecord(recordId: string): Promise<RecordBlock | undefined> {
    const block = await db.blocks.get(recordId);
    return block?.type === "record" && !block.deletedAt ? block : undefined;
  }

  private reviewStateForNewCycle(recordId: string, existing?: RecordReviewState, kind: RecordReviewKind = DEFAULT_REVIEW_KIND): RecordReviewState {
    const now = nowISO();
    const nextReviewDate = addDaysISO(todayISO(), 1);
    return {
      ...(existing ?? createBaseEntity()),
      id: recordId,
      recordId,
      status: "active",
      reviewKind: kind,
      scheduler: schedulerForKind(kind),
      easeFactor: DEFAULT_REVIEW_EASE,
      repetition: 0,
      intervalDays: 1,
      nextReviewDate,
      lastReviewDate: existing?.lastReviewDate,
      lastReviewedAt: existing?.lastReviewedAt,
      consecutiveRemembered: 0,
      totalReviews: existing?.totalReviews ?? 0,
      fsrsCard: kind === "memory" ? createInitialFsrsCard(nextReviewDate) : undefined,
      updatedAt: now,
    };
  }

  private async migrateRecordReviewsToMixedSystem(): Promise<void> {
    const reviews = await db.recordReviews.toArray();
    if (reviews.length === 0) {
      return;
    }

    const logs = await db.recordReviewLogs.toArray();
    const latestLogByRecord = new Map<string, RecordReviewLog>();
    for (const log of logs) {
      const current = latestLogByRecord.get(log.recordId);
      if (!current || current.reviewedAt < log.reviewedAt) {
        latestLogByRecord.set(log.recordId, log);
      }
    }

    const migrated = reviews.map((review) => {
      const reviewKind = review.reviewKind ?? DEFAULT_REVIEW_KIND;
      const scheduler = review.scheduler ?? schedulerForKind(reviewKind);
      const latestLog = latestLogByRecord.get(review.recordId);
      const lastReviewDate = review.lastReviewDate ?? (latestLog ? isoDateTimeToLocalDate(latestLog.reviewedAt) : undefined);
      const fuzzyRepairDate = lastReviewDate ? addDaysISO(lastReviewDate, 21) : undefined;
      const shouldRepairFuzzy =
        review.status === "active" &&
        normalizeLegacyRating(latestLog?.rating ?? "good") === "fuzzy" &&
        Boolean(fuzzyRepairDate) &&
        typeof review.nextReviewDate === "string" &&
        review.nextReviewDate > fuzzyRepairDate!;
      const repairedNextReviewDate = shouldRepairFuzzy && lastReviewDate ? addDaysISO(lastReviewDate, 7) : review.nextReviewDate;
      const nextReviewDate = review.status === "active" && reviewKind === "memory" && !repairedNextReviewDate
        ? addDaysISO(todayISO(), 1)
        : repairedNextReviewDate;
      const intervalDays = shouldRepairFuzzy ? 7 : review.intervalDays;
      const fsrsCard = reviewKind === "memory"
        ? review.fsrsCard ?? (review.status === "active" ? createInitialFsrsCard(nextReviewDate ?? addDaysISO(todayISO(), 1)) : undefined)
        : undefined;

      if (
        review.reviewKind === reviewKind &&
        review.scheduler === scheduler &&
        review.nextReviewDate === nextReviewDate &&
        review.intervalDays === intervalDays &&
        review.fsrsCard === fsrsCard
      ) {
        return review;
      }

      return {
        ...review,
        reviewKind,
        scheduler,
        nextReviewDate,
        intervalDays,
        fsrsCard,
        updatedAt: nowISO(),
      };
    });

    const changed = migrated.some((review, index) => review !== reviews[index]);
    if (changed) {
      await db.recordReviews.bulkPut(migrated);
    }
  }

  private async cleanupOrphanAssetsForRecord(record: RecordBlock, draft?: RecordDraft): Promise<void> {
    const candidateAssetIds = new Set([
      ...record.assets.map((asset) => asset.id),
      ...(draft?.draft.assets.map((asset) => asset.id) ?? []),
    ]);
    if (candidateAssetIds.size === 0) {
      return;
    }

    const blocks = await db.blocks.toArray();
    const drafts = await db.recordDrafts.toArray();
    const stillReferencedAssetIds = new Set<string>();
    for (const block of blocks) {
      if (block.type !== "record" || block.id === record.id) {
        continue;
      }
      for (const asset of block.assets) {
        if (candidateAssetIds.has(asset.id)) {
          stillReferencedAssetIds.add(asset.id);
        }
      }
    }
    for (const otherDraft of drafts) {
      if (otherDraft.recordId === record.id) {
        continue;
      }
      for (const asset of otherDraft.draft.assets) {
        if (candidateAssetIds.has(asset.id)) {
          stillReferencedAssetIds.add(asset.id);
        }
      }
    }

    const orphanIds = Array.from(candidateAssetIds).filter((id) => !stillReferencedAssetIds.has(id));
    if (orphanIds.length > 0) {
      await db.assets.bulkDelete(orphanIds);
    }
  }

  private async migrateSettingsToDynamicSubjects(): Promise<void> {
    const settings = await this.getSettings();
    const records = await this.recordBlocks();
    const migrated = ensureSettingsSubjects(settings, records);
    const oldSubjects = JSON.stringify(settings.subjects ?? []);
    const nextSubjects = JSON.stringify(migrated.subjects ?? []);
    if (settings.schemaVersion !== 3 || oldSubjects !== nextSubjects) {
      await db.settings.put(migrated);
    }
  }

  private async migrateAiSettings(): Promise<void> {
    const settings = await this.getSettings();
    const defaultAi = DEFAULT_SETTINGS.ai;
    if (!defaultAi) {
      return;
    }
    const currentAi = settings.ai;
    const shouldReplacePresets = !currentAi?.presets?.length ||
      isLegacyDefaultAiPresetSet(currentAi.presets) ||
      isCurrentDefaultAiPresetSetWithoutModes(currentAi.presets) ||
      isCodeBiasedDefaultAiPresetSet(currentAi.presets);
    const legacyAi = currentAi as typeof currentAi & { baseUrl?: string; model?: string; providerName?: string };
    const legacyCompatibleAi = legacyAi?.baseUrl === "https://api.deepseek.com/v1" || legacyAi?.model === "deepseek-chat"
      ? {
        ...legacyAi,
        baseUrl: legacyAi.baseUrl === "https://api.deepseek.com/v1" ? "https://api.deepseek.com" : legacyAi.baseUrl,
        model: legacyAi.model === "deepseek-chat" ? "deepseek-v4-pro" : legacyAi.model,
      }
      : legacyAi;
    const nextAi = normalizeAiConfig(
      legacyCompatibleAi,
      shouldReplacePresets ? defaultAi.presets : currentAi?.presets ?? defaultAi.presets,
    );
    if (JSON.stringify(currentAi ?? {}) === JSON.stringify(nextAi)) {
      return;
    }
    await db.settings.put({
      ...settings,
      ai: nextAi,
    });
  }

  private async migrateRecordsToLinearContent(): Promise<void> {
    const blocks = await db.blocks.toArray();
    const migrated = blocks.map((block) => {
      if (block.type !== "record") {
        return block;
      }
      const needsLinearNodes = !hasLinearRecordNodes(block.contentHtml) && (block.assets.length > 0 || block.formulas.length > 0);
      const needsRefSync = hasLinearRecordNodes(block.contentHtml);
      return needsLinearNodes || needsRefSync ? syncRecordRefsFromContent(block) : block;
    });
    const changed = migrated.some((block, index) => block !== blocks[index]);
    if (!changed) {
      return;
    }
    await db.blocks.bulkPut(migrated);
  }

  private async migrateLegacyBlocks(): Promise<void> {
    const settings = await this.getSettings();
    const allBlocks = await db.blocks.toArray();
    const needsMigration = settings.schemaVersion === 1 || allBlocks.some((block) => block.type !== "record");
    if (!needsMigration) {
      return;
    }

    const migratedBlocks = migrateBlocksToRecords(allBlocks);
    await db.transaction("rw", db.blocks, db.settings, async () => {
      await db.blocks.clear();
      await db.blocks.bulkPut(migratedBlocks);
      await db.settings.put({ ...settings, schemaVersion: Math.max(settings.schemaVersion ?? 2, 2) as AppSettings["schemaVersion"] });
    });
  }

  private async purgeMistakeAndReviewData(): Promise<void> {
    const blocks = await db.blocks.toArray();
    const cleanedBlocks = blocks.map((block) =>
      block.type === "record" && (block.mistakeRefs?.length ?? 0) > 0 ? { ...block, mistakeRefs: [] } : block,
    );
    const hasDirtyRecordRefs = cleanedBlocks.some((block, index) => block !== blocks[index]);

    await db.transaction("rw", db.blocks, db.mistakes, db.reviews, async () => {
      await db.mistakes.clear();
      await db.reviews.clear();
      if (hasDirtyRecordRefs) {
        await db.blocks.bulkPut(cleanedBlocks);
      }
    });
  }

  async getSettings(): Promise<AppSettings> {
    return (await db.settings.get("settings")) ?? DEFAULT_SETTINGS;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await db.settings.put(ensureSettingsSubjects(settings, await this.recordBlocks()));
  }

  async saveSubjects(subjects: SubjectConfig[]): Promise<void> {
    const settings = await this.getSettings();
    await this.saveSettings({ ...settings, subjects, schemaVersion: 3 });
  }

  async renameSubject(oldName: Subject, newName: Subject): Promise<void> {
    const normalizedOld = normalizeSubjectName(oldName);
    const normalizedNew = normalizeSubjectName(newName);
    const settings = await this.getSettings();
    const subjects = (settings.subjects ?? []).map((subject) =>
      subject.name === normalizedOld ? { ...subject, name: normalizedNew, updatedAt: nowISO() } : subject,
    );
    const blocks = await db.blocks.toArray();
    const renamedBlocks = blocks.map((block) => {
      if (block.type === "record" && block.subject === normalizedOld) {
        return { ...block, subject: normalizedNew, updatedAt: nowISO() };
      }
      if (block.type === "studySession" && block.subject === normalizedOld) {
        return { ...block, subject: normalizedNew, updatedAt: nowISO() };
      }
      return block;
    });
    const studySessions = await db.studySessions.toArray();
    const renamedStudySessions = studySessions.map((session) =>
      session.subject === normalizedOld ? { ...session, subject: normalizedNew, updatedAt: nowISO() } : session,
    );

    await db.transaction("rw", db.settings, db.blocks, db.studySessions, async () => {
      await db.blocks.bulkPut(renamedBlocks);
      await db.studySessions.bulkPut(renamedStudySessions);
      await db.settings.put(
        ensureSettingsSubjects(
          { ...settings, subjects, schemaVersion: 3 },
          renamedBlocks.filter((block): block is RecordBlock => block.type === "record"),
        ),
      );
    });
  }

  async getOrCreateEntry(date: string): Promise<DayEntry> {
    const existing = await db.entries.where("date").equals(date).first();
    if (existing) {
      return existing;
    }
    const entry = createDayEntry(date);
    await db.entries.put(entry);
    return entry;
  }

  async listEntries(): Promise<DayEntry[]> {
    return db.entries.orderBy("date").reverse().filter((entry) => !entry.deletedAt).toArray();
  }

  async saveEntry(entry: DayEntry): Promise<DayEntry> {
    const saved = touch(entry);
    await db.entries.put(saved);
    return saved;
  }

  async listBlocks(date?: string): Promise<Block[]> {
    const collection = date ? db.blocks.where("date").equals(date) : db.blocks.toCollection();
    const blocks = await collection.filter((block) => !block.deletedAt).toArray();
    return blocks.sort((a, b) => a.order - b.order);
  }

  async saveBlock(block: Block): Promise<Block> {
    const saved = touch(block.type === "record" ? syncRecordRefsFromContent({ ...block, mistakeRefs: [] }) : block);
    await db.transaction("rw", db.blocks, db.recordDrafts, async () => {
      await db.blocks.put(saved);
      if (saved.type === "record") {
        await db.recordDrafts.delete(saved.id);
      }
    });

    if (saved.type === "studySession") {
      const existing = await db.studySessions.where("blockId").equals(saved.id).first();
      const session: StudySession = {
        ...(existing ?? createBaseEntity()),
        date: saved.date,
        subject: saved.subject,
        minutes: saved.minutes,
        note: saved.note,
        blockId: saved.id,
      };
      await db.studySessions.put(touch(session));
    }

    return saved;
  }

  async getRecordDraft(recordId: string): Promise<RecordDraft | undefined> {
    return db.recordDrafts.get(recordId);
  }

  async listRecordDrafts(): Promise<RecordDraft[]> {
    return db.recordDrafts.orderBy("updatedAt").reverse().toArray();
  }

  async saveRecordDraft(draft: RecordDraft): Promise<RecordDraft> {
    const saved: RecordDraft = {
      ...draft,
      id: draft.recordId,
      draft: syncRecordRefsFromContent({ ...draft.draft, mistakeRefs: [] }),
      updatedAt: nowISO(),
    };
    await db.recordDrafts.put(saved);
    return saved;
  }

  async deleteRecordDraft(recordId: string): Promise<void> {
    await db.recordDrafts.delete(recordId);
  }

  async listRecordReviews(): Promise<RecordReviewState[]> {
    return db.recordReviews.toArray();
  }

  async getRecordReview(recordId: string): Promise<RecordReviewState | undefined> {
    return db.recordReviews.get(recordId);
  }

  async listDueRecordReviews(date: string): Promise<RecordReviewState[]> {
    const candidates = await db.recordReviews
      .where("[status+nextReviewDate]")
      .between(["active", Dexie.minKey], ["active", date], true, true)
      .toArray();
    const activeBlocks = new Map((await this.recordBlocks()).filter((record) => !record.deletedAt).map((record) => [record.id, record]));
    return candidates
      .filter((review) => isReviewDueOn(review, date) && activeBlocks.has(review.recordId))
      .sort((a, b) => {
        const byDue = (a.nextReviewDate ?? "").localeCompare(b.nextReviewDate ?? "");
        if (byDue !== 0) {
          return byDue;
        }
        const byKind = (a.reviewKind === "memory" ? 0 : 1) - (b.reviewKind === "memory" ? 0 : 1);
        if (byKind !== 0) {
          return byKind;
        }
        const aRecord = activeBlocks.get(a.recordId);
        const bRecord = activeBlocks.get(b.recordId);
        return (bRecord?.date ?? "").localeCompare(aRecord?.date ?? "") || (aRecord?.order ?? 0) - (bRecord?.order ?? 0);
      });
  }

  async addRecordToReview(recordId: string, kind: RecordReviewKind = DEFAULT_REVIEW_KIND): Promise<RecordReviewState | undefined> {
    const record = await this.activeRecord(recordId);
    if (!record) {
      return undefined;
    }
    const existing = await db.recordReviews.get(recordId);
    if (existing?.status === "active") {
      return existing;
    }
    const saved = this.reviewStateForNewCycle(recordId, existing, kind);
    await db.recordReviews.put(saved);
    return saved;
  }

  async addRecordsToReview(recordIds: string[], kind: RecordReviewKind = DEFAULT_REVIEW_KIND): Promise<RecordReviewBulkResult> {
    const uniqueIds = Array.from(new Set(recordIds));
    const result: RecordReviewBulkResult = { added: 0, reset: 0, skippedActive: 0 };
    for (const recordId of uniqueIds) {
      const record = await this.activeRecord(recordId);
      if (!record) {
        continue;
      }
      const existing = await db.recordReviews.get(recordId);
      if (existing?.status === "active") {
        result.skippedActive += 1;
        continue;
      }
      await db.recordReviews.put(this.reviewStateForNewCycle(recordId, existing, kind));
      if (existing) {
        result.reset += 1;
      } else {
        result.added += 1;
      }
    }
    return result;
  }

  async setRecordReviewKind(recordId: string, kind: RecordReviewKind): Promise<RecordReviewState | undefined> {
    const record = await this.activeRecord(recordId);
    if (!record) {
      return undefined;
    }
    const existing = await db.recordReviews.get(recordId);
    const saved = this.reviewStateForNewCycle(recordId, existing, kind);
    await db.recordReviews.put(saved);
    return saved;
  }

  async resetRecordReview(recordId: string): Promise<RecordReviewState | undefined> {
    const record = await this.activeRecord(recordId);
    if (!record) {
      return undefined;
    }
    const existing = await db.recordReviews.get(recordId);
    const saved = this.reviewStateForNewCycle(recordId, existing, existing?.reviewKind ?? DEFAULT_REVIEW_KIND);
    await db.recordReviews.put(saved);
    return saved;
  }

  async removeRecordFromReview(recordId: string): Promise<RecordReviewState | undefined> {
    const existing = await db.recordReviews.get(recordId);
    if (!existing) {
      return undefined;
    }
    const saved: RecordReviewState = {
      ...existing,
      status: "removed",
      nextReviewDate: undefined,
      updatedAt: nowISO(),
    };
    await db.recordReviews.put(saved);
    return saved;
  }

  async ensureRecordReviewDay(date: string, dueCountAtFirstOpen: number): Promise<RecordReviewDayStat> {
    const existing = await db.recordReviewDayStats.get(date);
    if (existing) {
      return existing;
    }
    const stat: RecordReviewDayStat = {
      ...createBaseEntity(),
      id: date,
      date,
      dueCountAtFirstOpen,
      reviewedCount: 0,
      rememberedCount: 0,
      fuzzyCount: 0,
      forgotCount: 0,
      goodCount: 0,
      easyCount: 0,
    };
    await db.recordReviewDayStats.put(stat);
    return stat;
  }

  async rateRecordReview(recordId: string, rating: RecordReviewRating, reviewedAt = nowISO()): Promise<RecordReviewState | undefined> {
    const record = await this.activeRecord(recordId);
    const review = await db.recordReviews.get(recordId);
    if (!review || !record || review.status !== "active") {
      if (review) {
        await this.removeRecordFromReview(recordId);
      }
      return undefined;
    }
    const reviewedDate = isoDateTimeToLocalDate(reviewedAt);

    const saved = await db.transaction("rw", db.recordReviews, db.recordReviewLogs, db.recordReviewDayStats, async () => {
      const current = await db.recordReviews.get(recordId);
      if (!current || current.status !== "active") {
        return undefined;
      }
      const correctionLog = current.lastReviewDate === reviewedDate
        ? (await db.recordReviewLogs.where("recordId").equals(recordId).toArray())
          .filter((log) => isoDateTimeToLocalDate(log.reviewedAt) === reviewedDate)
          .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0]
        : undefined;
      const baseState = correctionLog
        ? reviewStateBeforeLog(current, correctionLog)
        : current.lastReviewDate === reviewedDate
          ? { ...current, totalReviews: Math.max(0, current.totalReviews - 1) }
          : current;
      const scheduled = applyRecordReview(baseState, rating, reviewedDate, reviewedAt);
      const nextState = { ...scheduled.state, updatedAt: nowISO() };
      const normalizedRating = normalizeLegacyRating(rating);
      const log: RecordReviewLog = {
        ...(correctionLog ?? createBaseEntity()),
        recordId,
        rating,
        normalizedRating,
        reviewKind: nextState.reviewKind ?? DEFAULT_REVIEW_KIND,
        scheduler: nextState.scheduler ?? schedulerForKind(nextState.reviewKind ?? DEFAULT_REVIEW_KIND),
        reviewedAt,
        previousEaseFactor: baseState.easeFactor,
        nextEaseFactor: nextState.easeFactor,
        previousRepetition: baseState.repetition,
        nextRepetition: nextState.repetition,
        previousIntervalDays: baseState.intervalDays,
        nextIntervalDays: nextState.intervalDays,
        previousNextReviewDate: baseState.nextReviewDate,
        nextReviewDate: nextState.nextReviewDate,
        previousLastReviewDate: baseState.lastReviewDate,
        previousLastReviewedAt: baseState.lastReviewedAt,
        previousConsecutiveRemembered: baseState.consecutiveRemembered,
        previousTotalReviews: baseState.totalReviews,
        previousFsrsCard: baseState.fsrsCard,
        nextFsrsCard: nextState.fsrsCard,
        updatedAt: nowISO(),
      };
      await db.recordReviews.put(nextState);
      await db.recordReviewLogs.put(log);
      const existingStat = await db.recordReviewDayStats.get(reviewedDate);
      const stat = existingStat ?? {
        ...createBaseEntity(),
        id: reviewedDate,
        date: reviewedDate,
        dueCountAtFirstOpen: 0,
        reviewedCount: 0,
        rememberedCount: 0,
        fuzzyCount: 0,
        forgotCount: 0,
        goodCount: 0,
        easyCount: 0,
      };
      const nextStat: RecordReviewDayStat = correctionLog && existingStat
        ? updateDayStatForRatingCorrection(stat, correctionLog.normalizedRating ?? correctionLog.rating, normalizedRating)
        : {
          ...stat,
          reviewedCount: stat.reviewedCount + 1,
          rememberedCount: stat.rememberedCount + (normalizedRating === "good" || normalizedRating === "easy" ? 1 : 0),
          fuzzyCount: stat.fuzzyCount + (normalizedRating === "fuzzy" ? 1 : 0),
          forgotCount: stat.forgotCount + (normalizedRating === "forgot" ? 1 : 0),
          goodCount: (stat.goodCount ?? 0) + (normalizedRating === "good" ? 1 : 0),
          easyCount: (stat.easyCount ?? 0) + (normalizedRating === "easy" ? 1 : 0),
          updatedAt: nowISO(),
        };
      await db.recordReviewDayStats.put(nextStat);
      return nextState;
    });

    if (!saved) {
      return undefined;
    }
    const remainingDue = await this.listDueRecordReviews(reviewedDate);
    if (remainingDue.length === 0) {
      const stat = await db.recordReviewDayStats.get(reviewedDate);
      if (stat && !stat.completedAt) {
        await db.recordReviewDayStats.put({ ...stat, completedAt: nowISO(), updatedAt: nowISO() });
      }
    }
    return saved;
  }

  async listRecordReviewLogs(recordId?: string): Promise<RecordReviewLog[]> {
    const logs = recordId
      ? await db.recordReviewLogs.where("recordId").equals(recordId).toArray()
      : await db.recordReviewLogs.toArray();
    return logs.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  }

  async getRecordReviewStats(date = todayISO()): Promise<RecordReviewStats> {
    const [reviews, dayStats, logs, dueReviews] = await Promise.all([
      db.recordReviews.toArray(),
      db.recordReviewDayStats.toArray(),
      db.recordReviewLogs.toArray(),
      this.listDueRecordReviews(date),
    ]);
    const active = reviews.filter((review) => review.status === "active");
    const mastered = reviews.filter((review) => review.status === "mastered");
    const overdueCount = dueReviews.filter((review) => review.nextReviewDate && review.nextReviewDate < date).length;
    const sortedStats = dayStats.sort((a, b) => b.date.localeCompare(a.date));
    const todayReviewed = dayStats.find((stat) => stat.date === date && stat.reviewedCount > 0);
    let streakCursor = todayReviewed ? date : addDaysISO(date, -1);
    let streakDays = 0;
    while (streakCursor) {
      const stat = dayStats.find((item) => item.date === streakCursor);
      if (!stat || stat.reviewedCount <= 0) {
        break;
      }
      streakDays += 1;
      streakCursor = addDaysISO(streakCursor, -1);
    }
    const byDate = new Map<string, { remembered: number; reviewed: number }>();
    for (const log of logs) {
      const key = isoDateTimeToLocalDate(log.reviewedAt);
      const current = byDate.get(key) ?? { remembered: 0, reviewed: 0 };
      current.reviewed += 1;
      const normalizedRating = log.normalizedRating ?? normalizeLegacyRating(log.rating);
      if (normalizedRating === "good" || normalizedRating === "easy") {
        current.remembered += 1;
      }
      byDate.set(key, current);
    }
    const masteryTrend = Array.from(byDate, ([trendDate, value]) => ({
      date: trendDate,
      rememberedRate: value.reviewed > 0 ? value.remembered / value.reviewed : 0,
      reviewedCount: value.reviewed,
    })).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);

    return {
      activeCount: active.length,
      masteredCount: mastered.length,
      dueCount: dueReviews.length,
      overdueCount,
      totalReviews: logs.length,
      streakDays,
      todayStat: dayStats.find((stat) => stat.date === date),
      dayStats: sortedStats,
      masteryTrend,
    };
  }

  async deleteBlock(blockId: string): Promise<void> {
    const block = await db.blocks.get(blockId);
    if (!block) {
      return;
    }
    await db.transaction("rw", db.blocks, db.recordDrafts, db.recordReviews, async () => {
      await db.blocks.put({ ...block, deletedAt: nowISO(), updatedAt: nowISO() });
      await db.recordDrafts.delete(blockId);
      const review = await db.recordReviews.get(blockId);
      if (review) {
        await db.recordReviews.put({ ...review, status: "removed", nextReviewDate: undefined, updatedAt: nowISO() });
      }
    });
  }

  async listDeletedBlocks(): Promise<RecordBlock[]> {
    const blocks = (await db.blocks.toArray()).filter(
      (block): block is RecordBlock => block.type === "record" && Boolean(block.deletedAt),
    );
    return blocks.sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  }

  async restoreBlock(blockId: string): Promise<RecordBlock | undefined> {
    const block = await db.blocks.get(blockId);
    if (!block || block.type !== "record") {
      return undefined;
    }
    const { deletedAt: _deletedAt, ...restored } = block;
    const saved = { ...restored, updatedAt: nowISO() };
    await db.blocks.put(saved);
    return saved;
  }

  async permanentlyDeleteBlock(blockId: string): Promise<void> {
    const block = await db.blocks.get(blockId);
    if (!block) {
      return;
    }
    const draft = await db.recordDrafts.get(blockId);

    await db.transaction("rw", [db.blocks, db.recordDrafts, db.assets, db.studySessions, db.recordReviews, db.recordReviewLogs], async () => {
      await db.blocks.delete(blockId);
      await db.recordDrafts.delete(blockId);
      await db.studySessions.where("blockId").equals(blockId).delete();
      await db.recordReviews.delete(blockId);
      await db.recordReviewLogs.where("recordId").equals(blockId).delete();
      if (block.type === "record") {
        await this.cleanupOrphanAssetsForRecord(block, draft);
      }
    });
  }

  async purgeExpiredDeletedBlocks(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const expired = await db.blocks
      .filter(
        (block): block is RecordBlock =>
          block.type === "record" &&
          Boolean(block.deletedAt) &&
          new Date(block.deletedAt ?? 0).getTime() <= cutoff,
      )
      .toArray();

    for (const block of expired) {
      await this.permanentlyDeleteBlock(block.id);
    }
    return expired.length;
  }

  async toggleRecordFavorite(blockId: string, favorite: boolean): Promise<RecordBlock | undefined> {
    const block = await db.blocks.get(blockId);
    if (!block || block.type !== "record") {
      return undefined;
    }
    const saved = { ...block, favorite, updatedAt: nowISO() };
    await db.blocks.put(saved);
    return saved;
  }

  async reorderBlocks(date: string, blockIds: string[]): Promise<void> {
    await db.transaction("rw", db.blocks, async () => {
      for (const [order, blockId] of blockIds.entries()) {
        const block = await db.blocks.get(blockId);
        if (block && block.date === date) {
          await db.blocks.put({ ...block, order, updatedAt: nowISO() });
        }
      }
    });
  }

  async listMistakes(): Promise<MistakeCard[]> {
    return [];
  }

  async saveMistake(mistake: MistakeCard): Promise<MistakeCard> {
    return touch(mistake);
  }

  async listDueMistakes(date: string): Promise<MistakeCard[]> {
    void date;
    return [];
  }

  async listReviews(mistakeId?: string): Promise<ReviewSchedule[]> {
    void mistakeId;
    return [];
  }

  async saveReview(review: ReviewSchedule): Promise<ReviewSchedule> {
    return touch(review);
  }

  async listTags(): Promise<Tag[]> {
    return db.tags.orderBy("name").filter((tag) => !tag.deletedAt).toArray();
  }

  async upsertTag(name: string): Promise<Tag> {
    const normalized = name.trim().replace(/^#/, "");
    const existing = await db.tags.where("name").equals(normalized).first();
    if (existing) {
      return existing;
    }
    const tag: Tag = {
      ...createBaseEntity(),
      name: normalized,
    };
    await db.tags.put(tag);
    return tag;
  }

  async listStudySessions(): Promise<StudySession[]> {
    return db.studySessions.orderBy("date").reverse().filter((session) => !session.deletedAt).toArray();
  }

  async saveStudySession(session: StudySession): Promise<StudySession> {
    const saved = touch(session);
    await db.studySessions.put(saved);
    return saved;
  }

  async saveAsset(file: File, kind: Asset["kind"], title?: string): Promise<Asset> {
    const asset: Asset = {
      ...createBaseEntity(),
      fileName: file.name,
      title: title ?? file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind,
      data: file,
    };
    await db.assets.put(asset);
    return asset;
  }

  async patchAsset(id: string, patch: Partial<Omit<Asset, "id" | "data">>): Promise<Asset | undefined> {
    const existing = await db.assets.get(id);
    if (!existing) {
      return undefined;
    }
    const { data: _ignoredData, id: _ignoredId, ...safePatch } = patch as Partial<Asset>;
    const saved = touch({ ...existing, ...safePatch, data: existing.data });
    await db.assets.put(saved);
    return saved;
  }

  async renameAssetTitle(assetId: string, title: string): Promise<void> {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    const existing = await db.assets.get(assetId);
    if (!existing) {
      return;
    }

    const [blocks, drafts] = await Promise.all([db.blocks.toArray(), db.recordDrafts.toArray()]);
    const renamedBlocks: Block[] = [];
    const renamedDrafts: RecordDraft[] = [];

    for (const block of blocks) {
      if (block.type !== "record") {
        continue;
      }
      const result = renameRecordAssetTitle(block, assetId, nextTitle);
      if (result.changed) {
        renamedBlocks.push(touch(result.record));
      }
    }

    for (const draft of drafts) {
      const result = renameRecordAssetTitle(draft.draft, assetId, nextTitle);
      if (result.changed) {
        renamedDrafts.push({
          ...draft,
          draft: result.record,
          updatedAt: nowISO(),
        });
      }
    }

    const savedAsset = touch({ ...existing, title: nextTitle, data: existing.data });
    await db.transaction("rw", db.assets, db.blocks, db.recordDrafts, async () => {
      await db.assets.put(savedAsset);
      if (renamedBlocks.length > 0) {
        await db.blocks.bulkPut(renamedBlocks);
      }
      if (renamedDrafts.length > 0) {
        await db.recordDrafts.bulkPut(renamedDrafts);
      }
    });
  }

  async resetStaleOcrJobs(maxAgeMs: number): Promise<void> {
    const now = Date.now();
    const assets = await db.assets
      .filter((asset) =>
        asset.kind === "image" &&
        (asset.ocrStatus === "queued" || asset.ocrStatus === "running") &&
        Boolean(asset.ocrUpdatedAt) &&
        now - new Date(asset.ocrUpdatedAt ?? 0).getTime() > maxAgeMs,
      )
      .toArray();

    if (assets.length === 0) {
      return;
    }

    await db.assets.bulkPut(
      assets.map((asset) =>
        touch({
          ...asset,
          ocrStatus: "failed",
          ocrError: "上次 OCR 识别中断，可重新识别。",
          ocrUpdatedAt: nowISO(),
        }),
      ),
    );
  }

  async getAsset(id: string): Promise<Asset | undefined> {
    return db.assets.get(id);
  }

  async listAssets(): Promise<Asset[]> {
    return db.assets.toArray();
  }

  async createSnapshot(): Promise<StorageSnapshot> {
    const [
      entries,
      blocks,
      tags,
      studySessions,
      settings,
      assets,
      recordDrafts,
      recordReviews,
      recordReviewLogs,
      recordReviewDayStats,
    ] = await Promise.all([
      db.entries.toArray(),
      db.blocks.toArray(),
      db.tags.toArray(),
      db.studySessions.toArray(),
      this.getSettings(),
      db.assets.toArray(),
      db.recordDrafts.toArray(),
      db.recordReviews.toArray(),
      db.recordReviewLogs.toArray(),
      db.recordReviewDayStats.toArray(),
    ]);
    const cleanedBlocks: Block[] = blocks.map((block) =>
      block.type === "record" ? { ...block, mistakeRefs: [] as string[] } : block,
    );

    return {
      payload: {
        manifest: {
          format: "study-journal",
          version: 4,
          exportedAt: nowISO(),
          appVersion: "0.1.0",
          counts: {
            entries: entries.length,
            blocks: cleanedBlocks.length,
            mistakes: 0,
            assets: assets.length,
            tags: tags.length,
            reviews: 0,
            studySessions: studySessions.length,
            recordReviews: recordReviews.length,
            recordReviewLogs: recordReviewLogs.length,
            recordReviewDayStats: recordReviewDayStats.length,
          },
        },
        entries,
        blocks: cleanedBlocks,
        recordDrafts,
        mistakes: [],
        tags,
        reviews: [],
        recordReviews,
        recordReviewLogs,
        recordReviewDayStats,
        studySessions,
        settings: ensureSettingsSubjects({ ...settings, schemaVersion: 4 }, cleanedBlocks.filter((block): block is RecordBlock => block.type === "record")),
      },
      assets,
      recordDrafts,
    };
  }

  async createStreamableSnapshot(): Promise<StreamableBackupSnapshot> {
    const collectAssetMetas = async () => {
      const assetMetas: BackupAssetMeta[] = [];
      await db.assets.each((asset) => {
        assetMetas.push(assetToMeta(asset));
      });
      return assetMetas;
    };

    const [
      entries,
      blocks,
      tags,
      studySessions,
      settings,
      assets,
      recordDrafts,
      recordReviews,
      recordReviewLogs,
      recordReviewDayStats,
    ] = await Promise.all([
      db.entries.toArray(),
      db.blocks.toArray(),
      db.tags.toArray(),
      db.studySessions.toArray(),
      this.getSettings(),
      collectAssetMetas(),
      db.recordDrafts.toArray(),
      db.recordReviews.toArray(),
      db.recordReviewLogs.toArray(),
      db.recordReviewDayStats.toArray(),
    ]);
    const cleanedBlocks: Block[] = blocks.map((block) =>
      block.type === "record" ? { ...block, mistakeRefs: [] as string[] } : block,
    );

    return {
      payload: {
        manifest: {
          format: "study-journal",
          version: 4,
          exportedAt: nowISO(),
          appVersion: "0.1.0",
          counts: {
            entries: entries.length,
            blocks: cleanedBlocks.length,
            mistakes: 0,
            assets: assets.length,
            tags: tags.length,
            reviews: 0,
            studySessions: studySessions.length,
            recordReviews: recordReviews.length,
            recordReviewLogs: recordReviewLogs.length,
            recordReviewDayStats: recordReviewDayStats.length,
          },
        },
        entries,
        blocks: cleanedBlocks,
        recordDrafts,
        mistakes: [],
        tags,
        reviews: [],
        recordReviews,
        recordReviewLogs,
        recordReviewDayStats,
        studySessions,
        settings: ensureSettingsSubjects({ ...settings, schemaVersion: 4 }, cleanedBlocks.filter((block): block is RecordBlock => block.type === "record")),
      },
      assets,
      recordDrafts,
    };
  }

  async restoreSnapshot(snapshot: StorageSnapshot): Promise<void> {
    await db.transaction(
      "rw",
      [
        db.entries,
        db.blocks,
        db.recordDrafts,
        db.recordReviews,
        db.recordReviewLogs,
        db.recordReviewDayStats,
        db.mistakes,
        db.tags,
        db.reviews,
        db.studySessions,
        db.settings,
        db.assets,
      ],
      async () => {
        await Promise.all([
          db.entries.clear(),
          db.blocks.clear(),
          db.recordDrafts.clear(),
          db.recordReviews.clear(),
          db.recordReviewLogs.clear(),
          db.recordReviewDayStats.clear(),
          db.mistakes.clear(),
          db.tags.clear(),
          db.reviews.clear(),
          db.studySessions.clear(),
          db.settings.clear(),
          db.assets.clear(),
        ]);
        const restoredBlocks = migrateBlocksToRecords(snapshot.payload.blocks);
        const restoredRecords = restoredBlocks.filter((block): block is RecordBlock => block.type === "record");
        await Promise.all([
          db.entries.bulkPut(snapshot.payload.entries),
          db.blocks.bulkPut(restoredBlocks),
          db.recordDrafts.bulkPut(snapshot.payload.recordDrafts ?? snapshot.recordDrafts ?? []),
          db.recordReviews.bulkPut(snapshot.payload.recordReviews ?? []),
          db.recordReviewLogs.bulkPut(snapshot.payload.recordReviewLogs ?? []),
          db.recordReviewDayStats.bulkPut(snapshot.payload.recordReviewDayStats ?? []),
          db.tags.bulkPut(snapshot.payload.tags),
          db.studySessions.bulkPut(snapshot.payload.studySessions),
          db.settings.put(ensureSettingsSubjects({ ...snapshot.payload.settings, schemaVersion: 4 }, restoredRecords)),
          db.assets.bulkPut(snapshot.assets),
        ]);
      },
    );
    await this.migrateRecordReviewsToMixedSystem();
  }

  async restoreStreamableSnapshot(
    snapshot: StreamableBackupSnapshot,
    readAsset: StreamedAssetReader,
    options: StreamingImportOptions = {},
  ): Promise<void> {
    const restoredBlocks = migrateBlocksToRecords(snapshot.payload.blocks);
    const restoredRecords = restoredBlocks.filter((block): block is RecordBlock => block.type === "record");

    await db.transaction(
      "rw",
      [
        db.entries,
        db.blocks,
        db.recordDrafts,
        db.recordReviews,
        db.recordReviewLogs,
        db.recordReviewDayStats,
        db.mistakes,
        db.tags,
        db.reviews,
        db.studySessions,
        db.settings,
        db.assets,
      ],
      async () => {
        await Promise.all([
          db.entries.clear(),
          db.blocks.clear(),
          db.recordDrafts.clear(),
          db.recordReviews.clear(),
          db.recordReviewLogs.clear(),
          db.recordReviewDayStats.clear(),
          db.mistakes.clear(),
          db.tags.clear(),
          db.reviews.clear(),
          db.studySessions.clear(),
          db.settings.clear(),
          db.assets.clear(),
        ]);
        await Promise.all([
          db.entries.bulkPut(snapshot.payload.entries),
          db.blocks.bulkPut(restoredBlocks),
          db.recordDrafts.bulkPut(snapshot.payload.recordDrafts ?? snapshot.recordDrafts ?? []),
          db.recordReviews.bulkPut(snapshot.payload.recordReviews ?? []),
          db.recordReviewLogs.bulkPut(snapshot.payload.recordReviewLogs ?? []),
          db.recordReviewDayStats.bulkPut(snapshot.payload.recordReviewDayStats ?? []),
          db.tags.bulkPut(snapshot.payload.tags),
          db.studySessions.bulkPut(snapshot.payload.studySessions),
          db.settings.put(ensureSettingsSubjects({ ...snapshot.payload.settings, schemaVersion: 4 }, restoredRecords)),
        ]);
      },
    );
    await this.migrateRecordReviewsToMixedSystem();

    const total = snapshot.assets.length;
    for (const [index, meta] of snapshot.assets.entries()) {
      options.onProgress?.({
        stage: "assets",
        message: `正在恢复资源 ${index + 1}/${total}。`,
        current: index + 1,
        total,
      });
      const asset = await readAsset(meta, index, total);
      if (asset) {
        await db.assets.put(asset);
      }
    }
  }

  async clearAll(): Promise<void> {
    await db.delete();
    await this.initialize();
  }

  async listAiSessions(): Promise<AiChatSession[]> {
    return db.aiSessions.orderBy("updatedAt").reverse().toArray();
  }

  async getAiSession(id: string): Promise<AiChatSession | undefined> {
    return db.aiSessions.get(id);
  }

  async saveAiSession(session: AiChatSession): Promise<AiChatSession> {
    const saved = touch(session);
    await db.aiSessions.put(saved);
    return saved;
  }

  async deleteAiSession(id: string): Promise<void> {
    await db.transaction("rw", db.aiSessions, db.aiMessages, db.aiAttachments, async () => {
      await db.aiAttachments.where("sessionId").equals(id).delete();
      await db.aiMessages.where("sessionId").equals(id).delete();
      await db.aiSessions.delete(id);
    });
  }

  async listAiMessages(sessionId: string): Promise<AiChatMessage[]> {
    return db.aiMessages.where("sessionId").equals(sessionId).sortBy("createdAt");
  }

  async saveAiMessage(message: AiChatMessage): Promise<AiChatMessage> {
    const saved = touch(message);
    await db.transaction("rw", db.aiMessages, db.aiSessions, async () => {
      await db.aiMessages.put(saved);
      const session = await db.aiSessions.get(saved.sessionId);
      if (session) {
        await db.aiSessions.put({ ...session, updatedAt: nowISO() });
      }
    });
    return saved;
  }

  async saveAiAttachment(attachment: AiChatAttachment): Promise<AiChatAttachment> {
    const saved = touch(attachment);
    await db.aiAttachments.put(saved);
    return saved;
  }

  async listAiAttachments(sessionId: string): Promise<AiChatAttachment[]> {
    return db.aiAttachments.where("sessionId").equals(sessionId).sortBy("createdAt");
  }

  async getAiAttachment(id: string): Promise<AiChatAttachment | undefined> {
    return db.aiAttachments.get(id);
  }

  async deleteAiAttachment(id: string): Promise<void> {
    await db.aiAttachments.delete(id);
  }

  async deleteAiAttachmentsForSession(sessionId: string): Promise<void> {
    await db.aiAttachments.where("sessionId").equals(sessionId).delete();
  }

  async getAiSecret(providerId = "default"): Promise<AiSecret | undefined> {
    return db.aiSecrets.get(providerId);
  }

  async saveAiSecret(apiKey: string, providerId = "default"): Promise<AiSecret> {
    const secret: AiSecret = {
      id: providerId,
      apiKey,
      updatedAt: nowISO(),
    };
    await db.aiSecrets.put(secret);
    return secret;
  }

  async clearAiSecret(providerId = "default"): Promise<void> {
    await db.aiSecrets.delete(providerId);
  }
}

export const storage = new DexieStorageAdapter();

export const observeEntries = () => liveQuery(() => storage.listEntries());
export const observeMistakes = () => liveQuery(() => storage.listMistakes());
