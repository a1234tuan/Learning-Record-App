import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AppSettings,
  Asset,
  Block,
  DayEntry,
  RecordBlock,
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
  validateSubjectName,
} from "../lib/subjects";
import { enqueueAutoOcrForRecord } from "../services/ocrJobService";
import { markAutoBackupDirty, onAppBackgroundAutoBackup } from "../services/autoBackupService";

export const useAppData = () => {
  const [initialized, setInitialized] = useState(false);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [deletedRecords, setDeletedRecords] = useState<RecordBlock[]>([]);
  const [assetsVersion, setAssetsVersion] = useState(0);

  const refresh = useCallback(async () => {
    const [entryList, blockList, currentSettings, assetList, deletedList] = await Promise.all([
      storage.listEntries(),
      storage.listBlocks(),
      storage.getSettings(),
      storage.listAssets(),
      storage.listDeletedBlocks(),
    ]);
    setEntries(entryList);
    setBlocks(blockList);
    setSettings(currentSettings);
    setAssets(assetList);
    setDeletedRecords(deletedList);
  }, []);

  useEffect(() => {
    let mounted = true;
    void storage.initialize().then(async () => {
      if (!mounted) {
        return;
      }
      await refresh();
      setInitialized(true);
      await storage.purgeExpiredDeletedBlocks(30);
      await refresh();
      await markAutoBackupDirty("app-start");
    });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void onAppBackgroundAutoBackup();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

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

  return {
    initialized,
    entries,
    blocks,
    assets,
    settings,
    deletedRecords,
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
    addRichTextBlock,
    createRecordBlock,
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
  };
};
