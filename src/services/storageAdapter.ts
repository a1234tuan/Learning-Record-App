import { liveQuery } from "dexie";

import type {
  AiChatMessage,
  AiChatSession,
  AiSecret,
  AppSettings,
  Asset,
  Block,
  DayEntry,
  MistakeCard,
  RecordBlock,
  ReviewSchedule,
  StorageAdapter,
  StorageSnapshot,
  Subject,
  SubjectConfig,
  StudySession,
  Tag,
} from "../types";
import { db } from "../db/database";
import { DEFAULT_SETTINGS, DEFAULT_TAGS, createDayEntry } from "../db/defaults";
import { nowISO, todayISO } from "../lib/date";
import { createBaseEntity, touch } from "../lib/entity";
import { migrateBlocksToRecords } from "../lib/recordMigration";
import { hasLinearRecordNodes, syncRecordRefsFromContent } from "../lib/recordContent";
import { ensureSettingsSubjects, normalizeSubjectName } from "../lib/subjects";

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
    await this.resetStaleOcrJobs(10 * 60 * 1000);
    await this.getOrCreateEntry(todayISO());
  }

  private async recordBlocks(): Promise<RecordBlock[]> {
    return (await db.blocks.toArray()).filter((block): block is RecordBlock => block.type === "record");
  }

  private async cleanupOrphanAssetsForRecord(record: RecordBlock): Promise<void> {
    const candidateAssetIds = new Set(record.assets.map((asset) => asset.id));
    if (candidateAssetIds.size === 0) {
      return;
    }

    const blocks = await db.blocks.toArray();
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
    if (settings.ai?.presets?.length) {
      return;
    }
    const defaultAi = DEFAULT_SETTINGS.ai;
    if (!defaultAi) {
      return;
    }
    await db.settings.put({
      ...settings,
      ai: {
        ...defaultAi,
        ...settings.ai,
        memoryTurns: settings.ai?.memoryTurns ?? defaultAi.memoryTurns ?? 12,
        presets: settings.ai?.presets?.length ? settings.ai.presets : defaultAi.presets,
      },
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
    await db.blocks.put(saved);

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

  async deleteBlock(blockId: string): Promise<void> {
    const block = await db.blocks.get(blockId);
    if (!block) {
      return;
    }
    await db.blocks.put({ ...block, deletedAt: nowISO(), updatedAt: nowISO() });
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

    await db.transaction("rw", db.blocks, db.assets, db.studySessions, async () => {
      await db.blocks.delete(blockId);
      await db.studySessions.where("blockId").equals(blockId).delete();
      if (block.type === "record") {
        await this.cleanupOrphanAssetsForRecord(block);
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
    ] = await Promise.all([
      db.entries.toArray(),
      db.blocks.toArray(),
      db.tags.toArray(),
      db.studySessions.toArray(),
      this.getSettings(),
      db.assets.toArray(),
    ]);
    const cleanedBlocks: Block[] = blocks.map((block) =>
      block.type === "record" ? { ...block, mistakeRefs: [] as string[] } : block,
    );

    return {
      payload: {
        manifest: {
          format: "study-journal",
          version: 3,
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
          },
        },
        entries,
        blocks: cleanedBlocks,
        mistakes: [],
        tags,
        reviews: [],
        studySessions,
        settings: ensureSettingsSubjects(settings, cleanedBlocks.filter((block): block is RecordBlock => block.type === "record")),
      },
      assets,
    };
  }

  async restoreSnapshot(snapshot: StorageSnapshot): Promise<void> {
    await db.transaction(
      "rw",
      [db.entries, db.blocks, db.mistakes, db.tags, db.reviews, db.studySessions, db.settings, db.assets],
      async () => {
        await Promise.all([
          db.entries.clear(),
          db.blocks.clear(),
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
          db.tags.bulkPut(snapshot.payload.tags),
          db.studySessions.bulkPut(snapshot.payload.studySessions),
          db.settings.put(ensureSettingsSubjects({ ...snapshot.payload.settings, schemaVersion: 3 }, restoredRecords)),
          db.assets.bulkPut(snapshot.assets),
        ]);
      },
    );
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
    await db.transaction("rw", db.aiSessions, db.aiMessages, async () => {
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

  async getAiSecret(): Promise<AiSecret | undefined> {
    return db.aiSecrets.get("default");
  }

  async saveAiSecret(apiKey: string): Promise<AiSecret> {
    const secret: AiSecret = {
      id: "default",
      apiKey,
      updatedAt: nowISO(),
    };
    await db.aiSecrets.put(secret);
    return secret;
  }

  async clearAiSecret(): Promise<void> {
    await db.aiSecrets.delete("default");
  }
}

export const storage = new DexieStorageAdapter();

export const observeEntries = () => liveQuery(() => storage.listEntries());
export const observeMistakes = () => liveQuery(() => storage.listMistakes());
