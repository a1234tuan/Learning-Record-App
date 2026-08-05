import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import type { User } from "firebase/auth";
import { getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { WriteBatch } from "firebase/firestore";
import { deleteObject, getBlob, getMetadata, listAll, ref, uploadBytesResumable } from "firebase/storage";
import type { StorageReference } from "firebase/storage";

import type { CloudSyncEntityType, CloudSyncLedgerRecord, CloudSyncStateRecord, ImportOptions } from "../types";
import { db } from "../db/database";
import { newId } from "../lib/entity";
import { isDesktopPlatform, isNativePlatform } from "../lib/platform";
import { firebaseAuth, firebaseStorage, firestore, googleAuthProvider } from "./firebase";
import {
  exportCloudSync,
  createCloudPayloadDocument,
  hashValue,
  materializeCloudSyncSnapshot,
  mergeCloudSyncEntities,
  withCloudPayloadDocument,
  type CloudReviewEvent,
  type CloudSyncEntity,
  type CloudSyncExport,
} from "./cloudSyncModel";
import { storage } from "./storageAdapter";
import { snapshotToZip, summarizeSnapshot, zipToSnapshot } from "./backup";

const PROTOCOL_VERSION = 2;
const MAX_BATCH_WRITES = 400;
const LOCK_DURATION_MS = 30 * 60 * 1000;
const SNAPSHOT_LIMIT = 5;
const DESKTOP_AUTH_TIMEOUT_MS = 90_000;
const LEGACY_SNAPSHOT_FILE = "snapshots/current.zip";
const LEGACY_METADATA_DOCUMENT = "current";

type RemoteSyncState = {
  protocolVersion: number;
  headRevision: number;
  nextRevision: number;
  lock?: { deviceId: string; expiresAt: number } | null;
};

type RemoteEntity = CloudSyncEntity & { revision: number };
type RemoteReviewEvent = CloudReviewEvent & { revision: number };

export interface CloudSnapshotInfo {
  updatedAt: string;
  byteSize: number;
  version: number;
}

export interface CloudSyncStatus {
  protocolVersion: number;
  cloudRevision: number;
  localPending: number;
  remotePending: number;
  snapshotCount: number;
  legacySnapshotAvailable: boolean;
  lastSyncedAt?: string;
}

export interface CloudRecoverySnapshot {
  id: string;
  createdAt: string;
  label: string;
  entityCount: number;
  revision: number;
}

export interface CloudSyncProgress {
  stage: "checking" | "downloading" | "uploading" | "applying" | "snapshot" | "done";
  message: string;
  current?: number;
  total?: number;
}

export type CloudSyncConflictChoice = "local" | "cloud";

export interface CloudSyncConflict {
  reason: "concurrent-changes" | "legacy-snapshot";
  localChanges: number;
  remoteChanges: number;
  cloudRevision: number;
}

export type CloudSyncResult =
  | { kind: "synced"; uploaded: number; downloaded: number; revision: number; pending: number; restored?: boolean }
  | { kind: "conflict"; conflict: CloudSyncConflict };

export interface CloudSyncOptions {
  onProgress?: (progress: CloudSyncProgress) => void;
}

export interface CloudDownloadOptions {
  onImportProgress?: ImportOptions["onProgress"];
}

const stateRef = (uid: string) => doc(firestore, "users", uid, "syncState", "current");
const entitiesRef = (uid: string) => collection(firestore, "users", uid, "syncEntities");
const entityRef = (uid: string, key: string) => doc(firestore, "users", uid, "syncEntities", key);
const reviewEventsRef = (uid: string) => collection(firestore, "users", uid, "syncReviewEvents");
const reviewEventRef = (uid: string, id: string) => doc(firestore, "users", uid, "syncReviewEvents", id);
const snapshotsRef = (uid: string) => collection(firestore, "users", uid, "syncSnapshots");
const snapshotRef = (uid: string, id: string) => doc(firestore, "users", uid, "syncSnapshots", id);
const snapshotEntitiesRef = (uid: string, id: string) => collection(firestore, "users", uid, "syncSnapshots", id, "entities");
const assetRef = (uid: string, hash: string) => ref(firebaseStorage, `users/${uid}/assets/${hash}`);
const assetsRootRef = (uid: string) => ref(firebaseStorage, `users/${uid}/assets`);
const documentRef = (uid: string, hash: string) => ref(firebaseStorage, `users/${uid}/documents/${hash}`);
const documentsRootRef = (uid: string) => ref(firebaseStorage, `users/${uid}/documents`);
const legacyMetadataRef = (uid: string) => doc(firestore, "users", uid, "cloudSync", LEGACY_METADATA_DOCUMENT);
const legacySnapshotRef = (uid: string) => ref(firebaseStorage, `users/${uid}/${LEGACY_SNAPSHOT_FILE}`);

const getCloudStorageBlob = async (uid: string, storageRef: StorageReference): Promise<Blob> => {
  const desktopStorage = isDesktopPlatform() ? window.studyJournalDesktop?.firebaseStorage : undefined;
  const user = firebaseAuth.currentUser;
  if (!desktopStorage || !user || user.uid !== uid) {
    return getBlob(storageRef);
  }
  const { data, contentType } = await desktopStorage.download(uid, storageRef.fullPath, await user.getIdToken());
  return new Blob([data], { type: contentType });
};

const progress = (options: CloudSyncOptions, stage: CloudSyncProgress["stage"], message: string, current?: number, total?: number) =>
  options.onProgress?.({ stage, message, current, total });

const parseLegacySnapshotInfo = (value: unknown): CloudSnapshotInfo | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.updatedAt !== "string" || typeof data.byteSize !== "number" || typeof data.version !== "number") return undefined;
  return { updatedAt: data.updatedAt, byteSize: data.byteSize, version: data.version };
};

const emptyRemoteState = (): RemoteSyncState => ({ protocolVersion: PROTOCOL_VERSION, headRevision: 0, nextRevision: 0, lock: null });

const parseRemoteState = (value: unknown): RemoteSyncState => {
  if (!value || typeof value !== "object") return emptyRemoteState();
  const data = value as Record<string, unknown>;
  return {
    protocolVersion: typeof data.protocolVersion === "number" ? data.protocolVersion : PROTOCOL_VERSION,
    headRevision: typeof data.headRevision === "number" ? data.headRevision : 0,
    nextRevision: typeof data.nextRevision === "number" ? data.nextRevision : 0,
    lock: data.lock && typeof data.lock === "object" ? data.lock as RemoteSyncState["lock"] : null,
  };
};

const parseRemoteEntity = (id: string, value: unknown): RemoteEntity | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (
    typeof data.entityType !== "string" ||
    typeof data.entityId !== "string" ||
    typeof data.contentHash !== "string" ||
    typeof data.revision !== "number" ||
    !data.payload || typeof data.payload !== "object"
  ) return undefined;
  return {
    key: id,
    entityType: data.entityType as CloudSyncEntityType,
    entityId: data.entityId,
    contentHash: data.contentHash,
    payload: data.payload as Record<string, unknown>,
    deleted: Boolean(data.deleted),
    payloadDocumentHash: typeof data.payloadDocumentHash === "string" ? data.payloadDocumentHash : undefined,
    payloadByteSize: typeof data.payloadByteSize === "number" ? data.payloadByteSize : undefined,
    revision: data.revision,
  };
};

const parseRemoteReviewEvent = (id: string, value: unknown): RemoteReviewEvent | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.contentHash !== "string" || typeof data.revision !== "number" || !data.payload || typeof data.payload !== "object") return undefined;
  return { id, contentHash: data.contentHash, payload: data.payload as Record<string, unknown>, revision: data.revision };
};

const ledgerId = (type: CloudSyncEntityType | "review-event", id: string) => `${type}:${id}`;

const newDeviceId = () => globalThis.crypto?.randomUUID?.() ?? newId();

const localState = async (uid: string): Promise<CloudSyncStateRecord> => {
  const existing = await db.cloudSyncState.get("state");
  if (existing?.userId === uid) return existing;
  const next: CloudSyncStateRecord = {
    id: "state",
    deviceId: existing?.deviceId ?? newDeviceId(),
    userId: uid,
    lastPulledRevision: 0,
    lastReviewEventRevision: 0,
  };
  await db.transaction("rw", db.cloudSyncState, db.cloudSyncLedger, async () => {
    await db.cloudSyncLedger.clear();
    await db.cloudSyncState.put(next);
  });
  return next;
};

const ledgerFor = async () => db.cloudSyncLedger.toArray();

const tombstoneFor = async (ledger: CloudSyncLedgerRecord): Promise<CloudSyncEntity> => ({
  key: ledger.id,
  entityType: ledger.entityType as CloudSyncEntityType,
  entityId: ledger.entityId,
  contentHash: `deleted:${ledger.contentHash}`,
  payload: {},
  deleted: true,
});

const localChanges = async (exported: CloudSyncExport, ledger: CloudSyncLedgerRecord[]) => {
  const byKey = new Map(ledger.map((item) => [item.id, item]));
  const entities = exported.entities.filter((item) => byKey.get(item.key)?.contentHash !== item.contentHash);
  const present = new Set(exported.entities.map((item) => item.key));
  const removed = await Promise.all(
    ledger
      .filter((item) => item.entityType !== "review-event" && !present.has(item.id) && !item.contentHash.startsWith("deleted:"))
      .map(tombstoneFor),
  );
  const events = exported.reviewEvents.filter((item) => byKey.get(ledgerId("review-event", item.id))?.contentHash !== item.contentHash);
  return { entities: [...entities, ...removed], events };
};

const hasRecoverableLocalData = (exported: CloudSyncExport) => exported.entities.some((entity) => entity.entityType !== "settings") || exported.reviewEvents.length > 0;

const getRemoteState = async (uid: string) => {
  const snapshot = await getDoc(stateRef(uid));
  return { exists: snapshot.exists(), state: parseRemoteState(snapshot.data()) };
};

const getRemoteChanges = async (uid: string, afterRevision: number, state: RemoteSyncState) => {
  if (state.headRevision <= afterRevision) return { entities: [] as RemoteEntity[], reviewEvents: [] as RemoteReviewEvent[] };
  const [entities, reviewEvents] = await Promise.all([
    getDocs(query(entitiesRef(uid), where("revision", ">", afterRevision), where("revision", "<=", state.headRevision), orderBy("revision"))),
    getDocs(query(reviewEventsRef(uid), where("revision", ">", afterRevision), where("revision", "<=", state.headRevision), orderBy("revision"))),
  ]);
  return {
    entities: entities.docs.map((item) => parseRemoteEntity(item.id, item.data())).filter((item): item is RemoteEntity => Boolean(item)),
    reviewEvents: reviewEvents.docs.map((item) => parseRemoteReviewEvent(item.id, item.data())).filter((item): item is RemoteReviewEvent => Boolean(item)),
  };
};

const getAllRemote = async (uid: string, state: RemoteSyncState) => {
  const [entities, reviewEvents] = await Promise.all([getDocs(entitiesRef(uid)), getDocs(reviewEventsRef(uid))]);
  return {
    entities: entities.docs
      .map((item) => parseRemoteEntity(item.id, item.data()))
      .filter((item): item is RemoteEntity => Boolean(item && item.revision <= state.headRevision)),
    reviewEvents: reviewEvents.docs
      .map((item) => parseRemoteReviewEvent(item.id, item.data()))
      .filter((item): item is RemoteReviewEvent => Boolean(item && item.revision <= state.headRevision)),
  };
};

const hydratePayloadDocuments = async <T extends CloudSyncEntity>(uid: string, entities: T[], options: CloudSyncOptions): Promise<T[]> => {
  const documents = entities.filter((entity) => !entity.deleted && entity.payloadDocumentHash);
  if (documents.length === 0) return entities;
  return Promise.all(entities.map(async (entity) => {
    const documentHash = entity.payloadDocumentHash;
    if (entity.deleted || !documentHash) return entity;
    const index = documents.findIndex((item) => item.key === entity.key) + 1;
    progress(options, "downloading", `正在下载大文本 ${index}/${documents.length}。`, index, documents.length);
    const content = await (await getCloudStorageBlob(uid, documentRef(uid, documentHash))).text();
    let payload: unknown;
    try {
      payload = JSON.parse(content);
    } catch {
      throw new Error(`云端大文本 ${entity.key} 无法解析。`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`云端大文本 ${entity.key} 的格式无效。`);
    }
    const actualHash = await hashValue(payload);
    if (actualHash !== documentHash || actualHash !== entity.contentHash) {
      throw new Error(`云端大文本 ${entity.key} 的完整性校验失败。`);
    }
    return { ...entity, payload: payload as Record<string, unknown> };
  }));
};

const ASSET_DOWNLOAD_TIMEOUT_MS = 120_000;
const ASSET_DOWNLOAD_CONCURRENCY = 5;

const downloadRemoteAssets = async (uid: string, entities: CloudSyncEntity[], existing: Map<string, Blob>, options: CloudSyncOptions) => {
  const pending = [
    ...new Set(
      entities
        .filter((e) => e.entityType === "asset" && !e.deleted)
        .map((e) => e.payload.contentHash)
        .filter((h): h is string => typeof h === "string" && !existing.has(h)),
    ),
  ];
  const total = pending.length;
  let completed = 0;
  for (let i = 0; i < total; i += ASSET_DOWNLOAD_CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + ASSET_DOWNLOAD_CONCURRENCY).map(async (hash) => {
        if (existing.has(hash)) return;
        try {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("下载超时，请检查网络连接、代理设置后重试。")), ASSET_DOWNLOAD_TIMEOUT_MS);
          });
          try {
            existing.set(hash, await Promise.race([getCloudStorageBlob(uid, assetRef(uid, hash)), timeout]));
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
          completed++;
          progress(options, "downloading", `正在下载资源 ${completed}/${total}。`, completed, total);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(`资源下载失败（${completed + 1}/${total}），请确认网络可连接 Firebase Storage 后重试。（${detail}）`);
        }
      }),
    );
  }
};

const mergeReviewEvents = (current: CloudReviewEvent[], updates: CloudReviewEvent[]) => {
  const byId = new Map(current.map((event) => [event.id, event]));
  updates.forEach((event) => byId.set(event.id, event));
  return [...byId.values()];
};

const applyRemote = async (
  uid: string,
  current: CloudSyncExport,
  updates: { entities: RemoteEntity[]; reviewEvents: RemoteReviewEvent[] },
  options: CloudSyncOptions,
) => {
  const mergedEntities = await hydratePayloadDocuments(uid, mergeCloudSyncEntities(current.entities, updates.entities), options);
  const mergedEvents = mergeReviewEvents(current.reviewEvents, updates.reviewEvents);
  const assetBlobs = new Map(current.assetBlobs);
  await downloadRemoteAssets(uid, mergedEntities, assetBlobs, options);
  progress(options, "applying", "正在一次性应用云端更改。");
  await storage.restoreCloudSyncSnapshot(materializeCloudSyncSnapshot(mergedEntities, mergedEvents, assetBlobs));
};

const acquireLock = async (uid: string, deviceId: string) => runTransaction(firestore, async (transaction) => {
  const reference = stateRef(uid);
  const current = parseRemoteState((await transaction.get(reference)).data());
  const now = Date.now();
  if (current.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error("云端同步协议版本不兼容，请先使用新版应用完成迁移。");
  }
  if (current.lock && current.lock.deviceId !== deviceId && current.lock.expiresAt > now) {
    throw new Error("另一台设备正在同步，请稍后再试。");
  }
  const revision = Math.max(current.nextRevision, current.headRevision) + 1;
  transaction.set(reference, {
    ...current,
    protocolVersion: PROTOCOL_VERSION,
    nextRevision: revision,
    lock: { deviceId, expiresAt: now + LOCK_DURATION_MS },
  });
  return { revision, previousHead: current.headRevision };
});

const releaseLock = async (uid: string, deviceId: string, revision: number, publish: boolean) => runTransaction(firestore, async (transaction) => {
  const reference = stateRef(uid);
  const current = parseRemoteState((await transaction.get(reference)).data());
  if (current.lock?.deviceId !== deviceId) {
    throw new Error("同步锁已失效，未发布的数据将留待重试。");
  }
  transaction.set(reference, {
    ...current,
    protocolVersion: PROTOCOL_VERSION,
    headRevision: publish ? revision : current.headRevision,
    nextRevision: Math.max(current.nextRevision, revision),
    lock: null,
  });
});

const writeInBatches = async (writes: Array<(batch: WriteBatch) => void>) => {
  for (let index = 0; index < writes.length; index += MAX_BATCH_WRITES) {
    const batch = writeBatch(firestore);
    writes.slice(index, index + MAX_BATCH_WRITES).forEach((write) => write(batch));
    await batch.commit();
  }
};

const ASSET_UPLOAD_CONCURRENCY = 5;

const uploadAssets = async (
  uid: string,
  entities: CloudSyncEntity[],
  assetBlobs: Map<string, Blob>,
  options: CloudSyncOptions,
) => {
  const hashes = [...new Set(entities
    .filter((entity) => entity.entityType === "asset" && !entity.deleted)
    .map((entity) => entity.payload.contentHash)
    .filter((hash): hash is string => typeof hash === "string"))];
  const missing = (
    await Promise.all(
      hashes.map(async (hash) => {
        try {
          await getMetadata(assetRef(uid, hash));
          return null;
        } catch (e) {
          if ((e as { code?: string }).code !== "storage/object-not-found") throw e;
          return hash;
        }
      }),
    )
  ).filter((h): h is string => h !== null);
  let transferred = 0;
  for (let i = 0; i < missing.length; i += ASSET_UPLOAD_CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + ASSET_UPLOAD_CONCURRENCY).map(async (hash) => {
        const blob = assetBlobs.get(hash);
        if (!blob) throw new Error("本地资源缓存不完整，无法同步。");
        const task = uploadBytesResumable(assetRef(uid, hash), blob, { contentType: blob.type || "application/octet-stream" });
        let taskTransferred = 0;
        await new Promise<void>((resolve, reject) => task.on("state_changed", (snapshot) => {
          // Firebase reports bytesTransferred as a cumulative value for this
          // upload task. Add only the delta from the previous callback; adding
          // the cumulative value repeatedly makes a 90 MB upload look like
          // hundreds of megabytes in the UI.
          const delta = Math.max(0, snapshot.bytesTransferred - taskTransferred);
          taskTransferred = Math.max(taskTransferred, snapshot.bytesTransferred);
          transferred += delta;
          progress(options, "uploading", `正在上传资源 ${(transferred / (1024 * 1024)).toFixed(1)} MB。`);
        }, reject, resolve));
      }),
    );
  }
};

const uploadLargePayloadDocuments = async <T extends CloudSyncEntity>(
  uid: string,
  entities: T[],
  options: CloudSyncOptions,
): Promise<T[]> => {
  const prepared = await Promise.all(entities.map(async (entity) => {
    const document = await createCloudPayloadDocument(entity);
    return document ? { entity: { ...entity, ...withCloudPayloadDocument(entity, document) } as T, document } : { entity };
  }));
  const documents = prepared.filter((item): item is { entity: T; document: NonNullable<Awaited<ReturnType<typeof createCloudPayloadDocument>>> } => Boolean(item.document));
  const missingDocs = (
    await Promise.all(
      documents.map(async (item) => {
        try {
          await getMetadata(documentRef(uid, item.document.hash));
          return null;
        } catch (e) {
          if ((e as { code?: string }).code !== "storage/object-not-found") throw e;
          return item;
        }
      }),
    )
  ).filter((item): item is (typeof documents)[number] => item !== null);
  await Promise.all(
    missingDocs.map((item, index) => {
      progress(options, "uploading", `正在上传大文本 ${index + 1}/${missingDocs.length}。`, index + 1, missingDocs.length);
      return uploadBytesResumable(documentRef(uid, item.document.hash), item.document.blob, { contentType: "application/json" });
    }),
  );
  return prepared.map((item) => item.entity);
};

const persistLedgers = async (state: CloudSyncStateRecord, entities: RemoteEntity[], events: RemoteReviewEvent[], revision: number) => {
  const rows: CloudSyncLedgerRecord[] = [
    ...entities.map((entity) => ({
      id: entity.key,
      entityType: entity.entityType,
      entityId: entity.entityId,
      contentHash: entity.contentHash,
      cloudRevision: entity.revision,
      assetHash: entity.entityType === "asset" && typeof entity.payload.contentHash === "string" ? entity.payload.contentHash : undefined,
    })),
    ...events.map((event) => ({
      id: ledgerId("review-event", event.id),
      entityType: "review-event" as const,
      entityId: event.id,
      contentHash: event.contentHash,
      cloudRevision: event.revision,
    })),
  ];
  await db.transaction("rw", db.cloudSyncState, db.cloudSyncLedger, async () => {
    if (rows.length) await db.cloudSyncLedger.bulkPut(rows);
    await db.cloudSyncState.put({
      ...state,
      lastPulledRevision: Math.max(state.lastPulledRevision, revision),
      lastReviewEventRevision: Math.max(state.lastReviewEventRevision, revision),
      lastSyncedAt: new Date().toISOString(),
    });
  });
};

const resetLedgers = async (state: CloudSyncStateRecord) => {
  await db.transaction("rw", db.cloudSyncState, db.cloudSyncLedger, async () => {
    await db.cloudSyncLedger.clear();
    await db.cloudSyncState.put({ ...state, lastPulledRevision: 0, lastReviewEventRevision: 0, lastSyncedAt: undefined });
  });
};

const resetAndPersistLedgers = async (state: CloudSyncStateRecord, entities: RemoteEntity[], events: RemoteReviewEvent[], revision: number) => {
  const rows: CloudSyncLedgerRecord[] = [
    ...entities.map((entity) => ({
      id: entity.key,
      entityType: entity.entityType,
      entityId: entity.entityId,
      contentHash: entity.contentHash,
      cloudRevision: entity.revision,
      assetHash: entity.entityType === "asset" && typeof entity.payload.contentHash === "string" ? entity.payload.contentHash : undefined,
    })),
    ...events.map((event) => ({
      id: ledgerId("review-event", event.id),
      entityType: "review-event" as const,
      entityId: event.id,
      contentHash: event.contentHash,
      cloudRevision: event.revision,
    })),
  ];
  await db.transaction("rw", db.cloudSyncState, db.cloudSyncLedger, async () => {
    await db.cloudSyncLedger.clear();
    if (rows.length) await db.cloudSyncLedger.bulkPut(rows);
    await db.cloudSyncState.put({
      ...state,
      lastPulledRevision: revision,
      lastReviewEventRevision: revision,
      lastSyncedAt: new Date().toISOString(),
    });
  });
};

const toRemoteEntity = (entity: CloudSyncEntity, revision: number): RemoteEntity => ({ ...entity, revision });
const toRemoteReviewEvent = (event: CloudReviewEvent, revision: number): RemoteReviewEvent => ({ ...event, revision });
type AcquiredLock = { revision: number; previousHead: number };

const activeEntityDocument = (entity: RemoteEntity) => ({
  entityType: entity.entityType,
  entityId: entity.entityId,
  contentHash: entity.contentHash,
  payload: entity.payload,
  ...(entity.payloadDocumentHash ? {
    payloadDocumentHash: entity.payloadDocumentHash,
    payloadByteSize: entity.payloadByteSize,
  } : {}),
  deleted: Boolean(entity.deleted),
  revision: entity.revision,
  updatedAt: new Date().toISOString(),
});

const snapshotEntityDocument = (entity: RemoteEntity) => ({
  key: entity.key,
  ...activeEntityDocument(entity),
  kind: "entity",
});

const publish = async (
  user: User,
  state: CloudSyncStateRecord,
  exported: CloudSyncExport,
  changed: { entities: CloudSyncEntity[]; events: CloudReviewEvent[] },
  options: CloudSyncOptions,
  heldLock?: AcquiredLock,
) => {
  if (changed.entities.length === 0 && changed.events.length === 0) {
    if (heldLock) await releaseLock(user.uid, state.deviceId, heldLock.revision, false);
    return { revision: heldLock?.previousHead ?? state.lastPulledRevision, uploaded: 0 };
  }
  const lock = heldLock ?? await acquireLock(user.uid, state.deviceId);
  try {
    await uploadAssets(user.uid, changed.entities, exported.assetBlobs, options);
    progress(options, "uploading", "正在提交同步元数据。", 0, changed.entities.length + changed.events.length);
    const storedEntities = await uploadLargePayloadDocuments(user.uid, changed.entities, options);
    const remoteEntities = storedEntities.map((entity) => toRemoteEntity(entity, lock.revision));
    const remoteEvents = changed.events.map((event) => toRemoteReviewEvent(event, lock.revision));
    await writeInBatches([
      ...remoteEntities.map((entity) => (batch: WriteBatch) => batch.set(entityRef(user.uid, entity.key), activeEntityDocument(entity))),
      ...remoteEvents.map((event) => (batch: WriteBatch) => batch.set(reviewEventRef(user.uid, event.id), {
        contentHash: event.contentHash,
        payload: event.payload,
        revision: event.revision,
        updatedAt: new Date().toISOString(),
      })),
    ]);
    await persistLedgers(state, remoteEntities, remoteEvents, lock.revision);
    await releaseLock(user.uid, state.deviceId, lock.revision, true);
    return { revision: lock.revision, uploaded: remoteEntities.length + remoteEvents.length };
  } catch (error) {
    await releaseLock(user.uid, state.deviceId, lock.revision, false).catch(() => undefined);
    throw error;
  }
};

const makeRemoteSnapshot = async (uid: string, label: string, entities: RemoteEntity[], events: RemoteReviewEvent[], revision: number, options: CloudSyncOptions) => {
  const id = `${Date.now()}-${newId()}`;
  progress(options, "snapshot", "正在创建恢复快照。");
  const snapshotEntities = await uploadLargePayloadDocuments(uid, entities, options);
  await setDoc(snapshotRef(uid, id), {
    createdAt: new Date().toISOString(),
    label,
    entityCount: snapshotEntities.length + events.length,
    revision,
  });
  await writeInBatches([
    ...snapshotEntities.map((entity) => (batch: WriteBatch) => batch.set(doc(snapshotEntitiesRef(uid, id), entity.key), snapshotEntityDocument(entity))),
    ...events.map((event) => (batch: WriteBatch) => batch.set(doc(snapshotEntitiesRef(uid, id), `review-event:${event.id}`), { ...event, kind: "review-event" })),
  ]);
  const snapshots = await getDocs(query(snapshotsRef(uid), orderBy("createdAt", "desc")));
  const expired = snapshots.docs.slice(SNAPSHOT_LIMIT);
  for (const item of expired) {
    const children = await getDocs(snapshotEntitiesRef(uid, item.id));
    await writeInBatches([
      ...children.docs.map((child) => (batch: WriteBatch) => batch.delete(child.ref)),
      (batch: WriteBatch) => batch.delete(item.ref),
    ]);
  }
  if (expired.length > 0) {
    await cleanUpUnreferencedStorage(uid).catch(() => undefined);
  }
  return id;
};

const referencedAssetHash = (entity: CloudSyncEntity) =>
  entity.entityType === "asset" && !entity.deleted && typeof entity.payload.contentHash === "string"
    ? entity.payload.contentHash
    : undefined;

const collectSnapshotEntities = async (uid: string) => {
  const snapshots = await getDocs(snapshotsRef(uid));
  const children = await Promise.all(snapshots.docs.map((snapshot) => getDocs(snapshotEntitiesRef(uid, snapshot.id))));
  return children.flatMap((items) => items.docs
    .map((item) => parseRemoteEntity(item.id, item.data()))
    .filter((item): item is RemoteEntity => Boolean(item)));
};

/** Remove blobs that are no longer referenced by the active set or any retained recovery snapshot. */
const cleanUpUnreferencedStorage = async (uid: string) => {
  const remote = await getRemoteState(uid);
  const active = remote.exists ? (await getAllRemote(uid, remote.state)).entities : [];
  const snapshots = await collectSnapshotEntities(uid);
  const referenced = [...active, ...snapshots];
  const assetHashes = new Set(referenced.map(referencedAssetHash).filter((hash): hash is string => Boolean(hash)));
  const documentHashes = new Set(referenced
    .filter((entity) => !entity.deleted && entity.payloadDocumentHash)
    .map((entity) => entity.payloadDocumentHash as string));
  const [assets, documents] = await Promise.all([listAll(assetsRootRef(uid)), listAll(documentsRootRef(uid))]);
  await Promise.all([
    ...assets.items.filter((item) => !assetHashes.has(item.name)).map((item) => deleteObject(item)),
    ...documents.items.filter((item) => !documentHashes.has(item.name)).map((item) => deleteObject(item)),
  ]);
};

const makeLocalSnapshot = async (user: User, exported: CloudSyncExport, label: string, revision: number, options: CloudSyncOptions) => {
  const entities = exported.entities.map((entity) => toRemoteEntity(entity, revision));
  const events = exported.reviewEvents.map((event) => toRemoteReviewEvent(event, revision));
  await uploadAssets(user.uid, entities, exported.assetBlobs, options);
  return makeRemoteSnapshot(user.uid, label, entities, events, revision, options);
};

const replaceCloudWithLocal = async (user: User, state: CloudSyncStateRecord, options: CloudSyncOptions) => {
  const exported = await exportCloudSync(await storage.createCloudSyncSnapshot());
  const lock = await acquireLock(user.uid, state.deviceId);
  let lockReleased = false;
  try {
    const remote = await getRemoteState(user.uid);
    const allRemote = await getAllRemote(user.uid, remote.state);
    await makeRemoteSnapshot(user.uid, "冲突前的云端版本", allRemote.entities, allRemote.reviewEvents, remote.state.headRevision, options);
    const localKeys = new Set(exported.entities.map((entity) => entity.key));
    const tombstones = allRemote.entities
      .filter((entity) => !localKeys.has(entity.key) && !entity.deleted && entity.entityType !== "review-state" && entity.entityType !== "review-day-stat")
      .map((entity) => ({ ...entity, contentHash: `deleted:${entity.contentHash}`, payload: {}, deleted: true }));
    const result = await publish(user, state, exported, { entities: [...exported.entities, ...tombstones], events: exported.reviewEvents }, options, lock);
    lockReleased = true;
    return result;
  } catch (error) {
    if (!lockReleased) {
      await releaseLock(user.uid, state.deviceId, lock.revision, false).catch(() => undefined);
    }
    throw error;
  }
};

const restoreRemote = async (uid: string, options: CloudSyncOptions) => {
  const remote = await getRemoteState(uid);
  if (!remote.exists || remote.state.headRevision === 0) throw new Error("云端没有可恢复的增量同步数据。");
  const all = await getAllRemote(uid, remote.state);
  all.entities = await hydratePayloadDocuments(uid, all.entities, options);
  const assetBlobs = new Map<string, Blob>();
  await downloadRemoteAssets(uid, all.entities, assetBlobs, options);
  progress(options, "applying", "正在恢复云端数据。");
  await storage.restoreCloudSyncSnapshot(materializeCloudSyncSnapshot(all.entities, all.reviewEvents, assetBlobs));
  return { state: remote.state, ...all };
};

export const listenToCloudUser = (listener: (user: User | null) => void) => onAuthStateChanged(firebaseAuth, listener);

export const completeGoogleRedirect = async (): Promise<User | null> => {
  if (isNativePlatform()) return null;
  const result = await getRedirectResult(firebaseAuth);
  return result?.user ?? null;
};

const signInWithNativeGoogle = async (): Promise<User> => {
  const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
  const idToken = result.credential?.idToken;
  if (!idToken) {
    throw new Error("Google 登录未返回身份令牌。请确认 Android 应用的 SHA-1 指纹和 google-services.json 已更新。");
  }
  const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken ?? null);
  const userCredential = await signInWithCredential(firebaseAuth, credential);
  return userCredential.user;
};

const signInWithDesktopOAuth = async (): Promise<User> => {
  const result = await window.studyJournalDesktop!.auth.signInWithGoogle();
  const credential = GoogleAuthProvider.credential(result.idToken);
  const userCredential = await signInWithCredential(firebaseAuth, credential);
  return userCredential.user;
};

export const signInToCloudSync = async (): Promise<User> => {
  if (isNativePlatform()) return signInWithNativeGoogle();
  if (isDesktopPlatform()) return signInWithDesktopOAuth();
  const popupPromise = signInWithPopup(firebaseAuth, googleAuthProvider);
  const userCredential = await new Promise<Awaited<typeof popupPromise>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Google 登录窗口未能打开或在 90 秒内完成。请确认使用最新 Desktop 安装包，并允许访问 study-journal-408-9f31.firebaseapp.com。"));
    }, DESKTOP_AUTH_TIMEOUT_MS);
    popupPromise.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
  return userCredential.user;
};

export const signOutOfCloudSync = async (): Promise<void> => {
  if (isNativePlatform()) {
    try {
      await FirebaseAuthentication.signOut();
    } finally {
      await signOut(firebaseAuth);
    }
    return;
  }
  await signOut(firebaseAuth);
};

export const getCloudSnapshotInfo = async (uid: string): Promise<CloudSnapshotInfo | undefined> => {
  const snapshot = await getDoc(legacyMetadataRef(uid));
  return snapshot.exists() ? parseLegacySnapshotInfo(snapshot.data()) : undefined;
};

export const getCloudSyncStatus = async (user: User): Promise<CloudSyncStatus> => {
  const [local, remote, legacy, exported, ledger, snapshots] = await Promise.all([
    localState(user.uid),
    getRemoteState(user.uid),
    getCloudSnapshotInfo(user.uid),
    exportCloudSync(await storage.createCloudSyncSnapshot()),
    ledgerFor(),
    getDocs(snapshotsRef(user.uid)),
  ]);
  const changed = await localChanges(exported, ledger);
  const remoteChanges = remote.exists ? await getRemoteChanges(user.uid, local.lastPulledRevision, remote.state) : { entities: [], reviewEvents: [] };
  return {
    protocolVersion: remote.state.protocolVersion,
    cloudRevision: remote.state.headRevision,
    localPending: changed.entities.length + changed.events.length,
    remotePending: remoteChanges.entities.length + remoteChanges.reviewEvents.length,
    snapshotCount: snapshots.size,
    legacySnapshotAvailable: Boolean(legacy && !remote.exists),
    lastSyncedAt: local.lastSyncedAt,
  };
};

export const synchronizeCloudChanges = async (user: User, options: CloudSyncOptions = {}): Promise<CloudSyncResult> => {
  progress(options, "checking", "正在检查本机和云端的更改。");
  const [state, initialRemote, legacy, initialSnapshot, ledger] = await Promise.all([
    localState(user.uid),
    getRemoteState(user.uid),
    getCloudSnapshotInfo(user.uid),
    storage.createCloudSyncSnapshot(),
    ledgerFor(),
  ]);
  const initialExport = await exportCloudSync(initialSnapshot);
  const firstEmptyDevice = ledger.length === 0 && !hasRecoverableLocalData(initialExport);
  let lock: AcquiredLock | undefined;
  let lockReleased = false;
  let restored = false;
  try {
    lock = await acquireLock(user.uid, state.deviceId);
    if (!initialRemote.exists && legacy && hasRecoverableLocalData(initialExport)) {
      await releaseLock(user.uid, state.deviceId, lock.revision, false);
      lockReleased = true;
      return { kind: "conflict", conflict: { reason: "legacy-snapshot", localChanges: initialExport.entities.length, remoteChanges: 1, cloudRevision: 0 } };
    }

    if (!initialRemote.exists && legacy && firstEmptyDevice) {
      progress(options, "downloading", "正在迁移旧版云端备份。", 0, 1);
      const archive = await getCloudStorageBlob(user.uid, legacySnapshotRef(user.uid));
      const snapshot = await zipToSnapshot(new File([archive], "study-journal-cloud-sync.zip", { type: "application/zip" }));
      await storage.restoreCloudSyncSnapshot(snapshot);
      restored = true;
    }

    const remote = await getRemoteState(user.uid);
    const remoteChanges = remote.exists ? await getRemoteChanges(user.uid, state.lastPulledRevision, remote.state) : { entities: [], reviewEvents: [] };
    const changed = await localChanges(restored ? await exportCloudSync(await storage.createCloudSyncSnapshot()) : initialExport, ledger);
    const normalLocal = (firstEmptyDevice ? [] : changed.entities)
      .filter((entity) => entity.entityType !== "review-state" && entity.entityType !== "review-day-stat");
    const normalRemote = remoteChanges.entities.filter((entity) => entity.entityType !== "review-state" && entity.entityType !== "review-day-stat");
    const localKeys = new Set(normalLocal.map((e) => e.key));
    const hasConflict = normalLocal.length > 0 && normalRemote.some((e) => localKeys.has(e.key));
    if (hasConflict) {
      await releaseLock(user.uid, state.deviceId, lock.revision, false);
      lockReleased = true;
      return {
        kind: "conflict",
        conflict: { reason: "concurrent-changes", localChanges: normalLocal.length, remoteChanges: normalRemote.length, cloudRevision: remote.state.headRevision },
      };
    }
    let downloaded = 0;
    if (!restored && (remoteChanges.entities.length || remoteChanges.reviewEvents.length)) {
      await applyRemote(user.uid, initialExport, remoteChanges, options);
      await persistLedgers(state, remoteChanges.entities, remoteChanges.reviewEvents, remote.state.headRevision);
      downloaded = remoteChanges.entities.length + remoteChanges.reviewEvents.length;
      restored = true;
    }
    const skipReExport = downloaded === 0 && !restored;
    const afterPullState = skipReExport ? state : await localState(user.uid);
    const afterPullExport = skipReExport ? initialExport : await exportCloudSync(await storage.createCloudSyncSnapshot());
    const afterPullChanges = skipReExport ? changed : await localChanges(afterPullExport, await ledgerFor());
    const published = await publish(user, afterPullState, afterPullExport, afterPullChanges, options, lock);
    lockReleased = true;
    progress(options, "done", "云端同步完成。");
    return { kind: "synced", uploaded: published.uploaded, downloaded, revision: published.revision, pending: 0, restored };
  } catch (error) {
    if (lock && !lockReleased) {
      await releaseLock(user.uid, state.deviceId, lock.revision, false).catch(() => undefined);
    }
    throw error;
  }
};

export const resolveCloudSyncConflict = async (
  user: User,
  choice: CloudSyncConflictChoice,
  options: CloudSyncOptions = {},
): Promise<CloudSyncResult> => {
  const state = await localState(user.uid);
  if (choice === "local") {
    const result = await replaceCloudWithLocal(user, state, options);
    progress(options, "done", "已以本机数据更新云端。");
    return { kind: "synced", uploaded: result.uploaded, downloaded: 0, revision: result.revision, pending: 0 };
  }
  const localExport = await exportCloudSync(await storage.createCloudSyncSnapshot());
  const lock = await acquireLock(user.uid, state.deviceId);
  let lockReleased = false;
  try {
    const remote = await getRemoteState(user.uid);
    await makeLocalSnapshot(user, localExport, "冲突前的本机版本", remote.state.headRevision, options);
    const restored = await restoreRemote(user.uid, options).catch(async (error: unknown) => {
      const legacy = await getCloudSnapshotInfo(user.uid);
      if (!legacy) throw error;
      const archive = await getCloudStorageBlob(user.uid, legacySnapshotRef(user.uid));
      const snapshot = await zipToSnapshot(new File([archive], "study-journal-cloud-sync.zip", { type: "application/zip" }));
      await storage.restoreCloudSyncSnapshot(snapshot);
      return undefined;
    });
    if (restored) {
      await resetAndPersistLedgers(state, restored.entities, restored.reviewEvents, restored.state.headRevision);
      await releaseLock(user.uid, state.deviceId, lock.revision, false);
      lockReleased = true;
      progress(options, "done", "已恢复云端数据。");
      return { kind: "synced", uploaded: 0, downloaded: restored.entities.length + restored.reviewEvents.length, revision: restored.state.headRevision, pending: 0, restored: true };
    }
    const imported = await exportCloudSync(await storage.createCloudSyncSnapshot());
    await resetLedgers(state);
    const published = await publish(user, { ...state, lastPulledRevision: 0, lastReviewEventRevision: 0 }, imported, {
      entities: imported.entities,
      events: imported.reviewEvents,
    }, options, lock);
    lockReleased = true;
    progress(options, "done", "已迁移旧版云端备份到增量同步。");
    return { kind: "synced", uploaded: published.uploaded, downloaded: 1, revision: published.revision, pending: 0, restored: true };
  } catch (error) {
    if (!lockReleased) {
      await releaseLock(user.uid, state.deviceId, lock.revision, false).catch(() => undefined);
    }
    throw error;
  }
};

export const listCloudRecoverySnapshots = async (uid: string): Promise<CloudRecoverySnapshot[]> => {
  const snapshots = await getDocs(query(snapshotsRef(uid), orderBy("createdAt", "desc")));
  return snapshots.docs.map((item) => {
    const value = item.data() as Record<string, unknown>;
    return {
      id: item.id,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
      label: typeof value.label === "string" ? value.label : "恢复快照",
      entityCount: typeof value.entityCount === "number" ? value.entityCount : 0,
      revision: typeof value.revision === "number" ? value.revision : 0,
    };
  });
};

export const restoreCloudRecoverySnapshot = async (user: User, id: string, options: CloudSyncOptions = {}) => {
  const items = await getDocs(snapshotEntitiesRef(user.uid, id));
  if (items.empty) throw new Error("恢复快照不存在或已被清理。");
  let entities = items.docs
    .map((item) => parseRemoteEntity(item.id, item.data()))
    .filter((item): item is RemoteEntity => Boolean(item));
  const reviewEvents = items.docs
    .map((item) => item.id.startsWith("review-event:") ? parseRemoteReviewEvent(item.id.slice("review-event:".length), item.data()) : undefined)
    .filter((item): item is RemoteReviewEvent => Boolean(item));
  entities = await hydratePayloadDocuments(user.uid, entities, options);
  const assetBlobs = new Map<string, Blob>();
  await downloadRemoteAssets(user.uid, entities, assetBlobs, options);
  await storage.restoreCloudSyncSnapshot(materializeCloudSyncSnapshot(entities, reviewEvents, assetBlobs));
  const local = await localState(user.uid);
  const revision = Math.max(0, ...entities.map((entity) => entity.revision), ...reviewEvents.map((event) => event.revision));
  await resetAndPersistLedgers(local, entities, reviewEvents, revision);
};
