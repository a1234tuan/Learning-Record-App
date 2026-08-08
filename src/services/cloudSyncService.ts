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

import type {
  CloudSyncEntityType,
  CloudSyncExpectedValue,
  CloudSyncLedgerRecord,
  CloudSyncOperationPhase,
  CloudSyncOperationRecord,
  CloudSyncStateRecord,
  ImportOptions,
} from "../types";
import { db } from "../db/database";
import { newId } from "../lib/entity";
import { isAndroidPlatform, isDesktopPlatform, isNativePlatform } from "../lib/platform";
import { firebaseAuth, firebaseStorage, firestore, googleAuthProvider } from "./firebase";
import {
  exportCloudSync,
  createCloudPayloadDocument,
  hashValue,
  hasConflictingChanges,
  materializeCloudSyncSnapshot,
  mergeCloudSyncSmallEntity,
  mergeCloudSyncEntities,
  NON_CONFLICTING_ENTITY_TYPES,
  preserveLocalChangesForCloudWins,
  stripUpdatedAt,
  withCloudPayloadDocument,
  type CloudReviewEvent,
  type CloudSyncEntity,
  type CloudSyncExport,
} from "./cloudSyncModel";
import { CloudSyncLocalMutationError, storage } from "./storageAdapter";
import { snapshotToZip, summarizeSnapshot, zipToSnapshot } from "./backup";
import {
  downloadNativeFirebaseStorageBlob,
  listNativeFirebaseStoragePaths,
  nativeFirebaseStorageObjectExists,
  uploadNativeFirebaseStorageBlob,
} from "./nativeFirebaseStorage";

const PROTOCOL_VERSION = 2;
const MAX_BATCH_WRITES = 400;
const LOCK_DURATION_MS = 30 * 60 * 1000;
const LOCK_RENEW_INTERVAL_MS = 5 * 60 * 1000;
const SNAPSHOT_LIMIT = 5;
const DESKTOP_AUTH_TIMEOUT_MS = 90_000;
const LEGACY_SNAPSHOT_FILE = "snapshots/current.zip";
const LEGACY_METADATA_DOCUMENT = "current";

export type RemoteSyncLock = {
  deviceId: string;
  operationId?: string;
  revision?: number;
  expiresAt: number;
};

type RemoteSyncState = {
  protocolVersion: number;
  headRevision: number;
  nextRevision: number;
  lock?: RemoteSyncLock | null;
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
  reason: "concurrent-changes" | "legacy-snapshot" | "local-changed-during-sync";
  localChanges: number;
  remoteChanges: number;
  cloudRevision: number;
  conflicts?: Array<{ key: string; fields?: string[] }>;
}

export type CloudSyncResult =
  | { kind: "synced"; uploaded: number; downloaded: number; revision: number; pending: number; restored?: boolean }
  | { kind: "conflict"; conflict: CloudSyncConflict }
  | { kind: "uncertain"; operationId: string; revision: number; message: string };

export interface CloudSyncOptions {
  onProgress?: (progress: CloudSyncProgress) => void;
  signal?: AbortSignal;
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
  if (isAndroidPlatform() && user?.uid === uid) {
    return downloadNativeFirebaseStorageBlob(storageRef.fullPath, await getIdTokenFor(user));
  }
  if (!desktopStorage || !user || user.uid !== uid) {
    return getBlob(storageRef);
  }
  const { data, contentType } = await desktopStorage.download(uid, storageRef.fullPath, await getIdTokenFor(user));
  return new Blob([data], { type: contentType });
};

const uploadCloudStorageBlob = async (
  uid: string,
  storageRef: StorageReference,
  blob: Blob,
  onProgress?: (bytesTransferred: number, totalBytes: number) => void,
) => {
  const desktopStorage = isDesktopPlatform() ? window.studyJournalDesktop?.firebaseStorage : undefined;
  const user = firebaseAuth.currentUser;
  if (isAndroidPlatform() && user?.uid === uid) {
    await uploadNativeFirebaseStorageBlob(storageRef.fullPath, blob, await getIdTokenFor(user), onProgress);
    return;
  }
  if (desktopStorage && user?.uid === uid) {
    await desktopStorage.upload(
      uid,
      storageRef.fullPath,
      await getIdTokenFor(user),
      await blob.arrayBuffer(),
      blob.type || "application/octet-stream",
    );
    onProgress?.(blob.size, blob.size);
    return;
  }
  const task = uploadBytesResumable(storageRef, blob, { contentType: blob.type || "application/octet-stream" });
  await new Promise<void>((resolve, reject) => task.on("state_changed", (snapshot) => {
    onProgress?.(snapshot.bytesTransferred, snapshot.totalBytes);
  }, reject, resolve));
};

const cloudStorageObjectExists = async (uid: string, storageRef: StorageReference): Promise<boolean> => {
  const desktopStorage = isDesktopPlatform() ? window.studyJournalDesktop?.firebaseStorage : undefined;
  const user = firebaseAuth.currentUser;
  if (isAndroidPlatform() && user?.uid === uid) {
    return nativeFirebaseStorageObjectExists(storageRef.fullPath, await getIdTokenFor(user));
  }
  if (desktopStorage && user?.uid === uid) {
    return desktopStorage.exists(uid, storageRef.fullPath, await getIdTokenFor(user));
  }
  try {
    await getMetadata(storageRef);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "storage/object-not-found") return false;
    throw error;
  }
};

const progress = (options: CloudSyncOptions, stage: CloudSyncProgress["stage"], message: string, current?: number, total?: number) =>
  options.onProgress?.({ stage, message, current, total });

/**
 * Firebase's web SDK can leave a request pending indefinitely after a proxy/network change in
 * Android WebView. Surface a useful error instead of relying on the UI watchdog to guess why the
 * operation stopped. This does not cancel the underlying SDK request, so callers must still avoid
 * mutating local state until the raced promise has resolved.
 */
export const withTimeout = <T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

const AUTH_TOKEN_TIMEOUT_MS = 20_000;
const getIdTokenFor = (user: User) => withTimeout(
  user.getIdToken(),
  AUTH_TOKEN_TIMEOUT_MS,
  "刷新 Firebase 登录令牌超时，请重新登录后重试。",
);

/** Run network work with a small fixed number of concurrent requests. */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

/**
 * Firestore's long-lived connection can wedge after a network/proxy change (the same Android
 * WebView class of issue the Storage calls below already guard against) — a read or transaction
 * then neither resolves nor rejects, so the UI watchdog is the only thing that ever notices,
 * minutes later. These give the same "explicit error over silent hang" treatment to every
 * Firestore call in this file. Document reads/writes have no legitimate reason to take long, so
 * the window is much shorter than the Storage timeouts (which must tolerate large file transfers).
 */
const FIRESTORE_READ_TIMEOUT_MS = 20_000;
const FIRESTORE_LOCK_TIMEOUT_MS = 20_000;
const FIRESTORE_BATCH_TIMEOUT_MS = 30_000;

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
    lock: data.lock && typeof data.lock === "object" ? (() => {
      const lock = data.lock as Record<string, unknown>;
      return typeof lock.deviceId === "string" && typeof lock.expiresAt === "number"
        ? {
          deviceId: lock.deviceId,
          expiresAt: lock.expiresAt,
          ...(typeof lock.operationId === "string" ? { operationId: lock.operationId } : {}),
          ...(typeof lock.revision === "number" ? { revision: lock.revision } : {}),
        }
        : null;
    })() : null,
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

class CloudSyncLockLostError extends Error {
  constructor() {
    super("同步锁已失效，未发布的数据将留待核对后重试。");
    this.name = "CloudSyncLockLostError";
  }
}

class CloudSyncResultUnknownError extends Error {
  readonly operationId: string;
  readonly revision: number;

  constructor(operationId: string, revision: number, message: string) {
    super(message);
    this.name = "CloudSyncResultUnknownError";
    this.operationId = operationId;
    this.revision = revision;
  }
}

const isTimeoutError = (error: unknown) => error instanceof Error && /超时|timeout/i.test(error.message);

const operationFor = async (operationId: string) => db.cloudSyncOperations.get(operationId);

const pendingOperationsFor = async (uid: string) => db.cloudSyncOperations
  .where("userId")
  .equals(uid)
  .filter((operation) => operation.status === "pending" || operation.status === "unknown")
  .toArray();

const saveOperation = async (operation: CloudSyncOperationRecord) => {
  await db.cloudSyncOperations.put({ ...operation, updatedAt: new Date().toISOString() });
};

const updateOperation = async (operationId: string, patch: Partial<CloudSyncOperationRecord>) => {
  const current = await operationFor(operationId);
  if (!current) return undefined;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.cloudSyncOperations.put(next);
  return next;
};

const expectedValues = (entities: CloudSyncEntity[], events: CloudReviewEvent[]): { expectedEntities: CloudSyncExpectedValue[]; expectedEvents: CloudSyncExpectedValue[] } => ({
  expectedEntities: entities.map((entity) => ({ key: entity.key, contentHash: entity.contentHash })),
  expectedEvents: events.map((event) => ({ key: event.id, contentHash: event.contentHash })),
});

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
  const snapshot = await withTimeout(getDoc(stateRef(uid)), FIRESTORE_READ_TIMEOUT_MS, "检查云端同步状态超时，请确认网络可连接后重试。");
  return { exists: snapshot.exists(), state: parseRemoteState(snapshot.data()) };
};

const getRemoteChanges = async (uid: string, afterRevision: number, state: RemoteSyncState) => {
  if (state.headRevision <= afterRevision) return { entities: [] as RemoteEntity[], reviewEvents: [] as RemoteReviewEvent[] };
  const [entities, reviewEvents] = await withTimeout(
    Promise.all([
      getDocs(query(entitiesRef(uid), where("revision", ">", afterRevision), where("revision", "<=", state.headRevision), orderBy("revision"))),
      getDocs(query(reviewEventsRef(uid), where("revision", ">", afterRevision), where("revision", "<=", state.headRevision), orderBy("revision"))),
    ]),
    FIRESTORE_READ_TIMEOUT_MS,
    "拉取云端更改超时，请确认网络可连接后重试。",
  );
  return {
    entities: entities.docs.map((item) => parseRemoteEntity(item.id, item.data())).filter((item): item is RemoteEntity => Boolean(item)),
    reviewEvents: reviewEvents.docs.map((item) => parseRemoteReviewEvent(item.id, item.data())).filter((item): item is RemoteReviewEvent => Boolean(item)),
  };
};

const getAllRemoteDocuments = async (uid: string) => {
  const [entities, reviewEvents] = await withTimeout(
    Promise.all([getDocs(entitiesRef(uid)), getDocs(reviewEventsRef(uid))]),
    FIRESTORE_READ_TIMEOUT_MS,
    "读取云端全部数据超时，请确认网络可连接后重试。",
  );
  return {
    entities: entities.docs
      .map((item) => parseRemoteEntity(item.id, item.data()))
      .filter((item): item is RemoteEntity => Boolean(item)),
    reviewEvents: reviewEvents.docs
      .map((item) => parseRemoteReviewEvent(item.id, item.data()))
      .filter((item): item is RemoteReviewEvent => Boolean(item)),
  };
};

const getAllRemote = async (uid: string, state: RemoteSyncState) => {
  const all = await getAllRemoteDocuments(uid);
  return {
    entities: all.entities.filter((entity) => entity.revision <= state.headRevision),
    reviewEvents: all.reviewEvents.filter((event) => event.revision <= state.headRevision),
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
    const blob = await withTimeout(
      getCloudStorageBlob(uid, documentRef(uid, documentHash)),
      ASSET_DOWNLOAD_TIMEOUT_MS,
      `下载云端大文本超时（${index}/${documents.length}），请确认网络可连接 Firebase Storage 后重试。`,
    );
    const content = await blob.text();
    let payload: unknown;
    try {
      payload = JSON.parse(content);
    } catch {
      throw new Error(`云端大文本 ${entity.key} 无法解析。`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`云端大文本 ${entity.key} 的格式无效。`);
    }
    // Large payload documents use the same content-hash canonicalization as
    // ordinary entities: `updatedAt` is bookkeeping and is stripped before
    // hashing. Keep upload and download validation symmetric.
    const actualHash = await hashValue(stripUpdatedAt(payload));
    if (actualHash !== documentHash || actualHash !== entity.contentHash) {
      throw new Error(`云端大文本 ${entity.key} 的完整性校验失败。`);
    }
    return { ...entity, payload: payload as Record<string, unknown> };
  }));
};

const ASSET_DOWNLOAD_TIMEOUT_MS = isNativePlatform() ? 300_000 : 120_000;
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

const mergeRemoteFieldChanges = async (
  current: CloudSyncExport,
  localChanged: { entities: CloudSyncEntity[]; events: CloudReviewEvent[] },
  updates: { entities: RemoteEntity[]; reviewEvents: RemoteReviewEvent[] },
  ledger: CloudSyncLedgerRecord[],
) => {
  const localByKey = new Map(current.entities.map((entity) => [entity.key, entity]));
  localChanged.entities.forEach((entity) => localByKey.set(entity.key, entity));
  const ledgerByKey = new Map(ledger.map((entry) => [entry.id, entry]));
  const conflicts: Array<{ key: string; fields?: string[] }> = [];
  const entities: RemoteEntity[] = [];
  for (const remote of updates.entities) {
    const local = localByKey.get(remote.key);
    if (!local || (local.entityType !== "settings" && local.entityType !== "template")) {
      entities.push(remote);
      continue;
    }
    if (local.contentHash === remote.contentHash && Boolean(local.deleted) === Boolean(remote.deleted)) {
      entities.push(remote);
      continue;
    }
    const merged = mergeCloudSyncSmallEntity(local, remote, ledgerByKey.get(remote.key)?.basePayload);
    if (merged.conflicts.length > 0) {
      conflicts.push({ key: remote.key, fields: merged.conflicts });
      entities.push(remote);
      continue;
    }
    entities.push({
      ...remote,
      payload: merged.payload,
      deleted: merged.deleted,
      contentHash: await hashValue(stripUpdatedAt(merged.payload)),
    });
  }
  return { entities, reviewEvents: updates.reviewEvents, conflicts };
};

const applyRemote = async (
  uid: string,
  current: CloudSyncExport,
  updates: { entities: RemoteEntity[]; reviewEvents: RemoteReviewEvent[] },
  options: CloudSyncOptions,
  expectedEpoch?: number,
) => {
  const mergedEntities = await hydratePayloadDocuments(uid, mergeCloudSyncEntities(current.entities, updates.entities), options);
  const mergedEvents = mergeReviewEvents(current.reviewEvents, updates.reviewEvents);
  const assetBlobs = new Map(current.assetBlobs);
  await downloadRemoteAssets(uid, mergedEntities, assetBlobs, options);
  progress(options, "applying", "正在一次性应用云端更改。");
  const snapshot = materializeCloudSyncSnapshot(mergedEntities, mergedEvents, assetBlobs);
  if (expectedEpoch === undefined) {
    await storage.restoreCloudSyncSnapshot(snapshot);
  } else {
    await storage.restoreCloudSyncSnapshotIfUnchanged(snapshot, expectedEpoch);
  }
};

export const lockMatches = (lock: RemoteSyncLock | null | undefined, deviceId: string, operationId: string, revision: number) =>
  Boolean(lock && lock.deviceId === deviceId && lock.operationId === operationId && lock.revision === revision);

const acquireLock = async (uid: string, deviceId: string, operationId: string) => withTimeout(
  runTransaction(firestore, async (transaction) => {
    const reference = stateRef(uid);
    const current = parseRemoteState((await transaction.get(reference)).data());
    const now = Date.now();
    if (current.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error("云端同步协议版本不兼容，请先使用新版应用完成迁移。");
    }
    if (current.lock && current.lock.expiresAt > now && !lockMatches(current.lock, deviceId, operationId, current.lock.revision ?? -1)) {
      throw new Error("另一台设备正在同步，请稍后再试。");
    }
    const revision = Math.max(current.nextRevision, current.headRevision) + 1;
    transaction.set(reference, {
      ...current,
      protocolVersion: PROTOCOL_VERSION,
      nextRevision: revision,
      lock: { deviceId, operationId, revision, expiresAt: now + LOCK_DURATION_MS },
    });
    return { operationId, revision, previousHead: current.headRevision };
  }),
  FIRESTORE_LOCK_TIMEOUT_MS,
  "获取云同步锁超时，请确认网络可连接后重试。",
);

const releaseLock = async (uid: string, deviceId: string, operationId: string, revision: number, publish: boolean) => withTimeout(
  runTransaction(firestore, async (transaction) => {
    const reference = stateRef(uid);
    const current = parseRemoteState((await transaction.get(reference)).data());
    if (!lockMatches(current.lock, deviceId, operationId, revision)) {
      throw new CloudSyncLockLostError();
    }
    transaction.set(reference, {
      ...current,
      protocolVersion: PROTOCOL_VERSION,
      headRevision: publish ? Math.max(current.headRevision, revision) : current.headRevision,
      nextRevision: Math.max(current.nextRevision, revision),
      lock: null,
    });
  }),
  FIRESTORE_LOCK_TIMEOUT_MS,
  "释放云同步锁超时，请确认网络可连接后重试。",
);

const renewLock = async (uid: string, deviceId: string, operationId: string, revision: number) => withTimeout(
  runTransaction(firestore, async (transaction) => {
    const reference = stateRef(uid);
    const current = parseRemoteState((await transaction.get(reference)).data());
    if (!lockMatches(current.lock, deviceId, operationId, revision) || current.lock!.expiresAt <= Date.now()) {
      throw new CloudSyncLockLostError();
    }
    transaction.set(reference, {
      ...current,
      lock: { ...current.lock, deviceId, operationId, revision, expiresAt: Date.now() + LOCK_DURATION_MS },
    });
  }),
  FIRESTORE_LOCK_TIMEOUT_MS,
  "续租云同步锁超时，请确认网络可连接后重试。",
);

const startLockRenewal = (uid: string, deviceId: string, lock: AcquiredLock) => {
  let leaseError: unknown;
  const timer = setInterval(() => {
    void renewLock(uid, deviceId, lock.operationId, lock.revision).catch((error: unknown) => {
      leaseError ??= error;
    });
  }, LOCK_RENEW_INTERVAL_MS);
  return {
    assert: async () => {
      if (leaseError) throw leaseError;
      await renewLock(uid, deviceId, lock.operationId, lock.revision);
    },
    stop: () => clearInterval(timer),
  };
};

const writeInBatches = async (writes: Array<(batch: WriteBatch) => void>, beforeBatch?: () => Promise<void>) => {
  for (let index = 0; index < writes.length; index += MAX_BATCH_WRITES) {
    await beforeBatch?.();
    const batch = writeBatch(firestore);
    writes.slice(index, index + MAX_BATCH_WRITES).forEach((write) => write(batch));
    await withTimeout(batch.commit(), FIRESTORE_BATCH_TIMEOUT_MS, "提交同步数据超时，请确认网络可连接后重试。");
  }
};

const ASSET_UPLOAD_CONCURRENCY = 5;
const STORAGE_METADATA_CONCURRENCY = 6;
// Native uploads use Android's network stack and may legitimately take longer than the web SDK
// timeout while the operating system sends a large cached file.
const ASSET_UPLOAD_TIMEOUT_MS = isNativePlatform() ? 300_000 : 120_000;
const METADATA_CHECK_TIMEOUT_MS = 30_000;
const STORAGE_LIST_TIMEOUT_MS = isNativePlatform() ? 5 * 60_000 : METADATA_CHECK_TIMEOUT_MS;

export const isUnsupportedStorageListError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s*(403|404|405)|列表.*不支持|list.*(unsupported|not supported)/i.test(message);
};

const listNativeStoragePathsOrFallback = async (prefix: string, token: string, timeoutMessage: string) => {
  try {
    return await withTimeout(listNativeFirebaseStoragePaths(prefix, token), STORAGE_LIST_TIMEOUT_MS, timeoutMessage);
  } catch (error) {
    if (isUnsupportedStorageListError(error)) return undefined;
    throw error;
  }
};

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
  const user = firebaseAuth.currentUser;
  const nativeAssetPaths = hashes.length > 0 && isAndroidPlatform() && user?.uid === uid
    ? await listNativeStoragePathsOrFallback(
      `users/${uid}/assets/`,
      await getIdTokenFor(user),
      "检查云端资源超时，请检查网络连接后重试。",
    )
    : undefined;
  const missing = nativeAssetPaths
    ? hashes.filter((hash) => !nativeAssetPaths.has(`users/${uid}/assets/${hash}`))
    : (
      await mapWithConcurrency(hashes, STORAGE_METADATA_CONCURRENCY, async (hash) => {
        const exists = await withTimeout(
          cloudStorageObjectExists(uid, assetRef(uid, hash)),
          METADATA_CHECK_TIMEOUT_MS,
          "检查云端资源超时，请检查网络连接后重试。",
        );
        return exists ? null : hash;
      })
    ).filter((h): h is string => h !== null);
  let transferred = 0;
  const total = missing.length;
  let completed = 0;
  for (let i = 0; i < total; i += ASSET_UPLOAD_CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + ASSET_UPLOAD_CONCURRENCY).map(async (hash) => {
        const blob = assetBlobs.get(hash);
        if (!blob) throw new Error("本地资源缓存不完整，无法同步。");
        let taskTransferred = 0;
        const uploadPromise = uploadCloudStorageBlob(uid, assetRef(uid, hash), blob, (bytesTransferred) => {
          // Both native and web upload implementations report a cumulative value. Add only the
          // delta; otherwise a 90 MB upload would look like hundreds of megabytes in the UI.
          const delta = Math.max(0, bytesTransferred - taskTransferred);
          taskTransferred = Math.max(taskTransferred, bytesTransferred);
          transferred += delta;
          progress(options, "uploading", `正在上传资源 ${completed + 1}/${total}（${(transferred / (1024 * 1024)).toFixed(1)} MB）。`);
        });
        await withTimeout(uploadPromise, ASSET_UPLOAD_TIMEOUT_MS, `资源上传超时（${completed + 1}/${total}），请确认网络可连接 Firebase Storage 后重试。`);
        completed++;
        progress(options, "uploading", `正在上传资源 ${completed}/${total}（${(transferred / (1024 * 1024)).toFixed(1)} MB）。`);
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
  const user = firebaseAuth.currentUser;
  const nativeDocumentPaths = documents.length > 0 && isAndroidPlatform() && user?.uid === uid
    ? await listNativeStoragePathsOrFallback(
      `users/${uid}/documents/`,
      await getIdTokenFor(user),
      "检查云端大文本超时，请确认网络可连接后重试。",
    )
    : undefined;
  const missingDocs = nativeDocumentPaths
    ? documents.filter((item) => !nativeDocumentPaths.has(`users/${uid}/documents/${item.document.hash}`))
    : (
      await mapWithConcurrency(documents, STORAGE_METADATA_CONCURRENCY, async (item) => {
        const exists = await withTimeout(
          cloudStorageObjectExists(uid, documentRef(uid, item.document.hash)),
          METADATA_CHECK_TIMEOUT_MS,
          "检查云端大文本超时，请确认网络可连接后重试。",
        );
        return exists ? null : item;
      })
    ).filter((item): item is (typeof documents)[number] => item !== null);
  await mapWithConcurrency(missingDocs, ASSET_UPLOAD_CONCURRENCY, (item, index) => {
    progress(options, "uploading", `正在上传大文本 ${index + 1}/${missingDocs.length}。`, index + 1, missingDocs.length);
    return withTimeout(
      uploadCloudStorageBlob(uid, documentRef(uid, item.document.hash), item.document.blob),
      ASSET_UPLOAD_TIMEOUT_MS,
      `上传云端大文本超时（${index + 1}/${missingDocs.length}），请确认网络可连接 Firebase Storage 后重试。`,
    );
  });
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
      basePayload: entity.entityType === "settings" || entity.entityType === "template"
        ? entity.deleted ? undefined : entity.payload
        : undefined,
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
      basePayload: entity.entityType === "settings" || entity.entityType === "template"
        ? entity.deleted ? undefined : entity.payload
        : undefined,
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
type AcquiredLock = { operationId: string; revision: number; previousHead: number };

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
    if (heldLock) {
      await releaseLock(user.uid, state.deviceId, heldLock.operationId, heldLock.revision, false);
      await updateOperation(heldLock.operationId, { status: "succeeded", phase: "releasing" });
    }
    return { revision: heldLock?.previousHead ?? state.lastPulledRevision, uploaded: 0 };
  }
  const lock = heldLock ?? await acquireLock(user.uid, state.deviceId, newId());
  const lease = startLockRenewal(user.uid, state.deviceId, lock);
  const assertLease = lease.assert;
  try {
    const expected = expectedValues(changed.entities, changed.events);
    await updateOperation(lock.operationId, {
      expectedEntities: expected.expectedEntities,
      expectedEvents: expected.expectedEvents,
    });
    await updateOperation(lock.operationId, { phase: "uploading", status: "pending" });
    await uploadAssets(user.uid, changed.entities, exported.assetBlobs, options);
    await assertLease();
    progress(options, "uploading", "正在提交同步元数据。", 0, changed.entities.length + changed.events.length);
    const storedEntities = await uploadLargePayloadDocuments(user.uid, changed.entities, options);
    const remoteEntities = storedEntities.map((entity) => toRemoteEntity(entity, lock.revision));
    const remoteEvents = changed.events.map((event) => toRemoteReviewEvent(event, lock.revision));
    await updateOperation(lock.operationId, { phase: "committing" });
    await writeInBatches([
      ...remoteEntities.map((entity) => (batch: WriteBatch) => batch.set(entityRef(user.uid, entity.key), activeEntityDocument(entity))),
      ...remoteEvents.map((event) => (batch: WriteBatch) => batch.set(reviewEventRef(user.uid, event.id), {
        contentHash: event.contentHash,
        payload: event.payload,
        revision: event.revision,
        updatedAt: new Date().toISOString(),
      })),
    ], assertLease);
    // Advance headRevision before recording the local ledger, not after. The Firestore batch write
    // above is the true point of no return — once it succeeds, this revision's data is durably
    // stored regardless of what happens next. If the app is killed between these two calls:
    //  - headRevision-first (this order): the server already reflects the new revision, so every
    //    device (including this one) can see it on the very next pull. This device's local ledger
    //    is stale, so its next sync harmlessly re-diffs and re-uploads the same content under a new
    //    revision — wasteful but self-correcting on this device's own next attempt.
    //  - ledger-first (the old order): the local ledger says "already synced," so this device's own
    //    retries find nothing to publish and release the lock without advancing headRevision. The
    //    just-written entities sit above headRevision — invisible to every device, including this
    //    one — until some unrelated future edit anywhere finally pushes headRevision past them.
    await updateOperation(lock.operationId, { phase: "releasing" });
    await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, true);
    await persistLedgers(state, remoteEntities, remoteEvents, lock.revision);
    await updateOperation(lock.operationId, { status: "succeeded", phase: "releasing" });
    return { revision: lock.revision, uploaded: remoteEntities.length + remoteEvents.length };
  } catch (error) {
    const timedOut = error instanceof Error && error.message.includes("超时");
    if (timedOut) {
      await updateOperation(lock.operationId, { status: "unknown", errorMessage: error.message });
      throw new CloudSyncResultUnknownError(lock.operationId, lock.revision, `${error.message} 操作结果未知，正在核对云端状态。`);
    }
    await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false).catch(() => undefined);
    await updateOperation(lock.operationId, { status: "failed", phase: "releasing", errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    lease.stop();
  }
};

const makeRemoteSnapshot = async (
  uid: string,
  label: string,
  entities: RemoteEntity[],
  events: RemoteReviewEvent[],
  revision: number,
  options: CloudSyncOptions,
  beforeBatch?: () => Promise<void>,
) => {
  const id = `${Date.now()}-${newId()}`;
  progress(options, "snapshot", "正在创建恢复快照。");
  const snapshotEntities = await uploadLargePayloadDocuments(uid, entities, options);
  await beforeBatch?.();
  await withTimeout(setDoc(snapshotRef(uid, id), {
    createdAt: new Date().toISOString(),
    label,
    entityCount: snapshotEntities.length + events.length,
    revision,
  }), FIRESTORE_BATCH_TIMEOUT_MS, "写入云端恢复快照超时，请确认网络可连接后重试。");
  progress(options, "snapshot", `正在写入快照数据（共 ${snapshotEntities.length + events.length} 项）。`);
  await writeInBatches([
    ...snapshotEntities.map((entity) => (batch: WriteBatch) => batch.set(doc(snapshotEntitiesRef(uid, id), entity.key), snapshotEntityDocument(entity))),
    ...events.map((event) => (batch: WriteBatch) => batch.set(doc(snapshotEntitiesRef(uid, id), `review-event:${event.id}`), { ...event, kind: "review-event" })),
  ], beforeBatch);
  const snapshots = await withTimeout(
    getDocs(query(snapshotsRef(uid), orderBy("createdAt", "desc"))),
    FIRESTORE_READ_TIMEOUT_MS,
    "检查云端恢复快照超时，请确认网络可连接后重试。",
  );
  const expired = snapshots.docs.slice(SNAPSHOT_LIMIT);
  for (const item of expired) {
    const children = await withTimeout(
      getDocs(snapshotEntitiesRef(uid, item.id)),
      FIRESTORE_READ_TIMEOUT_MS,
      "读取过期恢复快照超时，请确认网络可连接后重试。",
    );
    await writeInBatches([
      ...children.docs.map((child) => (batch: WriteBatch) => batch.delete(child.ref)),
      (batch: WriteBatch) => batch.delete(item.ref),
    ], beforeBatch);
  }
  if (expired.length > 0) {
    await cleanUpUnreferencedStorage(uid);
  }
  return id;
};

const referencedAssetHash = (entity: CloudSyncEntity) =>
  entity.entityType === "asset" && !entity.deleted && typeof entity.payload.contentHash === "string"
    ? entity.payload.contentHash
    : undefined;

const collectSnapshotEntities = async (uid: string) => {
  const snapshots = await withTimeout(
    getDocs(snapshotsRef(uid)),
    FIRESTORE_READ_TIMEOUT_MS,
    "读取恢复快照列表超时，请确认网络可连接后重试。",
  );
  const children = await withTimeout(
    Promise.all(snapshots.docs.map((snapshot) => getDocs(snapshotEntitiesRef(uid, snapshot.id)))),
    FIRESTORE_READ_TIMEOUT_MS,
    "读取恢复快照内容超时，请确认网络可连接后重试。",
  );
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
  const [assets, documents] = await Promise.all([
    withTimeout(listAll(assetsRootRef(uid)), ASSET_DOWNLOAD_TIMEOUT_MS, "列出云端资源超时，请确认网络可连接后重试。"),
    withTimeout(listAll(documentsRootRef(uid)), ASSET_DOWNLOAD_TIMEOUT_MS, "列出云端大文本超时，请确认网络可连接后重试。"),
  ]);
  await Promise.all([
    ...assets.items.filter((item) => !assetHashes.has(item.name)).map((item) => withTimeout(deleteObject(item), ASSET_UPLOAD_TIMEOUT_MS, "清理云端资源超时，请确认网络可连接后重试。")),
    ...documents.items.filter((item) => !documentHashes.has(item.name)).map((item) => withTimeout(deleteObject(item), ASSET_UPLOAD_TIMEOUT_MS, "清理云端大文本超时，请确认网络可连接后重试。")),
  ]);
};

const makeLocalSnapshot = async (
  user: User,
  exported: CloudSyncExport,
  label: string,
  revision: number,
  options: CloudSyncOptions,
  beforeBatch?: () => Promise<void>,
) => {
  const entities = exported.entities.map((entity) => toRemoteEntity(entity, revision));
  const events = exported.reviewEvents.map((event) => toRemoteReviewEvent(event, revision));
  await uploadAssets(user.uid, entities, exported.assetBlobs, options);
  return makeRemoteSnapshot(user.uid, label, entities, events, revision, options, beforeBatch);
};

const replaceCloudWithLocal = async (user: User, state: CloudSyncStateRecord, options: CloudSyncOptions) => {
  const exported = await exportCloudSync(await storage.createCloudSyncSnapshot());
  const operationId = newId();
  const lock = await acquireLock(user.uid, state.deviceId, operationId);
  const lease = startLockRenewal(user.uid, state.deviceId, lock);
  let lockReleased = false;
  try {
    await saveOperation({
      id: operationId,
      operationId,
      userId: user.uid,
      deviceId: state.deviceId,
      revision: lock.revision,
      previousHeadRevision: lock.previousHead,
      expectedEntities: [],
      expectedEvents: [],
      phase: "acquiring",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const remote = await getRemoteState(user.uid);
    const allRemote = await getAllRemote(user.uid, remote.state);
    await makeRemoteSnapshot(user.uid, "冲突前的云端版本", allRemote.entities, allRemote.reviewEvents, remote.state.headRevision, options, lease.assert);
    await lease.assert();
    const localKeys = new Set(exported.entities.map((entity) => entity.key));
    const tombstones = allRemote.entities
      .filter((entity) => !localKeys.has(entity.key) && !entity.deleted && entity.entityType !== "review-state" && entity.entityType !== "review-day-stat")
      .map((entity) => ({ ...entity, contentHash: `deleted:${entity.contentHash}`, payload: {}, deleted: true }));
    const result = await publish(user, state, exported, { entities: [...exported.entities, ...tombstones], events: exported.reviewEvents }, options, lock);
    lockReleased = true;
    await updateOperation(operationId, { status: "succeeded", phase: "releasing" });
    return result;
  } catch (error) {
    if (error instanceof CloudSyncResultUnknownError) throw error;
    if (isTimeoutError(error)) {
      await updateOperation(operationId, { status: "unknown", phase: "reconciling", errorMessage: error instanceof Error ? error.message : String(error) });
      throw new CloudSyncResultUnknownError(operationId, lock.revision, `${error instanceof Error ? error.message : String(error)} 操作结果未知，正在核对云端状态。`);
    }
    if (!lockReleased) {
      await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false).catch(() => undefined);
    }
    await updateOperation(operationId, { status: "failed", phase: "releasing", errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    lease.stop();
  }
};

const restoreRemote = async (uid: string, options: CloudSyncOptions, expectedEpoch?: number) => {
  const remote = await getRemoteState(uid);
  if (!remote.exists || remote.state.headRevision === 0) throw new Error("云端没有可恢复的增量同步数据。");
  progress(options, "downloading", "正在从云端读取全量数据。");
  const all = await getAllRemote(uid, remote.state);
  all.entities = await hydratePayloadDocuments(uid, all.entities, options);
  const assetBlobs = new Map<string, Blob>();
  await downloadRemoteAssets(uid, all.entities, assetBlobs, options);
  progress(options, "applying", "正在恢复云端数据。");
  const snapshot = materializeCloudSyncSnapshot(all.entities, all.reviewEvents, assetBlobs);
  if (expectedEpoch === undefined) await storage.restoreCloudSyncSnapshot(snapshot);
  else await storage.restoreCloudSyncSnapshotIfUnchanged(snapshot, expectedEpoch);
  return { state: remote.state, ...all };
};

export const getCurrentCloudUser = (): User | null => firebaseAuth.currentUser;

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
  const snapshot = await withTimeout(
    getDoc(legacyMetadataRef(uid)),
    FIRESTORE_READ_TIMEOUT_MS,
    "检查云端旧版备份信息超时，请确认网络可连接后重试。",
  );
  return snapshot.exists() ? parseLegacySnapshotInfo(snapshot.data()) : undefined;
};

export const getCloudSyncStatus = async (user: User): Promise<CloudSyncStatus> => {
  const [local, remote, legacy, exported, ledger, snapshots] = await Promise.all([
    localState(user.uid),
    getRemoteState(user.uid),
    getCloudSnapshotInfo(user.uid),
    exportCloudSync(await storage.createCloudSyncSnapshot()),
    ledgerFor(),
    withTimeout(getDocs(snapshotsRef(user.uid)), FIRESTORE_READ_TIMEOUT_MS, "检查云端恢复快照列表超时，请确认网络可连接后重试。"),
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

const reconcileOperation = async (user: User, operation: CloudSyncOperationRecord, options: CloudSyncOptions): Promise<boolean> => {
  await updateOperation(operation.operationId, { phase: "reconciling", status: "unknown" });
  try {
    const remote = await getRemoteState(user.uid);
    // Inspect the current documents without filtering by headRevision. A batch can
    // have committed just before the client timed out, leaving the documents at
    // `operation.revision` while the head update is still unknown.
    const currentDocuments = remote.exists
      ? await getAllRemoteDocuments(user.uid)
      : { entities: [] as RemoteEntity[], reviewEvents: [] as RemoteReviewEvent[] };
    const latestEntities = new Map<string, RemoteEntity>();
    currentDocuments.entities.forEach((entity) => latestEntities.set(entity.key, entity));
    const latestEvents = new Map<string, RemoteReviewEvent>();
    currentDocuments.reviewEvents.forEach((event) => latestEvents.set(event.id, event));
    const matchedEntities = operation.expectedEntities
      .map((expected) => latestEntities.get(expected.key))
      .filter((entity): entity is RemoteEntity => Boolean(entity && entity.revision >= operation.revision));
    const matchedEvents = operation.expectedEvents
      .map((expected) => latestEvents.get(expected.key))
      .filter((event): event is RemoteReviewEvent => Boolean(event && event.revision >= operation.revision));
    const entitiesComplete = operation.expectedEntities.every((expected) => {
      const entity = latestEntities.get(expected.key);
      return Boolean(entity && entity.revision >= operation.revision && entity.contentHash === expected.contentHash);
    });
    const eventsComplete = operation.expectedEvents.every((expected) => {
      const event = latestEvents.get(expected.key);
      return Boolean(event && event.revision >= operation.revision && event.contentHash === expected.contentHash);
    });
    const expectedKnown = operation.phase !== "acquiring" || operation.expectedEntities.length > 0 || operation.expectedEvents.length > 0;
    const lock = remote.state.lock;
    const stillHeld = lockMatches(lock, operation.deviceId, operation.operationId, operation.revision) && lock!.expiresAt > Date.now();
    if (expectedKnown && remote.exists && entitiesComplete && eventsComplete) {
      let visibleRevision = remote.state.headRevision;
      if (remote.state.headRevision < operation.revision && stillHeld) {
        // We still own the original lease, so safely finish the operation that
        // wrote the metadata before the client lost its response.
        await releaseLock(user.uid, operation.deviceId, operation.operationId, operation.revision, true);
        visibleRevision = operation.revision;
      } else if (remote.state.headRevision < operation.revision && (!lock || !stillHeld)) {
        // Metadata exists at the target revision but the head was never
        // advanced. Acquire a short repair lease and publish the highest head
        // so the data cannot remain permanently invisible.
        const repair = await acquireLock(user.uid, operation.deviceId, `${operation.operationId}:repair:${newId()}`);
        await releaseLock(user.uid, operation.deviceId, repair.operationId, repair.revision, true);
        visibleRevision = repair.revision;
      } else if (lockMatches(lock, operation.deviceId, operation.operationId, operation.revision) && stillHeld) {
        // The target is already visible, but the response to the original
        // release was lost. Clear the matching lock while we still own it.
        await releaseLock(user.uid, operation.deviceId, operation.operationId, operation.revision, true);
      } else if (lock && !stillHeld) {
        // The target is already visible, but an expired stale lock remains.
        // Acquiring and releasing a repair lease clears it without lowering
        // the current head.
        const repair = await acquireLock(user.uid, operation.deviceId, `${operation.operationId}:unlock:${newId()}`);
        await releaseLock(user.uid, operation.deviceId, repair.operationId, repair.revision, false);
      } else if (lock && !lockMatches(lock, operation.deviceId, operation.operationId, operation.revision)) {
        // A newer operation owns the lock. It is responsible for releasing it;
        // do not touch another operation's lease during reconciliation.
        await updateOperation(operation.operationId, { status: "succeeded", phase: "reconciling" });
        return true;
      }
      const state = await localState(user.uid);
      await persistLedgers(state, matchedEntities, matchedEvents, visibleRevision);
      await updateOperation(operation.operationId, { status: "succeeded", phase: "reconciling" });
      return true;
    }
    if (!stillHeld && !lock && (!remote.exists || remote.state.headRevision < operation.revision)) {
      await updateOperation(operation.operationId, { status: "failed", phase: "reconciling" });
      return true;
    }
    await updateOperation(operation.operationId, { status: "unknown", phase: "reconciling" });
    return false;
  } catch (error) {
    await updateOperation(operation.operationId, {
      status: "unknown",
      phase: "reconciling",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    progress(options, "checking", "上次同步结果仍无法确认，请确认网络后重试核对。 ");
    return false;
  }
};

const reconcilePendingOperations = async (user: User, options: CloudSyncOptions) => {
  const pending = await pendingOperationsFor(user.uid);
  for (const operation of pending) {
    await reconcileOperation(user, operation, options);
  }
  return pendingOperationsFor(user.uid);
};

export const synchronizeCloudChanges = async (user: User, options: CloudSyncOptions = {}): Promise<CloudSyncResult> => {
  progress(options, "checking", "正在检查本机和云端的更改。");
  const remainingOperations = await reconcilePendingOperations(user, options);
  if (remainingOperations.length > 0) {
    const operation = remainingOperations[0];
    return {
      kind: "uncertain",
      operationId: operation.operationId,
      revision: operation.revision,
      message: "上一次同步结果尚未确认，已暂停新的同步，请保持网络连接后重试核对。",
    };
  }
  const operationId = newId();
  const initialEpoch = await storage.getCloudSyncMutationEpoch();
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
    lock = await acquireLock(user.uid, state.deviceId, operationId);
    await saveOperation({
      id: operationId,
      operationId,
      userId: user.uid,
      deviceId: state.deviceId,
      revision: lock.revision,
      previousHeadRevision: lock.previousHead,
      expectedEntities: [],
      expectedEvents: [],
      phase: "acquiring",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (!initialRemote.exists && legacy && hasRecoverableLocalData(initialExport)) {
      await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false);
      await updateOperation(operationId, { status: "failed", phase: "releasing" });
      lockReleased = true;
      return { kind: "conflict", conflict: { reason: "legacy-snapshot", localChanges: initialExport.entities.length, remoteChanges: 1, cloudRevision: 0 } };
    }

    if (!initialRemote.exists && legacy && firstEmptyDevice) {
      progress(options, "downloading", "正在迁移旧版云端备份。", 0, 1);
      const archive = await withTimeout(
        getCloudStorageBlob(user.uid, legacySnapshotRef(user.uid)),
        ASSET_DOWNLOAD_TIMEOUT_MS,
        "下载云端旧版备份超时，请确认网络可连接 Firebase Storage 后重试。",
      );
      const snapshot = await zipToSnapshot(new File([archive], "study-journal-cloud-sync.zip", { type: "application/zip" }));
      await storage.restoreCloudSyncSnapshotIfUnchanged(snapshot, initialEpoch);
      restored = true;
    }

    const remote = await getRemoteState(user.uid);
    const remoteChanges = remote.exists ? await getRemoteChanges(user.uid, state.lastPulledRevision, remote.state) : { entities: [], reviewEvents: [] };
    const changed = await localChanges(restored ? await exportCloudSync(await storage.createCloudSyncSnapshot()) : initialExport, ledger);
    const mergedRemoteChanges = await mergeRemoteFieldChanges(initialExport, changed, remoteChanges, ledger);
    const normalLocal = (firstEmptyDevice ? [] : changed.entities)
      .filter((entity) => !NON_CONFLICTING_ENTITY_TYPES.has(entity.entityType));
    const normalRemote = remoteChanges.entities.filter((entity) => !NON_CONFLICTING_ENTITY_TYPES.has(entity.entityType));
    const hasConflict = hasConflictingChanges(normalLocal, normalRemote);
    if (hasConflict || mergedRemoteChanges.conflicts.length > 0) {
      await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false);
      await updateOperation(operationId, { status: "failed", phase: "releasing" });
      lockReleased = true;
      return {
        kind: "conflict",
        conflict: {
          reason: "concurrent-changes",
          localChanges: normalLocal.length + changed.entities.filter((entity) => entity.entityType === "settings" || entity.entityType === "template").length,
          remoteChanges: normalRemote.length + remoteChanges.entities.filter((entity) => entity.entityType === "settings" || entity.entityType === "template").length,
          cloudRevision: remote.state.headRevision,
          conflicts: mergedRemoteChanges.conflicts.length ? mergedRemoteChanges.conflicts : undefined,
        },
      };
    }
    let downloaded = 0;
    if (!restored && (remoteChanges.entities.length || remoteChanges.reviewEvents.length)) {
      await applyRemote(user.uid, initialExport, mergedRemoteChanges, options, initialEpoch);
      await persistLedgers(state, remoteChanges.entities, remoteChanges.reviewEvents, remote.state.headRevision);
      downloaded = remoteChanges.entities.length + remoteChanges.reviewEvents.length;
      restored = true;
    }
    const skipReExport = downloaded === 0 && !restored;
    const afterPullState = skipReExport ? state : await localState(user.uid);
    const afterPullExport = skipReExport ? initialExport : await exportCloudSync(await storage.createCloudSyncSnapshot());
    const afterPullChanges = skipReExport ? changed : await localChanges(afterPullExport, await ledgerFor());
    const expected = expectedValues(afterPullChanges.entities, afterPullChanges.events);
    await updateOperation(operationId, { expectedEntities: expected.expectedEntities, expectedEvents: expected.expectedEvents, phase: "uploading" });
    const published = await publish(user, afterPullState, afterPullExport, afterPullChanges, options, lock);
    lockReleased = true;
    progress(options, "done", "云端同步完成。");
    return { kind: "synced", uploaded: published.uploaded, downloaded, revision: published.revision, pending: 0, restored };
  } catch (error) {
    if (error instanceof CloudSyncResultUnknownError) {
      return { kind: "uncertain", operationId: error.operationId, revision: error.revision, message: error.message };
    }
    if (lock && isTimeoutError(error)) {
      await updateOperation(operationId, { status: "unknown", phase: "reconciling", errorMessage: error instanceof Error ? error.message : String(error) });
      return {
        kind: "uncertain",
        operationId,
        revision: lock.revision,
        message: `${error instanceof Error ? error.message : String(error)} 操作结果未知，正在核对云端状态。`,
      };
    }
    if (error instanceof CloudSyncLocalMutationError) {
      if (lock && !lockReleased) {
        await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false).catch(() => undefined);
        lockReleased = true;
      }
      await updateOperation(operationId, { status: "failed", phase: "releasing", errorMessage: error.message });
      return {
        kind: "conflict",
        conflict: {
          reason: "local-changed-during-sync",
          localChanges: 1,
          remoteChanges: 0,
          cloudRevision: initialRemote.state.headRevision,
        },
      };
    }
    if (lock && !lockReleased) {
      await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false).catch(() => undefined);
      await updateOperation(operationId, { status: "failed", phase: "releasing", errorMessage: error instanceof Error ? error.message : String(error) });
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
    let result: { revision: number; uploaded: number };
    try {
      result = await replaceCloudWithLocal(user, state, options);
    } catch (error) {
      if (error instanceof CloudSyncResultUnknownError) {
        return { kind: "uncertain", operationId: error.operationId, revision: error.revision, message: error.message };
      }
      throw error;
    }
    progress(options, "done", "已以本机数据更新云端。");
    return { kind: "synced", uploaded: result.uploaded, downloaded: 0, revision: result.revision, pending: 0 };
  }
  progress(options, "snapshot", "正在导出本机数据准备恢复点。");
  const initialEpoch = await storage.getCloudSyncMutationEpoch();
  const localExport = await exportCloudSync(await storage.createCloudSyncSnapshot());
  const operationId = newId();
  const lock = await acquireLock(user.uid, state.deviceId, operationId);
  const lease = startLockRenewal(user.uid, state.deviceId, lock);
  let lockReleased = false;
  try {
    await saveOperation({
      id: operationId,
      operationId,
      userId: user.uid,
      deviceId: state.deviceId,
      revision: lock.revision,
      previousHeadRevision: lock.previousHead,
      expectedEntities: [],
      expectedEvents: [],
      phase: "acquiring",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const remote = await getRemoteState(user.uid);
    progress(options, "snapshot", `正在上传本机恢复快照（共 ${localExport.assetBlobs.size} 个资源）。`);
    await makeLocalSnapshot(user, localExport, "冲突前的本机版本", remote.state.headRevision, options, lease.assert);
    await lease.assert();
    if (remote.exists && remote.state.headRevision > 0) {
      const ledger = await ledgerFor();
      const remoteChanges = await getRemoteChanges(user.uid, state.lastPulledRevision, remote.state);
      const allRemote = await getAllRemote(user.uid, remote.state);
      const fieldMerged = await mergeRemoteFieldChanges(localExport, await localChanges(localExport, ledger), remoteChanges, ledger);
      const remoteChangedKeys = new Set(remoteChanges.entities.map((entity) => entity.key));
      const remoteChangedEvents = new Set(remoteChanges.reviewEvents.map((event) => event.id));
      const fieldMergedByKey = new Map(fieldMerged.entities.map((entity) => [entity.key, entity]));
      const changed = await localChanges(localExport, ledger);
      const preservedLocal = preserveLocalChangesForCloudWins(changed.entities, allRemote.entities, remoteChangedKeys);
      const cloudEntitiesByKey = new Map<string, CloudSyncEntity>(allRemote.entities.map((entity) => [entity.key, entity]));
      fieldMergedByKey.forEach((entity, key) => cloudEntitiesByKey.set(key, entity));
      preservedLocal.forEach((entity) => cloudEntitiesByKey.set(entity.key, entity));
      const cloudEntities = await hydratePayloadDocuments(user.uid, [...cloudEntitiesByKey.values()], options);
      const cloudEventsById = new Map<string, CloudReviewEvent>(allRemote.reviewEvents.map((event) => [event.id, event]));
      changed.events.filter((event) => !remoteChangedEvents.has(event.id) && !cloudEventsById.has(event.id)).forEach((event) => cloudEventsById.set(event.id, event));
      const cloudEvents = [...cloudEventsById.values()];
      const assetBlobs = new Map(localExport.assetBlobs);
      await downloadRemoteAssets(user.uid, cloudEntities, assetBlobs, options);
      await lease.assert();
      progress(options, "applying", "正在恢复云端数据。");
      await storage.restoreCloudSyncSnapshotIfUnchanged(materializeCloudSyncSnapshot(cloudEntities, cloudEvents, assetBlobs), initialEpoch);
      await persistLedgers(state, allRemote.entities, allRemote.reviewEvents, remote.state.headRevision);
      await lease.assert();
      await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false);
      lockReleased = true;
      await updateOperation(operationId, { status: "succeeded", phase: "releasing" });
      progress(options, "done", "已以云端为准完成同步。");
      return { kind: "synced", uploaded: 0, downloaded: allRemote.entities.length + allRemote.reviewEvents.length, revision: remote.state.headRevision, pending: preservedLocal.length, restored: true };
    }
    const restored = await restoreRemote(user.uid, options, initialEpoch).catch(async (error: unknown) => {
      if (error instanceof CloudSyncLocalMutationError) throw error;
      const legacy = await getCloudSnapshotInfo(user.uid);
      if (!legacy) throw error;
      const archive = await withTimeout(
        getCloudStorageBlob(user.uid, legacySnapshotRef(user.uid)),
        ASSET_DOWNLOAD_TIMEOUT_MS,
        "下载云端旧版备份超时，请确认网络可连接 Firebase Storage 后重试。",
      );
      const snapshot = await zipToSnapshot(new File([archive], "study-journal-cloud-sync.zip", { type: "application/zip" }));
      await storage.restoreCloudSyncSnapshotIfUnchanged(snapshot, initialEpoch);
      return undefined;
    });
    if (restored) {
      await resetAndPersistLedgers(state, restored.entities, restored.reviewEvents, restored.state.headRevision);
      await lease.assert();
      await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false);
      lockReleased = true;
      await updateOperation(operationId, { status: "succeeded", phase: "releasing" });
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
    if (error instanceof CloudSyncResultUnknownError) {
      return { kind: "uncertain", operationId: error.operationId, revision: error.revision, message: error.message };
    }
    if (isTimeoutError(error)) {
      await updateOperation(operationId, { status: "unknown", phase: "reconciling", errorMessage: error instanceof Error ? error.message : String(error) });
      return {
        kind: "uncertain",
        operationId,
        revision: lock.revision,
        message: `${error instanceof Error ? error.message : String(error)} 操作结果未知，正在核对云端状态。`,
      };
    }
    if (error instanceof CloudSyncLocalMutationError) {
      if (!lockReleased) {
        await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false).catch(() => undefined);
        lockReleased = true;
      }
      await updateOperation(operationId, { status: "failed", phase: "releasing", errorMessage: error.message });
      return {
        kind: "conflict",
        conflict: { reason: "local-changed-during-sync", localChanges: 1, remoteChanges: 0, cloudRevision: (await getRemoteState(user.uid)).state.headRevision },
      };
    }
    if (!lockReleased) {
      await releaseLock(user.uid, state.deviceId, lock.operationId, lock.revision, false).catch(() => undefined);
    }
    await updateOperation(operationId, { status: "failed", phase: "releasing", errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    lease.stop();
  }
};

export const listCloudRecoverySnapshots = async (uid: string): Promise<CloudRecoverySnapshot[]> => {
  const snapshots = await withTimeout(
    getDocs(query(snapshotsRef(uid), orderBy("createdAt", "desc"))),
    FIRESTORE_READ_TIMEOUT_MS,
    "获取云端恢复快照列表超时，请确认网络可连接后重试。",
  );
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
  const initialEpoch = await storage.getCloudSyncMutationEpoch();
  const items = await withTimeout(
    getDocs(snapshotEntitiesRef(user.uid, id)),
    FIRESTORE_READ_TIMEOUT_MS,
    "读取恢复快照超时，请确认网络可连接后重试。",
  );
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
  await storage.restoreCloudSyncSnapshotIfUnchanged(materializeCloudSyncSnapshot(entities, reviewEvents, assetBlobs), initialEpoch);
  const local = await localState(user.uid);
  const revision = Math.max(0, ...entities.map((entity) => entity.revision), ...reviewEvents.map((event) => event.revision));
  await resetAndPersistLedgers(local, entities, reviewEvents, revision);
};
