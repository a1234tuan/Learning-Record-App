import { Share } from "@capacitor/share";
import JSZip from "jszip";
import { saveAs } from "file-saver";

import type {
  Asset,
  ExportOptions,
  ImportOptions,
  RecordBlock,
  RecordTransferManifest,
  RecordTransferPackage,
  RecordTransferPayload,
  RecordTransferSummary,
  StorageAdapter,
} from "../types";
import { nowISO } from "../lib/date";
import { newId } from "../lib/entity";
import { isNativePlatform } from "../lib/platform";
import { normalizeSubjectName } from "../lib/subjects";
import { syncRecordRefsFromContent } from "../lib/recordContent";
import { normalizeNativeShareError, writeBlobToNativeShareCache } from "./nativeFileWriter";
import { markAutoBackupDirty } from "./autoBackupService";

const FORMAT = "study-journal-record-transfer" as const;
const VERSION = 1 as const;
const MIME_TYPE = "application/zip";
let importInProgress = false;

const assetPath = (id: string) => `assets/${id}`;
const TRANSFER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ASSET_KINDS = new Set<Asset["kind"]>(["image", "audio", "attachment"]);

const toAssetMeta = (asset: Asset) => {
  const { data: _data, ...meta } = asset;
  return { ...meta, path: assetPath(asset.id) };
};

const transferFileName = () => `study-journal-records-${nowISO().slice(0, 10)}.zip`;

const toFile = (blob: Blob, fileName: string, mimeType: string) => new File([blob], fileName, { type: mimeType });

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new Error("已取消日志互通操作，当前本地数据没有修改。");
  }
};

const writeOrShare = async (blob: Blob, fileName: string, options: ExportOptions = {}): Promise<string> => {
  if (!isNativePlatform()) {
    saveAs(blob, fileName);
    return "已开始下载日志互通包。";
  }

  const result = await writeBlobToNativeShareCache({
    blob,
    fileName,
    mimeType: MIME_TYPE,
    onProgress: options.onProgress,
  });
  options.onProgress?.({ stage: "sharing", message: "正在打开系统保存/分享面板。" });
  try {
    await Share.share({
      title: "学习日志互通包",
      text: "这是可在 Web 和 Android 间导入的学习日志记录。",
      files: [result.uri],
      dialogTitle: "保存或分享日志互通包",
    });
  } catch (error) {
    throw normalizeNativeShareError(error);
  }
  options.onProgress?.({ stage: "done", message: "日志互通包已交给系统分享面板。" });
  return "已打开系统保存/分享面板。";
};

const assertTransferPayload = (payload: RecordTransferPayload) => {
  if (!payload.manifest || payload.manifest.format !== FORMAT || payload.manifest.version !== VERSION) {
    const format = payload.manifest?.format ?? "未知";
    const version = payload.manifest?.version ?? "未知";
    throw new Error(`日志互通包格式不兼容：format=${format}，version=${version}。`);
  }
  if (!Array.isArray(payload.records) || !Array.isArray(payload.assets) || !Array.isArray(payload.subjects)) {
    throw new Error("日志互通包数据不完整。");
  }
  if (payload.manifest.counts.records !== payload.records.length || payload.manifest.counts.assets !== payload.assets.length) {
    throw new Error("日志互通包清单数量与数据不一致。");
  }
  const recordIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const record of payload.records) {
    if (
      record.type !== "record" ||
      !TRANSFER_ID.test(record.id) ||
      recordIds.has(record.id) ||
      !ISO_DATE.test(record.date) ||
      !Number.isSafeInteger(record.order) ||
      record.order < 0 ||
      typeof record.subject !== "string" ||
      typeof record.title !== "string" ||
      typeof record.contentHtml !== "string" ||
      !Array.isArray(record.assets) ||
      !Array.isArray(record.formulas) ||
      !Array.isArray(record.mistakeRefs) ||
      typeof record.createdAt !== "string" ||
      typeof record.updatedAt !== "string"
    ) {
      throw new Error("日志互通包包含无效或重复的记录。");
    }
    recordIds.add(record.id);
  }
  for (const asset of payload.assets) {
    if (
      !TRANSFER_ID.test(asset.id) ||
      assetIds.has(asset.id) ||
      asset.path !== assetPath(asset.id) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      !asset.fileName ||
      !asset.mimeType ||
      !ASSET_KINDS.has(asset.kind) ||
      typeof asset.createdAt !== "string" ||
      typeof asset.updatedAt !== "string"
    ) {
      throw new Error("日志互通包包含无效或重复的资源。");
    }
    assetIds.add(asset.id);
  }
  if (payload.subjects.some((subject) => typeof subject !== "string" || !subject.trim())) {
    throw new Error("日志互通包包含无效学科信息。");
  }
  for (const record of payload.records) {
    const synced = syncRecordRefsFromContent({ ...record, mistakeRefs: [] });
    for (const ref of synced.assets) {
      if (!assetIds.has(ref.id)) {
        throw new Error(`日志“${record.title}”缺少资源 ${ref.id}。`);
      }
    }
  }
};

const rewriteImportedHtml = (contentHtml: string, assetIds: Map<string, string>, recordIds: Map<string, string>): string => {
  const doc = new DOMParser().parseFromString(contentHtml || "<p></p>", "text/html");
  for (const node of Array.from(doc.querySelectorAll("record-asset"))) {
    const id = node.getAttribute("data-asset-id") ?? "";
    const nextId = assetIds.get(id);
    if (nextId) {
      node.setAttribute("data-asset-id", nextId);
    }
  }
  for (const node of Array.from(doc.querySelectorAll("record-reference"))) {
    const id = node.getAttribute("data-record-id") ?? "";
    const nextId = recordIds.get(id);
    if (nextId) {
      node.setAttribute("data-record-id", nextId);
    }
  }
  return doc.body.innerHTML || "<p></p>";
};

export const createRecordTransferPackage = async (
  store: StorageAdapter,
  recordIds: readonly string[],
  options: ExportOptions = {},
): Promise<Blob> => {
  throwIfAborted(options.signal);
  const wanted = new Set(recordIds);
  if (wanted.size === 0) {
    throw new Error("请至少选择一条日志后再导出。");
  }
  options.onProgress?.({ stage: "preparing", message: "正在收集选中日志和资源。" });
  const blocks = await store.listBlocks();
  const records = blocks
    .filter((block): block is RecordBlock => block.type === "record" && wanted.has(block.id))
    .map((record) => syncRecordRefsFromContent({ ...record, mistakeRefs: [] }));
  if (records.length !== wanted.size) {
    throw new Error("部分选中日志不存在或已删除，无法导出。");
  }

  const assetIds = Array.from(new Set(records.flatMap((record) => record.assets.map((asset) => asset.id))));
  const assets: Asset[] = [];
  for (const [index, id] of assetIds.entries()) {
    throwIfAborted(options.signal);
    options.onProgress?.({ stage: "asset", message: `正在读取资源 ${index + 1}/${assetIds.length}。`, current: index + 1, total: assetIds.length });
    const asset = await store.getAsset(id);
    if (!asset) {
      throw new Error(`日志资源 ${id} 已缺失，无法生成完整互通包。`);
    }
    assets.push(asset);
  }

  const manifest: RecordTransferManifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: nowISO(),
    appVersion: "0.1.0",
    counts: { records: records.length, assets: assets.length },
  };
  const payload: RecordTransferPayload = {
    manifest,
    records,
    subjects: Array.from(new Set(records.map((record) => normalizeSubjectName(record.subject)))),
    assets: assets.map(toAssetMeta),
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("records.json", JSON.stringify({ records: payload.records, subjects: payload.subjects, assets: payload.assets }, null, 2));
  for (const asset of assets) {
    throwIfAborted(options.signal);
    zip.file(assetPath(asset.id), asset.data);
  }
  options.onProgress?.({ stage: "zipping", message: "正在压缩日志互通包。" });
  const result = await zip.generateAsync({ type: "blob" }, (metadata) => {
    options.onProgress?.({
      stage: "zipping",
      message: `正在压缩日志互通包 ${Math.round(metadata.percent)}% 。`,
      current: Math.round(metadata.percent),
      total: 100,
    });
  });
  throwIfAborted(options.signal);
  return result;
};

export const exportRecordTransferPackage = async (
  store: StorageAdapter,
  recordIds: readonly string[],
  options: ExportOptions = {},
): Promise<string> => writeOrShare(await createRecordTransferPackage(store, recordIds, options), transferFileName(), options);

export const parseRecordTransferPackage = async (file: File, options: ImportOptions = {}): Promise<RecordTransferPackage> => {
  throwIfAborted(options.signal);
  const looksLikeZip = file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip");
  if (!looksLikeZip) {
    throw new Error("不支持的文件格式：请选择日志互通 zip。完整备份请使用“导入恢复”。");
  }
  let zip: JSZip;
  try {
    options.onProgress?.({ stage: "loading", message: "正在校验日志互通包。" });
    zip = await JSZip.loadAsync(file, { checkCRC32: true });
  } catch {
    throw new Error("文件不是有效的日志互通 zip，或文件已损坏。");
  }
  throwIfAborted(options.signal);
  const [manifestFile, recordsFile] = [zip.file("manifest.json"), zip.file("records.json")];
  if (!manifestFile || !recordsFile) {
    throw new Error("不是日志互通包：缺少 manifest.json 或 records.json。\n");
  }
  let manifest: RecordTransferManifest;
  let data: Omit<RecordTransferPayload, "manifest">;
  try {
    manifest = JSON.parse(await manifestFile.async("string")) as RecordTransferManifest;
    data = JSON.parse(await recordsFile.async("string")) as Omit<RecordTransferPayload, "manifest">;
  } catch {
    throw new Error("日志互通包元数据损坏。\n");
  }
  const payload: RecordTransferPayload = { manifest, ...data };
  assertTransferPayload(payload);
  const readAsset = async (meta: RecordTransferPayload["assets"][number], signal = options.signal): Promise<File> => {
    throwIfAborted(signal);
    const entry = zip.file(meta.path);
    if (!entry) {
      throw new Error(`日志互通包缺少资源文件：${meta.fileName}。`);
    }
    const blob = await entry.async("blob");
    throwIfAborted(signal);
    if (blob.size !== meta.size) {
      throw new Error(`日志互通包资源大小不匹配：${meta.fileName}。`);
    }
    return toFile(blob, meta.fileName, meta.mimeType);
  };

  // Validate one resource at a time, then discard the Blob. This keeps the
  // preview phase bounded even when the transfer package contains many files.
  for (const [index, meta] of payload.assets.entries()) {
    throwIfAborted(options.signal);
    options.onProgress?.({ stage: "assets", message: `正在读取资源 ${index + 1}/${payload.assets.length}。`, current: index + 1, total: payload.assets.length });
    await readAsset(meta);
  }
  options.onProgress?.({ stage: "done", message: "日志互通包解析完成。" });
  return {
    payload,
    readAsset: async (id, signal) => {
      const meta = payload.assets.find((asset) => asset.id === id);
      if (!meta) {
        throw new Error(`日志互通包缺少资源元数据：${id}。`);
      }
      return readAsset(meta, signal);
    },
  };
};

const resetImportedOcrState = (asset: Asset): Asset =>
  asset.ocrStatus === "queued" || asset.ocrStatus === "running"
    ? { ...asset, ocrStatus: "idle", ocrError: undefined, ocrJobId: undefined, ocrUpdatedAt: undefined }
    : asset;

export const importRecordTransferPackage = async (
  store: StorageAdapter,
  transfer: RecordTransferPackage,
  selectedRecordIds: readonly string[],
  options: ImportOptions = {},
): Promise<RecordTransferSummary> => {
  throwIfAborted(options.signal);
  if (importInProgress) {
    throw new Error("已有日志导入任务正在进行，请等待完成。\n");
  }
  const selectedIds = new Set(selectedRecordIds);
  const sourceRecords = transfer.payload.records.filter((record) => selectedIds.has(record.id));
  if (sourceRecords.length === 0) {
    throw new Error("请至少选择一条日志后再导入。\n");
  }
  if (sourceRecords.length !== selectedIds.size) {
    throw new Error("选择的日志不存在于当前互通包。\n");
  }

  importInProgress = true;
  const sessionId = `record-transfer-${newId()}`;
  try {
    options.onProgress?.({ stage: "parsing", message: "正在准备导入并检查本地冲突。" });
    const [currentBlocks, deletedRecords] = await Promise.all([store.listBlocks(), store.listDeletedBlocks()]);
    throwIfAborted(options.signal);
    const existingRecordIds = new Set([...currentBlocks, ...deletedRecords].map((record) => record.id));
    const recordIdMap = new Map(sourceRecords.map((record) => [record.id, existingRecordIds.has(record.id) ? newId() : record.id]));
    const sourceAssetIds = Array.from(new Set(sourceRecords.flatMap((record) => syncRecordRefsFromContent(record).assets.map((asset) => asset.id))));
    const assetIdMap = new Map<string, string>();
    for (const id of sourceAssetIds) {
      throwIfAborted(options.signal);
      assetIdMap.set(id, (await store.getAsset(id)) ? newId() : id);
    }

    const records = sourceRecords.map((source) => {
      const contentHtml = rewriteImportedHtml(source.contentHtml, assetIdMap, recordIdMap);
      return syncRecordRefsFromContent({
        ...source,
        id: recordIdMap.get(source.id) ?? source.id,
        contentHtml,
        assets: [],
        formulas: [],
        mistakeRefs: [],
        deletedAt: undefined,
      });
    });

    for (const [index, sourceId] of sourceAssetIds.entries()) {
      throwIfAborted(options.signal);
      options.onProgress?.({ stage: "assets", message: `正在暂存资源 ${index + 1}/${sourceAssetIds.length}。`, current: index + 1, total: sourceAssetIds.length });
      const meta = transfer.payload.assets.find((asset) => asset.id === sourceId);
      if (!meta) {
        throw new Error(`日志互通包缺少所选资源 ${sourceId}。`);
      }
      const file = await transfer.readAsset(sourceId, options.signal);
      throwIfAborted(options.signal);
      await store.stageRecordTransferAsset(sessionId, resetImportedOcrState({ ...meta, id: assetIdMap.get(sourceId) ?? sourceId, data: file }));
    }

    throwIfAborted(options.signal);
    options.onProgress?.({ stage: "restoring", message: "资源校验完成，正在一次性导入日志。" });
    const summary = await store.commitRecordTransfer(sessionId, records);
    options.onProgress?.({ stage: "done", message: "日志导入完成。" });
    void markAutoBackupDirty("record-transfer-import").catch(() => undefined);
    return summary;
  } catch (error) {
    await store.discardRecordTransfer(sessionId);
    throw error;
  } finally {
    importInProgress = false;
  }
};
