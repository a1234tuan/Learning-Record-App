import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset, RecordBlock, SubjectConfig } from "../types";
import { RecordingsPage } from "./RecordingsPage";

const stamp = "2026-06-21T00:00:00.000Z";
const createObjectUrlMock = vi.fn(() => "blob:audio");
const revokeObjectUrlMock = vi.fn();
const playMock = vi.fn(() => Promise.resolve());
const pauseMock = vi.fn();

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectUrlMock,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectUrlMock,
    configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    value: playMock,
    configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    value: pauseMock,
    configurable: true,
  });
});

beforeEach(() => {
  createObjectUrlMock.mockClear();
  revokeObjectUrlMock.mockClear();
  playMock.mockReset();
  playMock.mockResolvedValue(undefined);
  pauseMock.mockClear();
});

const subjects: SubjectConfig[] = [
  {
    id: "subject-os",
    createdAt: stamp,
    updatedAt: stamp,
    name: "OS",
    order: 0,
  },
  {
    id: "subject-math",
    createdAt: stamp,
    updatedAt: stamp,
    name: "数学",
    order: 1,
  },
];

const asset: Asset = {
  id: "audio-1",
  createdAt: stamp,
  updatedAt: stamp,
  fileName: "scheduler.m4a",
  title: "原始录音",
  mimeType: "audio/mp4",
  size: 128,
  kind: "audio",
  data: new Blob(["audio"]),
  durationSeconds: 75,
};

const record: RecordBlock = {
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject: "OS",
  title: "进程同步",
  contentHtml: "<p></p>",
  assets: [{ id: "audio-1", title: "调度讲解", kind: "audio" }],
  formulas: [],
  mistakeRefs: [],
};

const renderPage = (overrides: Partial<ComponentProps<typeof RecordingsPage>> = {}) => {
  const props: ComponentProps<typeof RecordingsPage> = {
    blocks: [record],
    assets: [asset],
    subjects,
    query: "",
    searchOpen: false,
    onSelectedSubjectChange: vi.fn(),
    onPlayerChange: vi.fn(),
    onQueryChange: vi.fn(),
    onSearchOpenChange: vi.fn(),
    onRenameAudio: vi.fn(),
    onDurationKnown: vi.fn(),
    ...overrides,
  };
  render(<RecordingsPage {...props} />);
  return props;
};

describe("RecordingsPage", () => {
  it("renders subject folders with recording counts", () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: /OS/ }));

    expect(screen.getByText("1 条录音")).toBeInTheDocument();
    expect(screen.getByText("0 条录音")).toBeInTheDocument();
    expect(props.onSelectedSubjectChange).toHaveBeenCalledWith("OS");
  });

  it("exposes a root-level return action when opened from More", () => {
    const onBack = vi.fn();
    renderPage({ onBack });

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("lists recordings inside a subject folder", () => {
    renderPage({ selectedSubject: "OS" });

    expect(screen.getByText("进程同步")).toBeInTheDocument();
    expect(screen.getByText("调度讲解")).toBeInTheDocument();
    expect(screen.getByText(/01:15/)).toBeInTheDocument();
  });

  it("searches recordings by recording title and file name", () => {
    renderPage({ searchOpen: true, query: "scheduler" });

    expect(screen.getByText("调度讲解")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /数学/ })).not.toBeInTheDocument();
  });

  it("renames recordings through the global rename callback", async () => {
    const onRenameAudio = vi.fn().mockResolvedValue(undefined);
    renderPage({ selectedSubject: "OS", onRenameAudio });

    fireEvent.click(screen.getByRole("button", { name: "重命名 调度讲解" }));
    fireEvent.change(screen.getByLabelText("录音标题"), { target: { value: "新的录音名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onRenameAudio).toHaveBeenCalledWith("audio-1", "新的录音名"));
  });

  it("autoplays after metadata is ready and advances the timer", async () => {
    renderPage({ selectedSubject: "OS", playerAssetId: "audio-1" });

    const audio = document.querySelector("audio") as HTMLAudioElement;
    expect(audio).toBeTruthy();
    Object.defineProperty(audio, "duration", { value: 75, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 12, writable: true, configurable: true });
    fireEvent.loadedMetadata(audio);
    fireEvent.canPlay(audio);
    fireEvent.play(audio);
    fireEvent.timeUpdate(audio);

    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTitle("暂停")).toBeInTheDocument();
    expect(screen.getByText("00:00:12")).toBeInTheDocument();
  });

  it("keeps the same audio source when duration caching rerenders assets", async () => {
    const props: ComponentProps<typeof RecordingsPage> = {
      blocks: [record],
      assets: [asset],
      subjects,
      selectedSubject: "OS",
      playerAssetId: "audio-1",
      query: "",
      searchOpen: false,
      onSelectedSubjectChange: vi.fn(),
      onPlayerChange: vi.fn(),
      onQueryChange: vi.fn(),
      onSearchOpenChange: vi.fn(),
      onRenameAudio: vi.fn(),
      onDurationKnown: vi.fn(),
    };
    const { rerender } = render(<RecordingsPage {...props} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { value: 75, configurable: true });
    fireEvent.loadedMetadata(audio);

    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
    const objectUrlCalls = createObjectUrlMock.mock.calls.length;

    rerender(<RecordingsPage {...props} assets={[{ ...asset, durationSeconds: 75 }]} />);

    expect(createObjectUrlMock).toHaveBeenCalledTimes(objectUrlCalls);
  });

  it("renders the dedicated player controls", () => {
    renderPage({ selectedSubject: "OS", playerAssetId: "audio-1" });

    expect(screen.getByText("00:00:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /单录音循环/ })).toBeInTheDocument();
    expect(screen.getByTitle("快退 10 秒")).toBeInTheDocument();
    expect(screen.getByTitle("快进 10 秒")).toBeInTheDocument();
  });

  it("does not expose interrupted play errors to users", async () => {
    const abortError = new DOMException("The play() request was interrupted by a new load request", "AbortError");
    playMock.mockRejectedValueOnce(abortError);
    renderPage({ selectedSubject: "OS", playerAssetId: "audio-1" });

    const audio = document.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { value: 75, configurable: true });
    fireEvent.loadedMetadata(audio);

    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTitle("播放")).toBeInTheDocument();
    expect(screen.queryByText(/interrupted by a new load request/i)).not.toBeInTheDocument();
  });
});
