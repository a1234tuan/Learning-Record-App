import type {
  AppSettings,
  Asset,
  BackupManifest,
  Block,
  CloudSyncEntityType,
  ContentTemplate,
  DayEntry,
  RecordDraft,
  RecordReviewDayStat,
  RecordReviewLog,
  RecordReviewState,
  StorageSnapshot,
  StudySession,
  Tag,
} from "../types";
import { DEFAULT_SETTINGS } from "../db/defaults";
import { nowISO } from "../lib/date";

export interface CloudSyncEntity {
  key: string;
  entityType: CloudSyncEntityType;
  entityId: string;
  contentHash: string;
  payload: Record<string, unknown>;
  deleted?: boolean;
  /** Content-addressed Storage object for payloads too large for Firestore. */
  payloadDocumentHash?: string;
  payloadByteSize?: number;
}

export interface CloudReviewEvent {
  id: string;
  contentHash: string;
  payload: Record<string, unknown>;
}

export interface CloudSyncExport {
  entities: CloudSyncEntity[];
  reviewEvents: CloudReviewEvent[];
  assetBlobs: Map<string, Blob>;
}

/**
 * Entity types excluded from cross-device conflict detection because their
 * content changes on its own (review scheduling state, or settings fields
 * like autoBackup bookkeeping) without representing a genuine user edit.
 * Touching one of these on both sides should never force a manual "keep
 * local or cloud" choice — whichever side syncs last simply wins.
 */
export const NON_CONFLICTING_ENTITY_TYPES = new Set<CloudSyncEntityType>(["review-state", "review-day-stat", "settings", "template"]);

type JsonRecord = Record<string, unknown>;

export const CLOUD_DOCUMENT_THRESHOLD_BYTES = 750 * 1024;

export interface CloudPayloadDocument {
  hash: string;
  byteSize: number;
  blob: Blob;
}

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as JsonRecord)
      .sort()
      .reduce<JsonRecord>((result, key) => {
        const next = (value as JsonRecord)[key];
        if (next !== undefined) {
          result[key] = sortValue(next);
        }
        return result;
      }, {});
  }
  return value;
};

const fallbackHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv-${(hash >>> 0).toString(16)}`;
};

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");

const digest = async (bytes: ArrayBuffer, fallbackSource: string) => {
  if (globalThis.crypto?.subtle) {
    return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  }
  return fallbackHash(fallbackSource);
};

export const stableJson = (value: unknown) => JSON.stringify(sortValue(value));

export const hashValue = async (value: unknown) => {
  const source = stableJson(value);
  return digest(new TextEncoder().encode(source).buffer as ArrayBuffer, source);
};

/**
 * Firestore documents have a 1 MiB ceiling. Keep a margin and store large
 * structured payloads in Storage, addressed by the same hash as the entity.
 */
export const createCloudPayloadDocument = async (entity: CloudSyncEntity): Promise<CloudPayloadDocument | undefined> => {
  if (entity.deleted || entity.payloadDocumentHash) return undefined;
  const source = stableJson(entity.payload);
  const bytes = new TextEncoder().encode(source);
  if (bytes.byteLength <= CLOUD_DOCUMENT_THRESHOLD_BYTES) return undefined;
  const hash = await hashValue(entity.payload);
  if (hash !== entity.contentHash) {
    throw new Error(`同步实体 ${entity.key} 的内容哈希不一致。`);
  }
  return {
    hash,
    byteSize: bytes.byteLength,
    blob: new Blob([bytes], { type: "application/json" }),
  };
};

export const withCloudPayloadDocument = (entity: CloudSyncEntity, document: CloudPayloadDocument): CloudSyncEntity => ({
  ...entity,
  payload: {},
  payloadDocumentHash: document.hash,
  payloadByteSize: document.byteSize,
});

const blobArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
  const direct = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (direct) return direct.call(blob);
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取同步资源。"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
};

export const hashBlob = async (blob: Blob) => {
  const bytes = await blobArrayBuffer(blob);
  return digest(bytes, `${blob.type}:${blob.size}`);
};

const entity = async (
  entityType: CloudSyncEntityType,
  value: { id: string; deletedAt?: string },
): Promise<CloudSyncEntity> => {
  const payload = sortValue(value) as JsonRecord;
  return {
    key: `${entityType}:${value.id}`,
    entityType,
    entityId: value.id,
    contentHash: await hashValue(payload),
    payload,
    deleted: Boolean(value.deletedAt),
  };
};

const mapEntities = async <T extends { id: string; deletedAt?: string }>(
  entityType: CloudSyncEntityType,
  values: T[],
): Promise<CloudSyncEntity[]> => Promise.all(values.map((value) => entity(entityType, value)));

export const exportCloudSync = async (snapshot: StorageSnapshot): Promise<CloudSyncExport> => {
  const ordinary = await Promise.all([
    mapEntities("entry", snapshot.payload.entries),
    mapEntities("block", snapshot.payload.blocks),
    mapEntities("template", snapshot.payload.templates ?? []),
    mapEntities("draft", snapshot.payload.recordDrafts ?? snapshot.recordDrafts ?? []),
    mapEntities("tag", snapshot.payload.tags),
    mapEntities("study-session", snapshot.payload.studySessions),
    mapEntities("review-state", snapshot.payload.recordReviews ?? []),
    mapEntities("review-day-stat", snapshot.payload.recordReviewDayStats ?? []),
  ]);
  const settings = await entity("settings", snapshot.payload.settings);
  const assetBlobs = new Map<string, Blob>();
  const assets = await Promise.all(
    snapshot.assets.map(async (asset) => {
      const { data, ...meta } = asset;
      const assetHash = await hashBlob(data);
      assetBlobs.set(assetHash, data);
      return entity("asset", { ...meta, id: asset.id, contentHash: assetHash } as Asset & { contentHash: string });
    }),
  );
  const reviewEvents = await Promise.all(
    (snapshot.payload.recordReviewLogs ?? []).map(async (log) => ({
      id: log.id,
      contentHash: await hashValue(log),
      payload: sortValue(log) as JsonRecord,
    })),
  );
  return { entities: [...ordinary.flat(), settings, ...assets], reviewEvents, assetBlobs };
};

const values = <T>(entities: CloudSyncEntity[], type: CloudSyncEntityType) =>
  entities.filter((entity) => entity.entityType === type && !entity.deleted).map((entity) => entity.payload as unknown as T);

const manifestFor = (entities: CloudSyncEntity[], reviewEvents: CloudReviewEvent[]): BackupManifest => {
  const count = (type: CloudSyncEntityType) => entities.filter((entity) => entity.entityType === type && !entity.deleted).length;
  return {
    format: "study-journal",
    version: 5,
    exportedAt: nowISO(),
    appVersion: "0.1.0",
    counts: {
      entries: count("entry"),
      blocks: count("block"),
      mistakes: 0,
      assets: count("asset"),
      tags: count("tag"),
      reviews: 0,
      studySessions: count("study-session"),
      templates: count("template"),
      recordReviews: count("review-state"),
      recordReviewLogs: reviewEvents.length,
      recordReviewDayStats: count("review-day-stat"),
    },
  };
};

export const materializeCloudSyncSnapshot = (
  entities: CloudSyncEntity[],
  reviewEvents: CloudReviewEvent[],
  assetBlobs: Map<string, Blob>,
): StorageSnapshot => {
  const assetValues = values<Omit<Asset, "data"> & { contentHash?: string }>(entities, "asset").map((asset) => {
    const { contentHash, ...meta } = asset;
    const data = contentHash ? assetBlobs.get(contentHash) : undefined;
    if (!data) {
      throw new Error(`云端资源不完整：${asset.fileName}。`);
    }
    return { ...meta, data } as Asset;
  });
  const settings = values<AppSettings>(entities, "settings")[0] ?? DEFAULT_SETTINGS;
  const recordDrafts = values<RecordDraft>(entities, "draft");
  return {
    payload: {
      manifest: manifestFor(entities, reviewEvents),
      entries: values<DayEntry>(entities, "entry"),
      blocks: values<Block>(entities, "block"),
      templates: values<ContentTemplate>(entities, "template"),
      recordDrafts,
      mistakes: [],
      tags: values<Tag>(entities, "tag"),
      reviews: [],
      recordReviews: values<RecordReviewState>(entities, "review-state"),
      recordReviewLogs: reviewEvents.map((event) => event.payload as unknown as RecordReviewLog),
      recordReviewDayStats: values<RecordReviewDayStat>(entities, "review-day-stat"),
      studySessions: values<StudySession>(entities, "study-session"),
      settings,
    },
    assets: assetValues,
    recordDrafts,
  };
};

export const mergeCloudSyncEntities = (
  current: CloudSyncEntity[],
  updates: CloudSyncEntity[],
) => {
  const byKey = new Map(current.map((entity) => [entity.key, entity]));
  updates.forEach((entity) => byKey.set(entity.key, entity));
  return [...byKey.values()];
};
