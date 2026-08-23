import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  addListener: vi.fn().mockResolvedValue(undefined),
  canUse: vi.fn(() => true),
  getState: vi.fn().mockResolvedValue(undefined),
  prepare: vi.fn(),
  requestNotification: vi.fn().mockResolvedValue(true),
  stop: vi.fn().mockResolvedValue(undefined),
}));
const sessions = vi.hoisted(() => ({
  prepare: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  removeStale: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
}));

vi.mock("../services/mediaPlaybackService", () => ({
  PlaybackPreparationCancelledError: class PlaybackPreparationCancelledError extends Error {},
  preparePlaybackSession: sessions.prepare,
  removePreparedPlaybackSession: sessions.remove,
  removeStalePlaybackSessions: sessions.removeStale,
}));

vi.mock("../services/nativeMediaPlayback", () => ({
  addNativeMediaStateListener: native.addListener,
  canUseNativeMediaPlayback: native.canUse,
  getNativeMediaState: native.getState,
  nextNativeMedia: vi.fn(),
  pauseNativeMedia: vi.fn(),
  playNativeMedia: vi.fn(),
  prepareNativeMediaPlayback: native.prepare,
  previousNativeMedia: vi.fn(),
  requestNativeMediaNotificationPermission: native.requestNotification,
  seekNativeMediaBy: vi.fn(),
  seekNativeMediaTo: vi.fn(),
  setNativeMediaMode: vi.fn(),
  setNativeMediaSpeed: vi.fn(),
  stopNativeMedia: native.stop,
}));

import { PlaybackProvider, usePlayback } from "./PlaybackProvider";

describe("PlaybackProvider", () => {
  it("keeps the native service available and releases the staged session when one queue fails", async () => {
    sessions.prepare.mockResolvedValue({
      directory: "media-playback/session",
      queueId: "podcast:1",
      initialIndex: 0,
      items: [{ assetId: "asset-1", uri: "file:///data/audio.mp3", title: "章节", subtitle: "播客", mimeType: "audio/mpeg", queueId: "podcast:1" }],
    });
    native.prepare.mockRejectedValue(new Error("decoder failure"));

    let playback: ReturnType<typeof usePlayback> | undefined;
    const Probe = () => {
      playback = usePlayback();
      return <span>{playback.nativeEnabled ? "native" : "fallback"}</span>;
    };
    const { getByText } = render(<PlaybackProvider><Probe /></PlaybackProvider>);

    await act(async () => {
      await expect(playback!.startQueue({
        queueId: "podcast:1",
        items: [{ asset: { id: "asset-1", size: 4 }, title: "章节", subtitle: "播客" } as never],
        initialAssetId: "asset-1",
      })).rejects.toThrow("已切换为普通播放");
    });

    await waitFor(() => expect(getByText("native")).toBeInTheDocument());
    expect(native.stop).toHaveBeenCalled();
    expect(sessions.remove).toHaveBeenCalledWith({ directory: "media-playback/session", queueId: "podcast:1", initialIndex: 0, items: expect.any(Array) });
  });
});
