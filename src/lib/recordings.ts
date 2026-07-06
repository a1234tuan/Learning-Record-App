import type { Asset, RecordBlock, Subject, SubjectConfig } from "../types";
import { normalizeSubjectName } from "./subjects";

export interface RecordingItem {
  id: string;
  assetId: string;
  asset: Asset;
  subject: Subject;
  recordId: string;
  recordTitle: string;
  recordDate: string;
  recordOrder: number;
  assetOrder: number;
  title: string;
  fileName: string;
  durationSeconds?: number;
}

export interface RecordingFolder {
  subject: Subject;
  items: RecordingItem[];
}

const normalize = (value: string): string => value.toLocaleLowerCase("zh-CN");

const subjectOrder = (subjects: SubjectConfig[]): Map<string, number> =>
  new Map(subjects.map((subject, index) => [normalizeSubjectName(subject.name), subject.order ?? index]));

const recordingTitle = (refTitle: string | undefined, asset: Asset): string =>
  refTitle?.trim() || asset.title?.trim() || asset.fileName || "录音";

export const getRecordingFolders = (
  records: RecordBlock[],
  assets: Asset[],
  subjects: SubjectConfig[],
): RecordingFolder[] => {
  const audioAssets = new Map(assets.filter((asset) => asset.kind === "audio").map((asset) => [asset.id, asset]));
  const order = subjectOrder(subjects);
  const folders = new Map<Subject, RecordingItem[]>();

  for (const subject of subjects.filter((item) => !item.archivedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    folders.set(normalizeSubjectName(subject.name), []);
  }

  const sortedRecords = [...records].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) {
      return byDate;
    }
    return a.order - b.order;
  });

  for (const record of sortedRecords) {
    const subject = normalizeSubjectName(record.subject);
    for (const [assetOrderIndex, ref] of record.assets.entries()) {
      if (ref.kind !== "audio") {
        continue;
      }
      const asset = audioAssets.get(ref.id);
      if (!asset) {
        continue;
      }
      if (!folders.has(subject)) {
        folders.set(subject, []);
      }
      folders.get(subject)?.push({
        id: `${record.id}:${ref.id}:${assetOrderIndex}`,
        assetId: ref.id,
        asset,
        subject,
        recordId: record.id,
        recordTitle: record.title,
        recordDate: record.date,
        recordOrder: record.order,
        assetOrder: assetOrderIndex,
        title: recordingTitle(ref.title, asset),
        fileName: asset.fileName,
        durationSeconds: asset.durationSeconds,
      });
    }
  }

  return Array.from(folders.entries())
    .map(([subject, items]) => ({ subject, items }))
    .sort((a, b) => {
      const aOrder = order.get(a.subject) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.subject) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.subject.localeCompare(b.subject, "zh-CN");
    });
};

export const searchRecordingItems = (folders: RecordingFolder[], query: string): RecordingItem[] => {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) {
    return [];
  }
  return folders
    .flatMap((folder) => folder.items)
    .filter((item) =>
      normalize(`${item.title} ${item.asset.title ?? ""} ${item.fileName}`).includes(normalizedQuery),
    );
};

export const formatAudioDuration = (seconds?: number): string => {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return "--:--";
  }
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
};

export const formatPlayerTime = (seconds?: number): string => {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return "00:00:00";
  }
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
};
