import { beforeEach, describe, expect, it, vi } from "vitest";

const { filesystem, getNativeMediaAvailableBytes } = vi.hoisted(() => ({
  filesystem: {
    appendFile: vi.fn(),
    getUri: vi.fn(),
    readdir: vi.fn(),
    rmdir: vi.fn(),
    writeFile: vi.fn(),
  },
  getNativeMediaAvailableBytes: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: filesystem,
}));

vi.mock("./nativeMediaPlayback", () => ({
  getNativeMediaAvailableBytes,
}));

vi.mock("./nativeFileWriter", () => ({
  blobToBase64Chunks: async function* () {
    yield { data: "first", index: 0, total: 2, start: 0, end: 3 };
    yield { data: "second", index: 1, total: 2, start: 3, end: 5 };
  },
}));

import { normalizePlaybackMimeType, preparePlaybackSession, removeStalePlaybackSessions } from "./mediaPlaybackService";

const asset = {
  id: "asset-1",
  fileName: "lecture.m4a",
  mimeType: "audio/mp4",
  size: 5,
  data: new Blob(["audio"]),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  getNativeMediaAvailableBytes.mockResolvedValue(500 * 1024 * 1024);
  filesystem.writeFile.mockResolvedValue({ uri: "file:///data/media-playback/session/0-lecture.m4a" });
  filesystem.appendFile.mockResolvedValue(undefined);
  filesystem.rmdir.mockResolvedValue(undefined);
});

describe("preparePlaybackSession", () => {
  it("writes every Blob in chunks and returns private file queue items", async () => {
    const session = await preparePlaybackSession({
      queueId: "recordings:os",
      items: [{ asset, title: "调度讲解", subtitle: "进程同步" }],
      initialAssetId: "asset-1",
    }, () => false);

    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    expect(filesystem.appendFile).toHaveBeenCalledWith(expect.objectContaining({ data: "second", directory: "DATA" }));
    expect(session.initialIndex).toBe(0);
    expect(session.queueId).toBe("recordings:os");
    expect(session.items).toEqual([expect.objectContaining({ assetId: "asset-1", queueId: "recordings:os", uri: expect.stringContaining("file://") })]);
  });

  it("rejects before writing when the queue cannot fit with the reserve", async () => {
    getNativeMediaAvailableBytes.mockResolvedValue(100 * 1024 * 1024);

    await expect(preparePlaybackSession({
      queueId: "recordings:os",
      items: [{ asset, title: "调度讲解", subtitle: "进程同步" }],
      initialAssetId: "asset-1",
    }, () => false)).rejects.toThrow("可用空间不足");

    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("rejects an empty audio asset before it creates a native queue", async () => {
    const emptyAsset = { ...asset, size: 0, data: new Blob() };

    await expect(preparePlaybackSession({
      queueId: "recordings:os",
      items: [{ asset: emptyAsset, title: "空文件", subtitle: "进程同步" }],
      initialAssetId: "asset-1",
    }, () => false)).rejects.toThrow("音频文件为空");

    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("derives an audio MIME type instead of passing application/octet-stream to ExoPlayer", () => {
    expect(normalizePlaybackMimeType({ ...asset, fileName: "episode.mp3", mimeType: "application/octet-stream" })).toBe("audio/mpeg");
    expect(normalizePlaybackMimeType({ ...asset, fileName: "episode.m4a", mimeType: "" })).toBe("audio/mp4");
  });

  it("rejects when the requested initial item is not in the staged queue", async () => {
    await expect(preparePlaybackSession({
      queueId: "recordings:os",
      items: [{ asset, title: "调度讲解", subtitle: "进程同步" }],
      initialAssetId: "missing-asset",
    }, () => false)).rejects.toThrow("初始播放音频不在播放队列中");

    expect(filesystem.rmdir).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining("media-playback/"),
      recursive: true,
    }));
  });
});

describe("removeStalePlaybackSessions", () => {
  it("removes only directories older than 24 hours", async () => {
    const now = 2_000_000_000;
    filesystem.readdir.mockResolvedValue({
      files: [
        { name: "old", type: "directory", mtime: now - 86_400_001 },
        { name: "current", type: "directory", mtime: now - 86_400_000 },
        { name: "track.m4a", type: "file", mtime: 0 },
      ],
    });

    await removeStalePlaybackSessions(now);

    expect(filesystem.rmdir).toHaveBeenCalledTimes(1);
    expect(filesystem.rmdir).toHaveBeenCalledWith({ path: "media-playback/old", directory: "DATA", recursive: true });
  });
});
