import { Directory, Filesystem } from "@capacitor/filesystem";

import type { Asset } from "../types";
import { blobToBase64Chunks } from "./nativeFileWriter";
import {
  getNativeMediaAvailableBytes,
  type NativePlaybackQueueItem,
  type PlaybackMode,
} from "./nativeMediaPlayback";

export type { PlaybackMode } from "./nativeMediaPlayback";

export interface PlaybackQueueInput {
  asset: Asset;
  title: string;
  subtitle: string;
}

export interface PlaybackQueueRequest {
  queueId: string;
  items: PlaybackQueueInput[];
  initialAssetId: string;
  positionSeconds?: number;
  speed?: number;
  mode?: PlaybackMode;
}

export interface PreparedPlaybackSession {
  id: string;
  directory: string;
  queueId: string;
  items: NativePlaybackQueueItem[];
  initialIndex: number;
  totalBytes: number;
}

export class PlaybackPreparationCancelledError extends Error {
  constructor() {
    super("播放准备已取消。");
  }
}

const MEDIA_ROOT = "media-playback";
const REQUIRED_FREE_BYTES = 100 * 1024 * 1024;
const STALE_SESSION_MS = 24 * 60 * 60 * 1_000;

const safeFileName = (value: string, fallback: string): string => {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const sessionDirectory = (id: string): string => `${MEDIA_ROOT}/${id}`;

export const createPlaybackSessionId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const removePreparedPlaybackSession = async (session: Pick<PreparedPlaybackSession, "directory"> | undefined): Promise<void> => {
  if (!session) return;
  await Filesystem.rmdir({ path: session.directory, directory: Directory.Data, recursive: true }).catch(() => undefined);
};

export const removeStalePlaybackSessions = async (now = Date.now()): Promise<void> => {
  const result = await Filesystem.readdir({ path: MEDIA_ROOT, directory: Directory.Data }).catch(() => undefined);
  if (!result) return;
  await Promise.all(result.files
    .filter((entry) => entry.type === "directory" && entry.mtime > 0 && now - entry.mtime > STALE_SESSION_MS)
    .map((entry) => Filesystem.rmdir({ path: `${MEDIA_ROOT}/${entry.name}`, directory: Directory.Data, recursive: true }).catch(() => undefined)));
};

export const preparePlaybackSession = async (
  request: PlaybackQueueRequest,
  shouldCancel: () => boolean,
  onProgress?: (writtenBytes: number, totalBytes: number) => void,
): Promise<PreparedPlaybackSession> => {
  if (request.items.length === 0) {
    throw new Error("播放队列不能为空。");
  }
  const totalBytes = request.items.reduce((total, item) => total + item.asset.size, 0);
  const availableBytes = await getNativeMediaAvailableBytes();
  if (availableBytes !== undefined && availableBytes < totalBytes + REQUIRED_FREE_BYTES) {
    throw new Error("设备可用空间不足，无法准备后台播放队列。");
  }

  const id = createPlaybackSessionId();
  const directory = sessionDirectory(id);
  const staged: Pick<PreparedPlaybackSession, "directory"> = { directory };
  let writtenBytes = 0;

  try {
    const items: NativePlaybackQueueItem[] = [];
    for (let itemIndex = 0; itemIndex < request.items.length; itemIndex += 1) {
      if (shouldCancel()) throw new PlaybackPreparationCancelledError();
      const input = request.items[itemIndex];
      const path = `${directory}/${itemIndex}-${safeFileName(input.asset.fileName, input.asset.id)}`;
      let uri = "";
      let wroteFirstChunk = false;
      for await (const chunk of blobToBase64Chunks(input.asset.data)) {
        if (shouldCancel()) throw new PlaybackPreparationCancelledError();
        if (!wroteFirstChunk) {
          const result = await Filesystem.writeFile({ path, directory: Directory.Data, data: chunk.data, recursive: true });
          uri = result.uri;
          wroteFirstChunk = true;
        } else {
          await Filesystem.appendFile({ path, directory: Directory.Data, data: chunk.data });
        }
        writtenBytes += chunk.end - chunk.start;
        onProgress?.(writtenBytes, totalBytes);
      }
      if (!wroteFirstChunk) {
        const result = await Filesystem.writeFile({ path, directory: Directory.Data, data: "", recursive: true });
        uri = result.uri;
      }
      if (!uri) {
        uri = (await Filesystem.getUri({ path, directory: Directory.Data })).uri;
      }
      items.push({
        assetId: input.asset.id,
        uri,
        title: input.title,
        subtitle: input.subtitle,
        mimeType: input.asset.mimeType || input.asset.data.type || "application/octet-stream",
        queueId: request.queueId,
        durationSeconds: input.asset.durationSeconds,
      });
    }
    const initialIndex = items.findIndex((item) => item.assetId === request.initialAssetId);
    if (initialIndex < 0) {
      throw new Error("初始播放音频不在播放队列中。");
    }
    return { id, directory, queueId: request.queueId, items, initialIndex, totalBytes };
  } catch (error) {
    await removePreparedPlaybackSession(staged);
    throw error;
  }
};
