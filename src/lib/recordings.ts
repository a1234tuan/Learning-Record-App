import type { Asset, KnowledgePodcast, RecordBlock, Subject, SubjectConfig } from "../types";
import { normalizeSubjectName } from "./subjects";

export type RecordingFolderKind = "subject" | "knowledge-podcast";

export interface RecordingItem {
  id: string;
  assetId: string;
  asset: Asset;
  folderId: string;
  folderTitle: string;
  folderKind: RecordingFolderKind;
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
  id: string;
  title: string;
  kind: RecordingFolderKind;
  items: RecordingItem[];
}

const normalize = (value: string): string => value.toLocaleLowerCase("zh-CN");

const subjectOrder = (subjects: SubjectConfig[]): Map<string, number> =>
  new Map(subjects.map((subject, index) => [normalizeSubjectName(subject.name), subject.order ?? index]));

export const recordingFolderIdForSubject = (subject: Subject): string => `subject:${normalizeSubjectName(subject)}`;

export const recordingFolderIdForPodcast = (podcastId: string): string => `knowledge-podcast:${podcastId}`;

const recordingTitle = (refTitle: string | undefined, asset: Asset): string =>
  refTitle?.trim() || asset.title?.trim() || asset.fileName || "录音";

export const getRecordingFolders = (
  records: RecordBlock[],
  assets: Asset[],
  subjects: SubjectConfig[],
  podcasts: KnowledgePodcast[] = [],
): RecordingFolder[] => {
  const audioAssets = new Map(assets.filter((asset) => asset.kind === "audio" && asset.generatedBy !== "knowledge-podcast").map((asset) => [asset.id, asset]));
  const podcastAudioAssets = new Map(assets.filter((asset) => asset.kind === "audio" && asset.generatedBy === "knowledge-podcast").map((asset) => [asset.id, asset]));
  const order = subjectOrder(subjects);
  const folders = new Map<string, RecordingFolder>();

  for (const subject of subjects.filter((item) => !item.archivedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const title = normalizeSubjectName(subject.name);
    folders.set(recordingFolderIdForSubject(title), {
      id: recordingFolderIdForSubject(title),
      title,
      kind: "subject",
      items: [],
    });
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
    const folderId = recordingFolderIdForSubject(subject);
    if (!folders.has(folderId)) {
      folders.set(folderId, { id: folderId, title: subject, kind: "subject", items: [] });
    }
    const folder = folders.get(folderId)!;
    for (const [assetOrderIndex, ref] of record.assets.entries()) {
      if (ref.kind !== "audio") {
        continue;
      }
      const asset = audioAssets.get(ref.id);
      if (!asset) {
        continue;
      }
      folder.items.push({
        id: `${record.id}:${ref.id}:${assetOrderIndex}`,
        assetId: ref.id,
        asset,
        folderId,
        folderTitle: subject,
        folderKind: "subject",
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

  const subjectFolders = Array.from(folders.values())
    .sort((a, b) => {
      const aOrder = order.get(a.title) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.title) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.title.localeCompare(b.title, "zh-CN");
    });

  const podcastFolders = [...podcasts]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((podcast): RecordingFolder => {
      const id = recordingFolderIdForPodcast(podcast.id);
      return {
        id,
        title: podcast.title.trim() || "未命名知识播客",
        kind: "knowledge-podcast",
        items: (podcast.audioLayoutVersion === 2 ? [...(podcast.audioUnits ?? [])] : [])
          .sort((a, b) => a.order - b.order)
          .flatMap((unit) => {
            if (unit.audioStatus !== "ready") return [];
            const asset = unit.audioAssetId ? podcastAudioAssets.get(unit.audioAssetId) : undefined;
            if (!asset) return [];
            return [{
              id: `${podcast.id}:${unit.id}`,
              assetId: asset.id,
              asset,
              folderId: id,
              folderTitle: podcast.title.trim() || "未命名知识播客",
              folderKind: "knowledge-podcast",
              recordId: podcast.id,
              recordTitle: "知识播客",
              recordDate: podcast.createdAt.slice(0, 10),
              recordOrder: 0,
              assetOrder: unit.order,
              title: asset.title?.trim() || unit.title,
              fileName: asset.fileName,
              durationSeconds: asset.durationSeconds ?? unit.durationSeconds,
            }];
          }),
      };
    })
    .filter((folder) => folder.items.length > 0);

  return [...subjectFolders, ...podcastFolders];
};

export const searchRecordingItems = (folders: RecordingFolder[], query: string): RecordingItem[] => {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) {
    return [];
  }
  return folders
    .flatMap((folder) => folder.items)
    .filter((item) =>
      normalize(`${item.folderKind === "knowledge-podcast" ? item.folderTitle : ""} ${item.title} ${item.asset.title ?? ""} ${item.fileName}`).includes(normalizedQuery),
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
