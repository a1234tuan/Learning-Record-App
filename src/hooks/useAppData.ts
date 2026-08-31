import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AppSettings,
  Asset,
  AutoBackupSettings,
  Block,
  ContentTemplate,
  DayEntry,
  KnowledgePodcast,
  KnowledgePoint,
  KnowledgePointCoachSnapshot,
  KnowledgePointExtractionRun,
  KnowledgeRelation,
  RecordKnowledgePointLink,
  RecordBlock,
  RecordReviewBulkResult,
  RecordReviewDayStat,
  RecordReviewLog,
  RecordReviewKind,
  RecordReviewRating,
  RecordReviewState,
  RecordReviewStats,
  RecordReviewUndoToken,
  LearningCoachSettings,
  LearningCoachAiRun,
  LearningCoachSkipReason,
  LearningCoachSnapshot,
  LearningCoachTask,
  LearningEvidence,
  StudySession,
  Subject,
  SubjectConfig,
} from "../types";
import { storage } from "../services/storageAdapter";
import { createBaseEntity } from "../lib/entity";
import { todayISO } from "../lib/date";
import { createTemplateBlocks } from "../db/defaults";
import {
  createSubjectConfig,
  fallbackSubjectName,
  getActiveSubjects,
  getAllSubjects,
  nextRecordTitle,
  normalizeSubject,
  canonicalStudySubject,
  CANONICAL_STUDY_SUBJECTS,
  validateSubjectName,
} from "../lib/subjects";
import { enqueueAutoOcrForRecord } from "../services/ocrJobService";
import { flushAutoBackupNow, markAutoBackupDirty } from "../services/autoBackupService";
import { cancelAllKnowledgePodcastJobs, recoverKnowledgePodcastJobs, subscribeKnowledgePodcastJobs, syncNativeKnowledgePodcastTtsJobs } from "../services/knowledgePodcastJobService";
import { cleanupCloudRecoverySnapshotsIfDue, getCurrentCloudUser } from "../services/cloudSyncService";
import { buildLearningCoachProjection } from "../services/learningCoachService";
import { createTaskLifecycleEvidence, evaluateLearningCoachTask, normalizeLearningCoachTask, resolveLearningCoachCandidateWorkflow, skipLearningCoachTask, startLearningCoachTask } from "../services/learningCoachTaskService";
import { requestLearningCoachAnalysis } from "../services/learningCoachAiService";
import { buildAiKnowledgeContextPackAsync } from "../services/aiContextService";
import { knowledgePointCatalogFingerprint, recordKnowledgeFingerprint } from "../lib/knowledgePointIdentity";
import { buildLearningCoachDecision } from "../services/learningCoachDecisionService";

export const useAppData = () => {
  const [initialized, setInitialized] = useState(false);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [autoBackupState, setAutoBackupState] = useState<AutoBackupSettings | null>(null);
  const [podcasts, setPodcasts] = useState<KnowledgePodcast[]>([]);
  const [deletedRecords, setDeletedRecords] = useState<RecordBlock[]>([]);
  const [recordReviews, setRecordReviews] = useState<RecordReviewState[]>([]);
  const [dueRecordReviews, setDueRecordReviews] = useState<RecordReviewState[]>([]);
  const [recordReviewLogs, setRecordReviewLogs] = useState<RecordReviewLog[]>([]);
  const [recordReviewStats, setRecordReviewStats] = useState<RecordReviewStats | null>(null);
  const [studySessions, setStudySessions] = useState<StudySession[]>([]);
  const [learningCoachSettings, setLearningCoachSettings] = useState<LearningCoachSettings | null>(null);
  const [learningEvidence, setLearningEvidence] = useState<LearningEvidence[]>([]);
  const [learningCoachSnapshots, setLearningCoachSnapshots] = useState<LearningCoachSnapshot[]>([]);
  const [learningCoachTasks, setLearningCoachTasks] = useState<LearningCoachTask[]>([]);
  const [learningCoachAiRuns, setLearningCoachAiRuns] = useState<LearningCoachAiRun[]>([]);
  const [knowledgePoints, setKnowledgePoints] = useState<KnowledgePoint[]>([]);
  const [recordKnowledgePointLinks, setRecordKnowledgePointLinks] = useState<RecordKnowledgePointLink[]>([]);
  const [knowledgePointExtractionRuns, setKnowledgePointExtractionRuns] = useState<KnowledgePointExtractionRun[]>([]);
  const [knowledgePointCoachSnapshots, setKnowledgePointCoachSnapshots] = useState<KnowledgePointCoachSnapshot[]>([]);
  const [knowledgeRelations, setKnowledgeRelations] = useState<KnowledgeRelation[]>([]);
  const coachRunRef = useRef<Promise<LearningCoachSnapshot | undefined>>();
  const knowledgePointRunRef = useRef<Promise<KnowledgePointCoachSnapshot | undefined>>();
  const [assetsVersion, setAssetsVersion] = useState(0);

  const refresh = useCallback(async () => {
    const [entryList, blockList, templateList, currentSettings, assetList, deletedList, reviewList, dueReviews, reviewLogs, reviewStats, podcastList, currentAutoBackupState, sessionList, coachSettings, coachEvidence, coachSnapshots, coachTasks, coachAiRuns, points, pointLinks, extractionRuns, pointSnapshots, relations] = await Promise.all([
      storage.listEntries(),
      storage.listBlocks(),
      storage.listTemplates(),
      storage.getSettings(),
      storage.listAssets(),
      storage.listDeletedBlocks(),
      storage.listRecordReviews(),
      storage.listDueRecordReviews(todayISO()),
      storage.listRecordReviewLogs(),
      storage.getRecordReviewStats(todayISO()),
      storage.listKnowledgePodcasts?.() ?? Promise.resolve([]),
      storage.getAutoBackupState(),
      storage.listStudySessions(),
      storage.getLearningCoachSettings(),
      storage.listLearningEvidence(),
      storage.listLearningCoachSnapshots(),
      storage.listLearningCoachTasks(),
      storage.listLearningCoachAiRuns(),
      storage.listKnowledgePoints(),
      storage.listRecordKnowledgePointLinks(),
      storage.listKnowledgePointExtractionRuns(),
      storage.listKnowledgePointCoachSnapshots(),
      storage.listKnowledgeRelations(),
    ]);
    setEntries(entryList);
    setBlocks(blockList);
    setTemplates(templateList);
    setSettings(currentSettings);
    setAutoBackupState(currentAutoBackupState);
    setAssets(assetList);
    setDeletedRecords(deletedList);
    setRecordReviews(reviewList);
    setDueRecordReviews(dueReviews);
    setRecordReviewLogs(reviewLogs);
    setRecordReviewStats(reviewStats);
    setPodcasts(podcastList);
    setStudySessions(sessionList);
    setLearningCoachSettings(coachSettings);
    setLearningEvidence(coachEvidence);
    setLearningCoachSnapshots(coachSnapshots);
    setLearningCoachTasks(coachTasks);
    setLearningCoachAiRuns(coachAiRuns);
    setKnowledgePoints(points);
    setRecordKnowledgePointLinks(pointLinks);
    setKnowledgePointExtractionRuns(extractionRuns);
    setKnowledgePointCoachSnapshots(pointSnapshots);
    setKnowledgeRelations(relations);
  }, []);

  useEffect(() => {
    let mounted = true;
    void storage.initialize().then(async () => {
      if (!mounted) {
        return;
      }
      await recoverKnowledgePodcastJobs();
      for (const run of (await storage.listLearningCoachAiRuns()).filter((item) => item.status === "running" || item.status === "queued")) {
        await storage.saveLearningCoachAiRun({ ...run, status: "failed", phase: undefined, completedAt: new Date().toISOString(), error: "上次 AI 分析在应用退出前未完成，请重试。" });
      }
      await refresh();
      setInitialized(true);
      await storage.purgeExpiredDeletedBlocks(30);
      if (!mounted) {
        return;
      }
      await refresh();
      await flushAutoBackupNow("app-start");
      if (!mounted) {
        return;
      }
      await refresh();
    });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const todayEntry = useMemo(
    () => entries.find((entry) => entry.date === todayISO()) ?? null,
    [entries],
  );

  const todayBlocks = useMemo(
    () => blocks.filter((block) => block.date === todayISO() && block.type === "record").sort((a, b) => a.order - b.order),
    [blocks],
  );

  const recordBlocks = useMemo(
    () => blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt),
    [blocks],
  );

  const subjects = useMemo(
    () => (settings ? getAllSubjects(settings, recordBlocks) : []),
    [recordBlocks, settings],
  );

  const activeSubjects = useMemo(
    () => (settings ? getActiveSubjects(settings) : []),
    [settings],
  );

  const ensureEntry = useCallback(
    async (date: string) => {
      const entry = await storage.getOrCreateEntry(date);
      await refresh();
      return entry;
    },
    [refresh],
  );

  const saveEntry = useCallback(
    async (entry: DayEntry) => {
      await storage.saveEntry(entry);
      await refresh();
      await markAutoBackupDirty("entry");
    },
    [refresh],
  );

  const saveBlock = useCallback(
    async (block: Block) => {
      const saved = await storage.saveBlock(block);
      await refresh();
      await markAutoBackupDirty("block");
      if (saved.type === "record") {
        enqueueAutoOcrForRecord(saved, { onAssetChanged: refresh });
      }
    },
    [refresh],
  );

  const deleteBlock = useCallback(
    async (blockId: string) => {
      await storage.deleteBlock(blockId);
      await refresh();
      await markAutoBackupDirty("delete-block");
    },
    [refresh],
  );

  const restoreBlock = useCallback(
    async (blockId: string) => {
      await storage.restoreBlock(blockId);
      await refresh();
      await markAutoBackupDirty("restore-block");
    },
    [refresh],
  );

  const permanentlyDeleteBlock = useCallback(
    async (blockId: string) => {
      await storage.permanentlyDeleteBlock(blockId);
      await refresh();
      await markAutoBackupDirty("permanent-delete-block");
    },
    [refresh],
  );

  const purgeExpiredDeletedBlocks = useCallback(
    async (retentionDays = 30) => {
      const purged = await storage.purgeExpiredDeletedBlocks(retentionDays);
      if (purged > 0) {
        await refresh();
        await markAutoBackupDirty("purge-trash");
      }
      return purged;
    },
    [refresh],
  );

  const toggleRecordFavorite = useCallback(
    async (recordId: string, favorite: boolean) => {
      await storage.toggleRecordFavorite(recordId, favorite);
      await refresh();
      await markAutoBackupDirty("record-favorite");
    },
    [refresh],
  );

  const getRecordDraft = useCallback(async (recordId: string) => storage.getRecordDraft(recordId), []);

  const saveRecordDraft = useCallback(async (draft: Parameters<typeof storage.saveRecordDraft>[0]) => {
    const saved = await storage.saveRecordDraft(draft);
    await markAutoBackupDirty("record-draft");
    return saved;
  }, []);

  const deleteRecordDraft = useCallback(async (recordId: string) => {
    await storage.deleteRecordDraft(recordId);
    await markAutoBackupDirty("record-draft-delete");
  }, []);

  const addRecordToReview = useCallback(
    async (recordId: string, kind?: RecordReviewKind) => {
      const saved = await storage.addRecordToReview(recordId, kind);
      await refresh();
      if (saved) {
        await markAutoBackupDirty("record-review-add");
      }
      return saved;
    },
    [refresh],
  );

  const addRecordsToReview = useCallback(
    async (recordIds: string[], kind?: RecordReviewKind): Promise<RecordReviewBulkResult> => {
      const result = await storage.addRecordsToReview(recordIds, kind);
      await refresh();
      if (result.added + result.reset > 0) {
        await markAutoBackupDirty("record-review-bulk-add");
      }
      return result;
    },
    [refresh],
  );

  const setRecordReviewKind = useCallback(
    async (recordId: string, kind: RecordReviewKind) => {
      const saved = await storage.setRecordReviewKind(recordId, kind);
      await refresh();
      if (saved) {
        await markAutoBackupDirty("record-review-kind");
      }
      return saved;
    },
    [refresh],
  );

  const rateRecordReview = useCallback(
    async (recordId: string, rating: RecordReviewRating, evaluationText?: string) => {
      const result = evaluationText === undefined
        ? await storage.rateRecordReview(recordId, rating)
        : await storage.rateRecordReview(recordId, rating, undefined, evaluationText);
      await refresh();
      if (result) {
        await markAutoBackupDirty("record-review-rate");
      }
      return result;
    },
    [refresh],
  );

  const undoRecordReview = useCallback(
    async (token: RecordReviewUndoToken) => {
      const restored = await storage.undoRecordReview(token);
      if (!restored) {
        throw new Error("这次评分已发生变化，无法撤回");
      }
      await refresh();
      await markAutoBackupDirty("record-review-undo");
      return restored;
    },
    [refresh],
  );

  const resetRecordReview = useCallback(
    async (recordId: string) => {
      const saved = await storage.resetRecordReview(recordId);
      await refresh();
      if (saved) {
        await markAutoBackupDirty("record-review-reset");
      }
      return saved;
    },
    [refresh],
  );

  const removeRecordFromReview = useCallback(
    async (recordId: string) => {
      const saved = await storage.removeRecordFromReview(recordId);
      await refresh();
      if (saved) {
        await markAutoBackupDirty("record-review-remove");
      }
      return saved;
    },
    [refresh],
  );

  const ensureRecordReviewDay = useCallback(
    async (date: string, dueCountAtFirstOpen: number): Promise<RecordReviewDayStat> => {
      const stat = await storage.ensureRecordReviewDay(date, dueCountAtFirstOpen);
      await refresh();
      return stat;
    },
    [refresh],
  );

  const createRecordBlock = useCallback(
    async (date = todayISO(), subject?: Subject, contentHtml = "<p></p>") => {
      const dayBlocks = await storage.listBlocks(date);
      const currentSettings = await storage.getSettings();
      const normalizedSubject = normalizeSubject(subject ?? fallbackSubjectName(currentSettings));
      const subjectCount = dayBlocks.filter(
        (block) => block.type === "record" && block.subject === normalizedSubject,
      ).length;
      const record: RecordBlock = {
        ...createBaseEntity(),
        type: "record",
        date,
        order: dayBlocks.length,
        subject: normalizedSubject,
        tags: [],
        title: nextRecordTitle(normalizedSubject, subjectCount),
        contentHtml,
        assets: [],
        formulas: [],
        mistakeRefs: [],
        favorite: false,
      };
      await storage.saveBlock(record);
      await refresh();
      await markAutoBackupDirty("record-create");
      return record;
    },
    [refresh],
  );

  const createContentTemplate = useCallback(
    async (title = "未命名模板", contentHtml = "<p></p>") => {
      const saved = await storage.saveTemplate({ ...createBaseEntity(), title, contentHtml });
      await refresh();
      await markAutoBackupDirty("template-create");
      return saved;
    },
    [refresh],
  );

  const saveContentTemplate = useCallback(
    async (template: ContentTemplate) => {
      const saved = await storage.saveTemplate(template);
      await refresh();
      await markAutoBackupDirty("template-save");
      return saved;
    },
    [refresh],
  );

  const deleteContentTemplate = useCallback(
    async (templateId: string) => {
      await storage.deleteTemplate(templateId);
      await refresh();
      await markAutoBackupDirty("template-delete");
    },
    [refresh],
  );

  const addRichTextBlock = useCallback(
    async (date = todayISO(), content = "<p></p>") => createRecordBlock(date, undefined, content),
    [createRecordBlock],
  );

  const addTemplate = useCallback(
    async (date = todayISO()) => {
      await storage.getOrCreateEntry(date);
      const existing = await storage.listBlocks(date);
      const templateBlocks = createTemplateBlocks(date, existing.length);
      for (const block of templateBlocks) {
        await storage.saveBlock(block);
      }
      await refresh();
      await markAutoBackupDirty("template");
    },
    [refresh],
  );

  const addTodoBlock = useCallback(
    async (date = todayISO()) => {
      await createRecordBlock(date, undefined, "<h2>待办清单</h2><ul><li>[ ] 写下下一步要做的事</li></ul>");
    },
    [createRecordBlock],
  );

  const addStudySessionBlock = useCallback(
    async (date = todayISO(), subject?: Subject, minutes = 60) => {
      await createRecordBlock(date, normalizeSubject(subject), `<p>学习时长：${minutes} 分钟</p>`);
    },
    [createRecordBlock],
  );

  const addFormulaBlock = useCallback(
    async (date = todayISO()) => {
      const record = await createRecordBlock(date, "数学");
      await storage.saveBlock({
        ...record,
        formulas: [{ id: `${record.id}-formula`, title: "公式", latex: "T(n)=O(n\\log n)" }],
      });
      await refresh();
    },
    [createRecordBlock, refresh],
  );

  const addCodeBlock = useCallback(
    async (date = todayISO()) => {
      await createRecordBlock(date, undefined, "<pre><code>int main() {\n  return 0;\n}</code></pre>");
    },
    [createRecordBlock],
  );

  const addQuoteBlock = useCallback(
    async (date = todayISO()) => {
      await createRecordBlock(date, "政治", "<blockquote>把今天能做清楚的事做清楚。</blockquote>");
    },
    [createRecordBlock],
  );

  const addAssetToRecord = useCallback(
    async (record: RecordBlock, file: File, kind: Asset["kind"], title = file.name) => {
      const asset = await storage.saveAsset(file, kind, title);
      await storage.saveBlock({
        ...record,
        assets: [...record.assets, { id: asset.id, title, kind }],
      });
      setAssetsVersion((version) => version + 1);
      await refresh();
      await markAutoBackupDirty("record-asset");
      return asset;
    },
    [refresh],
  );

  const saveAssetFile = useCallback(async (file: File, kind: Asset["kind"], title = file.name) => {
    const asset = await storage.saveAsset(file, kind, title);
    setAssetsVersion((version) => version + 1);
    await markAutoBackupDirty("asset");
    return asset;
  }, []);

  const renameAssetTitle = useCallback(
    async (assetId: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) {
        return;
      }
      await storage.renameAssetTitle(assetId, nextTitle);
      setAssetsVersion((version) => version + 1);
      await refresh();
      await markAutoBackupDirty("asset-rename");
    },
    [refresh],
  );

  const updateAssetDuration = useCallback(async (assetId: string, durationSeconds: number) => {
    const roundedDuration = Math.max(0, Math.round(durationSeconds));
    const saved = await storage.patchAsset(assetId, { durationSeconds: roundedDuration });
    if (!saved) {
      return;
    }
    setAssets((current) =>
      current.map((asset) =>
        asset.id === assetId
          ? { ...asset, durationSeconds: roundedDuration, updatedAt: saved.updatedAt }
          : asset,
      ),
    );
    setAssetsVersion((version) => version + 1);
  }, []);

  const addAssetBlock = useCallback(
    async (file: File, kind: Asset["kind"], date = todayISO()) => {
      const record = await createRecordBlock(date);
      await addAssetToRecord(record, file, kind);
    },
    [addAssetToRecord, createRecordBlock],
  );

  const addFormulaToRecord = useCallback(
    async (record: RecordBlock, latex: string, title = "公式") => {
      await storage.saveBlock({
        ...record,
        formulas: [...record.formulas, { id: crypto.randomUUID(), latex, title }],
      });
      await refresh();
      await markAutoBackupDirty("settings");
    },
    [refresh],
  );

  const persistSettings = useCallback(
    async (nextSettings: AppSettings) => {
      await storage.saveSettings(nextSettings);
      await refresh();
      await markAutoBackupDirty("record-formula");
    },
    [refresh],
  );

  const saveSubjects = useCallback(
    async (nextSubjects: SubjectConfig[]) => {
      await storage.saveSubjects(nextSubjects);
      await refresh();
      await markAutoBackupDirty("subjects");
    },
    [refresh],
  );

  const addSubject = useCallback(
    async (name: string) => {
      const currentSettings = await storage.getSettings();
      const currentSubjects = getAllSubjects(currentSettings, recordBlocks);
      const validation = validateSubjectName(name, currentSubjects);
      if (validation) {
        throw new Error(validation);
      }
      await storage.saveSubjects([...currentSubjects, createSubjectConfig(name, currentSubjects.length)]);
      await refresh();
      await markAutoBackupDirty("subject-add");
    },
    [recordBlocks, refresh],
  );

  const renameSubject = useCallback(
    async (oldName: Subject, newName: Subject) => {
      const currentSettings = await storage.getSettings();
      const currentSubjects = getAllSubjects(currentSettings, recordBlocks);
      const validation = validateSubjectName(newName, currentSubjects, oldName);
      if (validation) {
        throw new Error(validation);
      }
      await storage.renameSubject(oldName, newName);
      await refresh();
      await markAutoBackupDirty("subject-rename");
    },
    [recordBlocks, refresh],
  );

  const saveKnowledgePodcast = useCallback(async (podcast: KnowledgePodcast) => {
    const saved = await storage.saveKnowledgePodcast?.(podcast);
    await refresh();
    return saved ?? podcast;
  }, [refresh]);

  useEffect(() => subscribeKnowledgePodcastJobs(() => {
    void refresh();
  }), [refresh]);

  useEffect(() => {
    const syncOnVisible = () => {
      if (document.visibilityState === "visible") {
        void syncNativeKnowledgePodcastTtsJobs();
        const user = getCurrentCloudUser();
        if (user) void cleanupCloudRecoverySnapshotsIfDue(user.uid);
      }
    };
    if (document.visibilityState === "visible") {
      const user = getCurrentCloudUser();
      if (user) void cleanupCloudRecoverySnapshotsIfDue(user.uid);
    }
    document.addEventListener("visibilitychange", syncOnVisible);
    return () => document.removeEventListener("visibilitychange", syncOnVisible);
  }, []);

  const deleteKnowledgePodcast = useCallback(async (id: string) => {
    cancelAllKnowledgePodcastJobs(id);
    await storage.deleteKnowledgePodcast?.(id);
    await refresh();
  }, [refresh]);

  const saveLearningCoachSettings = useCallback(async (settings: LearningCoachSettings) => {
    await storage.saveLearningCoachSettings(settings);
    await refresh();
  }, [refresh]);

  const refreshLearningCoachData = useCallback(async () => {
    const [coachSettings, evidence, snapshots, tasks, aiRuns, points, links, extractionRuns, pointSnapshots, relations] = await Promise.all([
      storage.getLearningCoachSettings(), storage.listLearningEvidence(), storage.listLearningCoachSnapshots(), storage.listLearningCoachTasks(), storage.listLearningCoachAiRuns(),
      storage.listKnowledgePoints(), storage.listRecordKnowledgePointLinks(), storage.listKnowledgePointExtractionRuns(), storage.listKnowledgePointCoachSnapshots(),
      storage.listKnowledgeRelations(),
    ]);
    setLearningCoachSettings(coachSettings);
    setLearningEvidence(evidence);
    setLearningCoachSnapshots(snapshots);
    setLearningCoachTasks(tasks);
    setLearningCoachAiRuns(aiRuns);
    setKnowledgePoints(points);
    setRecordKnowledgePointLinks(links);
    setKnowledgePointExtractionRuns(extractionRuns);
    setKnowledgePointCoachSnapshots(pointSnapshots);
    setKnowledgeRelations(relations);
  }, []);

  const computeLearningCoachSnapshot = useCallback(async (date = todayISO()) => {
    const [coachSettings, allBlocks, sessions, reviews, evidence, tasks, existing, snapshots] = await Promise.all([
      storage.getLearningCoachSettings(),
      storage.listBlocks(),
      storage.listStudySessions(),
      storage.listRecordReviews(),
      storage.listLearningEvidence(),
      storage.listLearningCoachTasks(),
      storage.getLearningCoachSnapshot(date),
      storage.listLearningCoachSnapshots(),
    ]);
    if (!coachSettings.dashboardEnabled) return undefined;
    const records = allBlocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt);
    const previousSnapshot = existing ?? snapshots.filter((item) => item.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    const evaluatedAt = new Date().toISOString();
    const projection = buildLearningCoachProjection({
      today: date,
      settings: coachSettings,
      records,
      studySessions: sessions,
      reviews,
      evidence,
      tasks,
      previousDiagnoses: previousSnapshot?.diagnoses,
      evaluatedAt,
    });
    if (existing?.inputFingerprint === projection.inputFingerprint) return existing;
    for (const run of (await storage.listLearningCoachAiRuns()).filter((item) => item.status === "succeeded" && item.inputFingerprint !== projection.inputFingerprint)) {
      await storage.saveLearningCoachAiRun({ ...run, status: "stale" });
    }
    const snapshot: LearningCoachSnapshot = {
      ...(existing ?? createBaseEntity()),
      date,
      scenario: coachSettings.scenario,
      inputFingerprint: projection.inputFingerprint,
      localSummary: projection.summary,
      diagnoses: projection.diagnoses,
      taskIds: existing?.taskIds ?? [],
      evaluatedAt,
      previousSnapshotId: existing?.previousSnapshotId ?? (previousSnapshot && previousSnapshot.id !== existing?.id ? previousSnapshot.id : undefined),
      subjectStates: projection.subjectStates,
      changes: projection.changes,
      aiRunIds: existing?.aiRunIds ?? [],
      aiAnalysis: existing?.aiAnalysis?.inputFingerprint === projection.inputFingerprint ? existing.aiAnalysis : { status: "idle", inputFingerprint: projection.inputFingerprint },
    };
    const saved = await storage.saveLearningCoachSnapshot(snapshot);
    const created: LearningCoachTask[] = [];
    const activeIssueKeys = new Set(projection.diagnoses.filter((item) => item.status !== "resolved").map((item) => item.issueKey));
    for (const task of tasks.filter((item) => item.scope !== "knowledge-point" && (item.status === "pending" || item.status === "in-progress") && item.issueKey && !activeIssueKeys.has(item.issueKey))) {
      await storage.saveLearningCoachTask({ ...normalizeLearningCoachTask(task), status: "cancelled", cancelledAt: evaluatedAt });
    }
    for (const task of projection.tasks) {
      const lastSkipped = tasks.filter((item) => item.issueKey === task.issueKey && item.status === "skipped").sort((a, b) => (b.skippedAt ?? b.updatedAt).localeCompare(a.skippedAt ?? a.updatedAt))[0];
      const deferred = lastSkipped?.deferredUntil && lastSkipped.deferredUntil > date;
      if (deferred) continue;
      const narrowedRecordIds = lastSkipped?.skipReason === "too-large" ? task.recordIds.slice(0, 1) : task.recordIds;
      const narrowed = narrowedRecordIds.length === task.recordIds.length ? task : {
        ...task,
        title: task.title.replace(/\d+ 条/, "1 条"),
        recordIds: narrowedRecordIds,
        action: task.action ? { ...task.action, recordIds: narrowedRecordIds } : task.action,
        completionPolicy: task.completionPolicy ? { ...task.completionPolicy, targetRecordIds: narrowedRecordIds } : task.completionPolicy,
      };
      const savedTask = await storage.saveLearningCoachTask({
        ...createBaseEntity(),
        snapshotId: saved.id,
        date,
        source: "rule",
        status: "pending",
        ...(lastSkipped?.skipReason === "too-large" ? { parentTaskId: lastSkipped.id, replanKey: `${lastSkipped.id}:too-large:${[...narrowed.recordIds].sort().join(",")}` } : {}),
        ...narrowed,
      });
      created.push(savedTask);
    }
    if (created.length > 0) {
      await storage.saveLearningCoachSnapshot({ ...saved, taskIds: [...saved.taskIds, ...created.map((task) => task.id)] });
    }
    await refreshLearningCoachData();
    return saved;
  }, [refreshLearningCoachData]);

  const ensureLearningCoachSnapshot = useCallback((date = todayISO()) => {
    if (coachRunRef.current) return coachRunRef.current;
    const run = computeLearningCoachSnapshot(date).finally(() => {
      if (coachRunRef.current === run) coachRunRef.current = undefined;
    });
    coachRunRef.current = run;
    return run;
  }, [computeLearningCoachSnapshot]);

  const computeKnowledgePointCoachSnapshot = useCallback(async (date = todayISO()) => {
    const [points, links, allBlocks, reviews, reviewLogs, evidence, tasks, existing, snapshots, recordSnapshot, relations] = await Promise.all([
      storage.listKnowledgePoints(),
      storage.listRecordKnowledgePointLinks(),
      storage.listBlocks(),
      storage.listRecordReviews(),
      storage.listRecordReviewLogs(),
      storage.listLearningEvidence(),
      storage.listLearningCoachTasks(),
      storage.getKnowledgePointCoachSnapshot(date),
      storage.listKnowledgePointCoachSnapshots(),
      storage.getLearningCoachSnapshot(date),
      storage.listKnowledgeRelations(),
    ]);
    const coachSettings = await storage.getLearningCoachSettings();
    if (!coachSettings.dashboardEnabled) return undefined;
    const records = allBlocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt);
    const evaluatedAt = new Date().toISOString();
    const { buildKnowledgePointProjection } = await import("../services/knowledgePointService");
    const projection = buildKnowledgePointProjection({
      today: date,
      points,
      links,
      records,
      reviews,
      reviewLogs,
      evidence,
      tasks,
      recordDiagnoses: recordSnapshot?.diagnoses ?? [],
      previousDiagnoses: existing?.diagnoses ?? snapshots.find((snapshot) => snapshot.date < date)?.diagnoses,
      evaluatedAt,
    });
    const currentDecision = buildLearningCoachDecision({ diagnoses: projection.diagnoses, tasks: tasks.filter((task) => task.scope === "knowledge-point"), relations, knowledgePoints: points, reviews, evidence, evaluatedAt });
    if (existing?.inputFingerprint === projection.inputFingerprint) {
      if (recordSnapshot && recordSnapshot.decision?.decisionInputsFingerprint !== currentDecision.decisionInputsFingerprint) {
        await storage.saveLearningCoachSnapshot({ ...recordSnapshot, decision: currentDecision });
      }
      return existing;
    }
    const base: KnowledgePointCoachSnapshot = {
      ...(existing ?? createBaseEntity()),
      date,
      inputFingerprint: projection.inputFingerprint,
      evaluatedAt,
      states: projection.states,
      diagnoses: projection.diagnoses,
      taskIds: existing?.taskIds ?? [],
      previousSnapshotId: existing?.previousSnapshotId ?? snapshots.find((snapshot) => snapshot.date < date)?.id,
    };
    let saved = await storage.saveKnowledgePointCoachSnapshot(base);
    const activeIssueKeys = new Set(projection.diagnoses.filter((item) => item.status !== "resolved").map((item) => item.issueKey));
    for (const task of tasks.filter((item) => item.scope === "knowledge-point" && (item.status === "pending" || item.status === "in-progress") && item.issueKey && !activeIssueKeys.has(item.issueKey))) {
      await storage.saveLearningCoachTask({ ...normalizeLearningCoachTask(task), status: "cancelled", activeSlotKey: undefined, cancelledAt: evaluatedAt, cancellationReason: "issue-resolved" });
    }
    const created: LearningCoachTask[] = [];
    for (const draft of projection.tasks) {
      const task = await storage.saveLearningCoachTask({
        ...createBaseEntity(),
        snapshotId: saved.id,
        date,
        source: "rule",
        status: "pending",
        ...draft,
      });
      created.push(task);
    }
    if (created.length > 0) saved = await storage.saveKnowledgePointCoachSnapshot({ ...saved, taskIds: [...saved.taskIds, ...created.map((task) => task.id)] });
    const decision = buildLearningCoachDecision({ diagnoses: projection.diagnoses, tasks: [...tasks.filter((task) => task.scope === "knowledge-point"), ...created], relations, knowledgePoints: points, reviews, evidence, evaluatedAt });
    if (recordSnapshot && recordSnapshot.decision?.decisionInputsFingerprint !== decision.decisionInputsFingerprint) {
      await storage.saveLearningCoachSnapshot({ ...recordSnapshot, decision });
    }
    await refreshLearningCoachData();
    return saved;
  }, [refreshLearningCoachData]);

  const ensureKnowledgePointCoachSnapshot = useCallback((date = todayISO()) => {
    if (knowledgePointRunRef.current) return knowledgePointRunRef.current;
    const run = computeKnowledgePointCoachSnapshot(date).finally(() => {
      if (knowledgePointRunRef.current === run) knowledgePointRunRef.current = undefined;
    });
    knowledgePointRunRef.current = run;
    return run;
  }, [computeKnowledgePointCoachSnapshot]);

  const startLearningCoachAction = useCallback(async (taskId: string, createdRecordId?: string) => {
    const task = await storage.listLearningCoachTasks().then((items) => items.find((item) => item.id === taskId));
    if (!task || task.status !== "pending") return undefined;
    const occurredAt = new Date().toISOString();
    const started = startLearningCoachTask(task, occurredAt, createdRecordId);
    await storage.saveLearningCoachTask(started);
    await storage.saveLearningEvidence(createTaskLifecycleEvidence(started, "task-started", occurredAt));
    await refreshLearningCoachData();
    return started;
  }, [refreshLearningCoachData]);

  const skipLearningCoachAction = useCallback(async (taskId: string, reason: LearningCoachSkipReason, note?: string) => {
    const task = await storage.listLearningCoachTasks().then((items) => items.find((item) => item.id === taskId));
    if (!task || (task.status !== "pending" && task.status !== "in-progress")) return undefined;
    const occurredAt = new Date().toISOString();
    const skipped = skipLearningCoachTask(task, reason, occurredAt, note);
    const evidence = createTaskLifecycleEvidence(skipped, "task-skipped", occurredAt);
    const saved = await storage.completeLearningCoachTask(taskId, "skipped", evidence);
    if (saved) await storage.saveLearningCoachTask({ ...skipped, skippedEvidenceId: evidence.id });
    await refreshLearningCoachData();
    return saved;
  }, [refreshLearningCoachData]);

  const reconcileLearningCoachTasks = useCallback(async () => {
    const [tasks, allBlocks, logs, evidence, pointLinks] = await Promise.all([
      storage.listLearningCoachTasks(), storage.listBlocks(), storage.listRecordReviewLogs(), storage.listLearningEvidence(), storage.listRecordKnowledgePointLinks(),
    ]);
    const records = allBlocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt);
    let changed = false;
    for (const task of tasks.filter((item) => item.status === "in-progress")) {
      const result = evaluateLearningCoachTask({ task, records, reviewLogs: logs, evidence, knowledgePointLinks: pointLinks });
      if (result.complete) {
        const occurredAt = new Date().toISOString();
        const lifecycleEvidence = createTaskLifecycleEvidence(result.task, "task-outcome", occurredAt);
        lifecycleEvidence.supportingEvidenceRefs = result.supportingEvidenceRefs;
        lifecycleEvidence.payload = { ...lifecycleEvidence.payload, supportingEvidenceIds: result.evidenceIds, supportingEvidenceRefs: result.supportingEvidenceRefs };
        await storage.saveLearningCoachTask(result.task);
        await storage.completeLearningCoachTask(task.id, "completed", lifecycleEvidence);
        changed = true;
      } else if (JSON.stringify(result.task.progress) !== JSON.stringify(task.progress)) {
        await storage.saveLearningCoachTask(result.task);
        changed = true;
      }
    }
    if (changed) await refreshLearningCoachData();
    return changed;
  }, [refreshLearningCoachData]);

  const completeLearningCoachTask = useCallback(async (taskId: string, status: "completed" | "skipped") => {
    if (status === "skipped") return skipLearningCoachAction(taskId, "other");
    await reconcileLearningCoachTasks();
    return storage.listLearningCoachTasks().then((items) => items.find((item) => item.id === taskId));
  }, [reconcileLearningCoachTasks, skipLearningCoachAction]);

  useEffect(() => {
    if (!initialized || !learningCoachSettings?.dashboardEnabled) return;
    const timer = window.setTimeout(() => {
      void reconcileLearningCoachTasks().then(() => ensureLearningCoachSnapshot()).then(() => ensureKnowledgePointCoachSnapshot());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [initialized, learningCoachSettings?.dashboardEnabled, blocks, studySessions, recordReviews, recordReviewLogs, learningEvidence, recordKnowledgePointLinks, reconcileLearningCoachTasks, ensureLearningCoachSnapshot, ensureKnowledgePointCoachSnapshot]);

  const requestLearningCoachAiAnalysis = useCallback(async (date = todayISO()) => {
    const snapshot = await ensureLearningCoachSnapshot(date) ?? await storage.getLearningCoachSnapshot(date);
    if (!snapshot || !settings) return undefined;
    const currentSettings = await storage.getLearningCoachSettings();
    if (!currentSettings.dashboardEnabled) return undefined;
    const requestedAt = new Date().toISOString();
    const runBase: LearningCoachAiRun = {
      ...createBaseEntity(), date, snapshotId: snapshot.id, inputFingerprint: snapshot.inputFingerprint,
      issueKeys: snapshot.diagnoses.filter((item) => item.status !== "resolved").map((item) => item.issueKey).filter((item): item is string => Boolean(item)),
      status: "running", phase: "preparing-context", sourceRecords: [], requestedAt,
    };
    await storage.saveLearningCoachAiRun(runBase);
    try {
      const recordIds = Array.from(new Set(snapshot.diagnoses.filter((item) => item.status !== "resolved").flatMap((diagnosis) => diagnosis.recordIds))).slice(0, 10);
      const context = recordIds.length > 0 ? await buildAiKnowledgeContextPackAsync({ kind: "records", recordIds }, blocks, assets, "学习教练诊断") : undefined;
      const sourceRecords = Array.from(new Map((context?.selectedChunks ?? []).map((chunk) => [chunk.recordId, { recordId: chunk.recordId, subject: chunk.subject, date: chunk.date, title: chunk.title, sourceLabel: chunk.sourceLabel }])).values());
      await storage.saveLearningCoachAiRun({ ...runBase, phase: "calling-provider", sourceRecords });
      const pointSnapshot = await storage.getKnowledgePointCoachSnapshot(date);
      const result = await requestLearningCoachAnalysis({ ai: settings.ai, snapshot, context, knowledgePoints, knowledgePointDiagnoses: pointSnapshot?.diagnoses });
      const availableRecordIds = new Set(
        context?.scope?.kind === "records"
          ? context.scope.recordIds
          : (context?.selectedChunks ?? []).map((chunk) => chunk.recordId),
      );
      const knownSubjects = new Set<string>([
        ...CANONICAL_STUDY_SUBJECTS,
        ...blocks
          .filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt)
          .map((record) => canonicalStudySubject(record.subject)),
      ]);
      await storage.saveLearningCoachAiRun({ ...runBase, phase: "validating-result", sourceRecords });
      const candidateTasks = result.candidateTasks.filter((candidate) =>
            (!candidate.subject || knownSubjects.has(canonicalStudySubject(candidate.subject))) &&
            candidate.title.trim().length > 0 &&
            candidate.recordIds.every((recordId) => availableRecordIds.has(recordId)),
          ).map((candidate) => ({ ...candidate, issueKey: candidate.issueKey && runBase.issueKeys.includes(candidate.issueKey) ? candidate.issueKey : runBase.issueKeys[0] }));
      const relationProposals = result.relationProposals?.filter((proposal) => new Set(knowledgePoints.filter((point) => point.status === "active").map((point) => point.id)).has(proposal.fromKnowledgePointId) && new Set(knowledgePoints.filter((point) => point.status === "active").map((point) => point.id)).has(proposal.toKnowledgePointId)) ?? [];
      const saved = await storage.saveLearningCoachAiRun({ ...runBase, status: "succeeded", phase: undefined, sourceRecords, completedAt: new Date().toISOString(), analysis: result.content, candidateTasks, relationProposals });
      await storage.saveLearningCoachSnapshot({ ...snapshot, aiRunIds: [...(snapshot.aiRunIds ?? []), saved.id] });
      await refresh();
      return saved;
    } catch (error) {
      const saved = await storage.saveLearningCoachAiRun({ ...runBase, status: "failed", phase: undefined, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "AI 分析失败。" });
      await refresh();
      return saved;
    }
  }, [assets, blocks, ensureLearningCoachSnapshot, knowledgePoints, refresh, settings]);

  const acceptLearningCoachCandidateTask = useCallback(async (runId: string, index: number) => {
    const run = await storage.listLearningCoachAiRuns().then((items) => items.find((item) => item.id === runId));
    const snapshot = run ? await storage.getLearningCoachSnapshot(run.date) : undefined;
    const candidate = run?.candidateTasks?.[index];
    if (!snapshot || !run || run.status !== "succeeded" || !candidate || run.inputFingerprint !== snapshot.inputFingerprint) return undefined;
    const records = blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt);
    const recordById = new Map(records.map((record) => [record.id, record]));
    const subject = candidate.subject ? canonicalStudySubject(candidate.subject) : undefined;
    if (!candidate.title.trim() || candidate.recordIds.some((recordId) => !recordById.has(recordId))) return undefined;
    if (subject && !new Set(records.map((record) => canonicalStudySubject(record.subject))).has(subject)) return undefined;
    const workflow = resolveLearningCoachCandidateWorkflow({ ...candidate, subject });
    const saved = await storage.saveLearningCoachTask({
      ...createBaseEntity(),
      snapshotId: snapshot.id,
      date: run.date,
      subject,
      kind: workflow.kind,
      source: "ai-proposal",
      proposalStatus: "accepted",
      status: "pending",
      priority: 3,
      reasonCode: snapshot.diagnoses.find((item) => item.issueKey === candidate.issueKey)?.code ?? "subject-gap",
      title: candidate.title,
      recordIds: candidate.recordIds,
      actionLabel: workflow.actionLabel,
      reason: candidate.reason,
      issueKey: candidate.issueKey,
      action: workflow.action,
      completionPolicy: workflow.completionPolicy,
    });
    await storage.saveLearningCoachSnapshot({
      ...snapshot,
      taskIds: [...snapshot.taskIds, saved.id],
    });
    await storage.saveLearningCoachAiRun({ ...run, candidateTasks: run.candidateTasks?.filter((_, candidateIndex) => candidateIndex !== index) });
    await refresh();
    return saved;
  }, [refresh]);

  const decideKnowledgeRelationProposal = useCallback(async (runId: string, proposalId: string, decision: "accepted" | "rejected") => {
    const saved = await storage.decideKnowledgeRelationProposal(runId, proposalId, decision);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  const createKnowledgePointLink = useCallback(async (input: Parameters<typeof storage.createKnowledgePointLink>[0]) => {
    const saved = await storage.createKnowledgePointLink(input);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  const removeKnowledgePointLink = useCallback(async (linkId: string) => {
    const saved = await storage.removeRecordKnowledgePointLink(linkId);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  const mergeKnowledgePoints = useCallback(async (sourceId: string, targetId: string) => {
    const saved = await storage.mergeKnowledgePoints(sourceId, targetId);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  const undoKnowledgePointMerge = useCallback(async (sourceId: string) => {
    const saved = await storage.undoKnowledgePointMerge(sourceId);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  const saveKnowledgeRelation = useCallback(async (relation: KnowledgeRelation) => {
    const saved = await storage.saveKnowledgeRelation(relation);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  const retireKnowledgeRelation = useCallback(async (relationId: string) => {
    const saved = await storage.retireKnowledgeRelation(relationId);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  const requestKnowledgePointExtraction = useCallback(async (recordId: string) => {
    const record = blocks.find((block): block is RecordBlock => block.type === "record" && block.id === recordId && !block.deletedAt);
    if (!record || !settings) return undefined;
    const inputFingerprint = recordKnowledgeFingerprint(record);
    const catalogFingerprint = knowledgePointCatalogFingerprint(knowledgePoints);
    const existingRuns = await storage.listKnowledgePointExtractionRuns(recordId);
    for (const old of existingRuns.filter((run) => run.status === "succeeded" && (run.inputFingerprint !== inputFingerprint || run.catalogFingerprint !== catalogFingerprint))) {
      await storage.saveKnowledgePointExtractionRun({ ...old, status: "stale", proposals: old.proposals.map((proposal) => proposal.decision === "pending" ? { ...proposal, decision: "stale" } : proposal) });
    }
    const requestedAt = new Date().toISOString();
    const run: KnowledgePointExtractionRun = {
      ...createBaseEntity(),
      recordId,
      subject: canonicalStudySubject(record.subject),
      inputFingerprint,
      catalogFingerprint,
      status: "running",
      phase: "preparing-context",
      requestedAt,
      proposals: [],
    };
    await storage.saveKnowledgePointExtractionRun(run);
    await refreshLearningCoachData();
    try {
      const context = await buildAiKnowledgeContextPackAsync({ kind: "records", recordIds: [record.id] }, blocks, assets, `知识点提取：${record.title}`);
      await storage.saveKnowledgePointExtractionRun({ ...run, phase: "calling-provider" });
      const { requestKnowledgePointProposals } = await import("../services/knowledgePointAiService");
      const proposals = await requestKnowledgePointProposals({ ai: settings.ai, record, catalog: knowledgePoints, context });
      const saved = await storage.saveKnowledgePointExtractionRun({ ...run, phase: "validating-result", status: "succeeded", completedAt: new Date().toISOString(), proposals });
      await refreshLearningCoachData();
      return saved;
    } catch (error) {
      const failed = await storage.saveKnowledgePointExtractionRun({ ...run, status: "failed", phase: undefined, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "知识点提取失败。" });
      await refreshLearningCoachData();
      return failed;
    }
  }, [assets, blocks, knowledgePoints, refreshLearningCoachData, settings]);

  const decideKnowledgePointProposal = useCallback(async (runId: string, proposalId: string, decision: "accepted" | "rejected", existingKnowledgePointId?: string) => {
    const saved = await storage.decideKnowledgePointProposal(runId, proposalId, decision, existingKnowledgePointId);
    await refreshLearningCoachData();
    await ensureKnowledgePointCoachSnapshot();
    return saved;
  }, [ensureKnowledgePointCoachSnapshot, refreshLearningCoachData]);

  return {
    initialized,
    entries,
    blocks,
    assets,
    templates,
    settings,
    autoBackupState,
    podcasts,
    deletedRecords,
    recordReviews,
    dueRecordReviews,
    recordReviewLogs,
    recordReviewStats,
    studySessions,
    learningCoachSettings,
    learningEvidence,
    learningCoachSnapshots,
    learningCoachTasks,
    learningCoachAiRuns,
    knowledgePoints,
    recordKnowledgePointLinks,
    knowledgePointExtractionRuns,
    knowledgePointCoachSnapshots,
    knowledgeRelations,
    subjects,
    activeSubjects,
    todayEntry,
    todayBlocks,
    assetsVersion,
    refresh,
    ensureEntry,
    saveEntry,
    saveBlock,
    deleteBlock,
    restoreBlock,
    permanentlyDeleteBlock,
    purgeExpiredDeletedBlocks,
    toggleRecordFavorite,
    getRecordDraft,
    saveRecordDraft,
    deleteRecordDraft,
    addRecordToReview,
    addRecordsToReview,
    setRecordReviewKind,
    rateRecordReview,
    undoRecordReview,
    resetRecordReview,
    removeRecordFromReview,
    ensureRecordReviewDay,
    addRichTextBlock,
    createRecordBlock,
    createContentTemplate,
    saveContentTemplate,
    deleteContentTemplate,
    addTemplate,
    addTodoBlock,
    addStudySessionBlock,
    addFormulaBlock,
    addCodeBlock,
    addQuoteBlock,
    addAssetBlock,
    addAssetToRecord,
    saveAssetFile,
    renameAssetTitle,
    updateAssetDuration,
    addFormulaToRecord,
    persistSettings,
    saveSubjects,
    addSubject,
    renameSubject,
    saveKnowledgePodcast,
    deleteKnowledgePodcast,
    saveLearningCoachSettings,
    ensureLearningCoachSnapshot,
    completeLearningCoachTask,
    startLearningCoachAction,
    skipLearningCoachAction,
    reconcileLearningCoachTasks,
    requestLearningCoachAiAnalysis,
    acceptLearningCoachCandidateTask,
    ensureKnowledgePointCoachSnapshot,
    createKnowledgePointLink,
    removeKnowledgePointLink,
    mergeKnowledgePoints,
    undoKnowledgePointMerge,
    saveKnowledgeRelation,
    retireKnowledgeRelation,
    decideKnowledgeRelationProposal,
    requestKnowledgePointExtraction,
    decideKnowledgePointProposal,
  };
};
