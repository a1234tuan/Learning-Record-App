import {
  ArrowLeft,
  Check,
  ChevronRight,
  Edit3,
  FastForward,
  Folder,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Asset, Block, KnowledgePodcast, SubjectConfig } from "../types";
import type { RecordingPlayerQueueSource } from "../lib/tabNavigation";
import { PageHeader } from "../components/ui";
import { usePlayback } from "../components/PlaybackProvider";
import type { PlaybackMode } from "../services/nativeMediaPlayback";
import { getRecordBlocks } from "../lib/journalSelectors";
import {
  formatAudioDuration,
  formatPlayerTime,
  getRecordingFolders,
  searchRecordingItems,
  type RecordingFolder,
  type RecordingItem,
} from "../lib/recordings";

interface RecordingsPageProps {
  blocks: Block[];
  assets: Asset[];
  podcasts: KnowledgePodcast[];
  subjects: SubjectConfig[];
  selectedFolderId?: string;
  playerAssetId?: string;
  playerQueueSource?: RecordingPlayerQueueSource;
  query: string;
  searchOpen: boolean;
  onSelectedFolderChange: (folderId: string | undefined) => void;
  onPlayerChange: (assetId: string | undefined, source?: RecordingPlayerQueueSource) => void;
  onQueryChange: (query: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onRenameAudio: (assetId: string, title: string) => Promise<void> | void;
  onDurationKnown: (assetId: string, durationSeconds: number) => Promise<void> | void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
type PlaybackSpeed = (typeof SPEEDS)[number];
type PlayMode = PlaybackMode;

const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  single: "单录音循环",
  order: "顺序播放",
  shuffle: "随机播放",
};

const nextMode = (mode: PlayMode): PlayMode =>
  mode === "order" ? "single" : mode === "single" ? "shuffle" : "order";

const clampTime = (value: number, duration: number) => Math.min(Math.max(value, 0), Number.isFinite(duration) ? duration : value);

const AudioDuration = ({
  item,
  onDurationKnown,
}: {
  item: RecordingItem;
  onDurationKnown: (assetId: string, durationSeconds: number) => Promise<void> | void;
}) => {
  const [duration, setDuration] = useState(item.durationSeconds);

  useEffect(() => {
    setDuration(item.durationSeconds);
  }, [item.assetId, item.durationSeconds]);

  useEffect(() => {
    if (duration !== undefined) {
      return undefined;
    }

    let active = true;
    const url = URL.createObjectURL(item.asset.data);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    audio.onloadedmetadata = () => {
      if (!active || !Number.isFinite(audio.duration)) {
        return;
      }
      const nextDuration = Math.round(audio.duration);
      setDuration(nextDuration);
      void onDurationKnown(item.assetId, nextDuration);
    };
    audio.onerror = () => {
      if (active) {
        setDuration(undefined);
      }
    };

    return () => {
      active = false;
      audio.src = "";
      URL.revokeObjectURL(url);
    };
  }, [duration, item.asset.data, item.assetId, onDurationKnown]);

  return <>{formatAudioDuration(duration)}</>;
};

const RecordingRenameControl = ({
  item,
  onRename,
}: {
  item: RecordingItem;
  onRename: (assetId: string, title: string) => Promise<void> | void;
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) {
      setValue(item.title);
    }
  }, [editing, item.title]);

  const commit = async () => {
    const nextTitle = value.trim();
    if (!nextTitle) {
      setValue(item.title);
      setEditing(false);
      return;
    }
    if (nextTitle === item.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onRename(item.assetId, nextTitle);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重命名失败。");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" className="icon-button" title="重命名" aria-label={`重命名 ${item.title}`} onClick={() => setEditing(true)}>
        <Edit3 size={16} />
      </button>
    );
  }

  return (
    <span className="recording-rename-control">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void commit();
          }
          if (event.key === "Escape") {
            setValue(item.title);
            setEditing(false);
          }
        }}
        aria-label="录音标题"
        autoFocus
      />
      <button type="button" className="icon-button" title="保存" onClick={() => void commit()} disabled={saving}>
        <Check size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        title="取消"
        onClick={() => {
          setValue(item.title);
          setEditing(false);
        }}
        disabled={saving}
      >
        <X size={16} />
      </button>
      {error && <small className="status-message">{error}</small>}
    </span>
  );
};

const RecordingRow = ({
  item,
  onOpen,
  onRename,
  onDurationKnown,
}: {
  item: RecordingItem;
  onOpen: () => void;
  onRename: (assetId: string, title: string) => Promise<void> | void;
  onDurationKnown: (assetId: string, durationSeconds: number) => Promise<void> | void;
}) => (
  <article className="recording-row">
    <button type="button" className="recording-row-main" onClick={onOpen}>
      <span>{item.recordTitle}</span>
      <strong>{item.title}</strong>
      <small>
        {item.recordDate} · <AudioDuration item={item} onDurationKnown={onDurationKnown} />
      </small>
    </button>
    <RecordingRenameControl item={item} onRename={onRename} />
  </article>
);

const RecordingPlayerPage = ({
  initialAssetId,
  queue,
  onBack,
  onDurationKnown,
}: {
  initialAssetId: string;
  queue: RecordingItem[];
  onBack: () => void;
  onDurationKnown: (assetId: string, durationSeconds: number) => Promise<void> | void;
}) => {
  const [currentAssetId, setCurrentAssetId] = useState(initialAssetId);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [mode, setMode] = useState<PlayMode>("order");
  const [message, setMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRequestIdRef = useRef(0);
  const autoplayedAssetIdRef = useRef<string | null>(null);

  useEffect(() => {
    setCurrentAssetId(initialAssetId);
  }, [initialAssetId]);

  const currentIndex = Math.max(0, queue.findIndex((item) => item.assetId === currentAssetId));
  const current = queue[currentIndex] ?? queue[0];

  useEffect(() => {
    if (!current) {
      return undefined;
    }
    playRequestIdRef.current += 1;
    autoplayedAssetIdRef.current = null;
    audioRef.current?.pause();
    const nextUrl = URL.createObjectURL(current.asset.data);
    setUrl(nextUrl);
    setCurrentTime(0);
    setDuration(current.durationSeconds ?? 0);
    setPlaying(false);
    setMessage("");
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [current?.assetId]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const safePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !current) {
      return;
    }
    const requestId = playRequestIdRef.current + 1;
    playRequestIdRef.current = requestId;
    setMessage("");
    try {
      audio.playbackRate = speed;
      await audio.play();
      if (playRequestIdRef.current === requestId) {
        setPlaying(true);
      }
    } catch (reason) {
      if (playRequestIdRef.current !== requestId) {
        return;
      }
      setPlaying(false);
      const errorMessage = reason instanceof Error ? reason.message : "";
      const errorName = reason instanceof DOMException ? reason.name : "";
      if (errorName === "AbortError" || /interrupted|new load request/i.test(errorMessage)) {
        return;
      }
      setMessage("播放失败，请重新点击播放。");
    }
  }, [current, speed]);

  const requestAutoplay = useCallback(() => {
    if (!current || autoplayedAssetIdRef.current === current.assetId) {
      return;
    }
    autoplayedAssetIdRef.current = current.assetId;
    void safePlay();
  }, [current, safePlay]);

  if (!current) {
    return (
      <main className="page recordings-page">
        <button type="button" className="secondary-button" onClick={onBack}>
          <ArrowLeft size={18} />
          返回
        </button>
        <div className="empty-state">
          <h2>录音不存在</h2>
        </div>
      </main>
    );
  }

  const goToIndex = (index: number) => {
    if (index < 0 || index >= queue.length) {
      return;
    }
    playRequestIdRef.current += 1;
    autoplayedAssetIdRef.current = null;
    audioRef.current?.pause();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(queue[index].durationSeconds ?? 0);
    setMessage("");
    setCurrentAssetId(queue[index].assetId);
  };

  const goPrevious = () => {
    if (currentIndex > 0) {
      goToIndex(currentIndex - 1);
      return;
    }
    if (mode === "shuffle" && queue.length > 0) {
      goToIndex(queue.length - 1);
    }
  };

  const goNext = () => {
    if (currentIndex < queue.length - 1) {
      goToIndex(currentIndex + 1);
      return;
    }
    if (mode === "shuffle" && queue.length > 0) {
      goToIndex(0);
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      await safePlay();
    } else {
      playRequestIdRef.current += 1;
      audio.pause();
      setPlaying(false);
    }
  };

  const jump = (offsetSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = clampTime(audio.currentTime + offsetSeconds, audio.duration);
    setCurrentTime(audio.currentTime);
  };

  const handleEnded = () => {
    if (mode === "single") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void safePlay();
      }
      return;
    }
    if (currentIndex < queue.length - 1) {
      goToIndex(currentIndex + 1);
      return;
    }
    if (mode === "shuffle" && queue.length > 1) {
      const candidates = queue.map((_, index) => index).filter((index) => index !== currentIndex);
      goToIndex(candidates[Math.floor(Math.random() * candidates.length)]);
      return;
    }
    playRequestIdRef.current += 1;
    setPlaying(false);
  };

  return (
    <main className="page recording-player-page">
      <header className="recording-player-topbar">
        <button type="button" className="secondary-button" onClick={onBack}>
          <ArrowLeft size={18} />
          返回
        </button>
        <div>
          <p className="eyebrow">{current.folderTitle}</p>
          <h1>{current.title}</h1>
        </div>
      </header>

      <section className="recording-player-stage">
        <audio
          ref={audioRef}
          src={url}
          onLoadedMetadata={(event) => {
            const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            setDuration(nextDuration);
            const roundedDuration = Math.round(nextDuration);
            if (roundedDuration > 0 && roundedDuration !== current.durationSeconds) {
              void Promise.resolve(onDurationKnown(current.assetId, roundedDuration)).catch(() => undefined);
            }
            requestAutoplay();
          }}
          onCanPlay={requestAutoplay}
          onTimeUpdate={(event) => setCurrentTime(Math.min(event.currentTarget.currentTime, duration || event.currentTarget.duration || 0))}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={handleEnded}
        />
        <div className="recording-time-display">{formatPlayerTime(duration ? Math.min(currentTime, duration) : currentTime)}</div>
        <small>{formatAudioDuration(duration || current.durationSeconds)} / {current.recordTitle}</small>
        {message && <p className="status-message">{message}</p>}
      </section>

      <section className="recording-player-controls">
        <div className="speed-row" aria-label="播放倍速">
          {SPEEDS.map((item) => (
            <button key={item} type="button" className={speed === item ? "active" : ""} onClick={() => setSpeed(item)}>
              {item}x
            </button>
          ))}
        </div>
        <button type="button" className="play-mode-button" onClick={() => setMode((value) => nextMode(value))}>
          {mode === "single" ? <Repeat1 size={18} /> : mode === "shuffle" ? <Shuffle size={18} /> : <Repeat size={18} />}
          {PLAY_MODE_LABELS[mode]}
        </button>
        <div className="transport-row">
          <button type="button" className="icon-button" title="上一首" onClick={goPrevious}>
            <SkipBack size={22} />
          </button>
          <button type="button" className="icon-button" title="快退 10 秒" onClick={() => jump(-10)}>
            <Rewind size={24} />
          </button>
          <button type="button" className="player-play-button" title={playing ? "暂停" : "播放"} onClick={() => void togglePlay()}>
            {playing ? <Pause size={30} /> : <Play size={30} />}
          </button>
          <button type="button" className="icon-button" title="快进 10 秒" onClick={() => jump(10)}>
            <FastForward size={24} />
          </button>
          <button type="button" className="icon-button" title="下一首" onClick={goNext}>
            <SkipForward size={22} />
          </button>
        </div>
      </section>
    </main>
  );
};

const NativeRecordingPlayerPage = ({
  initialAssetId,
  queue,
  onBack,
  onDurationKnown,
}: {
  initialAssetId: string;
  queue: RecordingItem[];
  onBack: () => void;
  onDurationKnown: (assetId: string, durationSeconds: number) => Promise<void> | void;
}) => {
  const playback = usePlayback();
  const [message, setMessage] = useState("");
  const startedKeyRef = useRef<string>();
  const queueKey = `${initialAssetId}:${queue.map((item) => item.assetId).join(",")}`;
  const nativeQueueId = `recordings:${queueKey}`;
  const nativeSessionActive = playback.nativeAvailable && playback.state.queueId === nativeQueueId;

  useEffect(() => {
    if (!playback.nativeAvailable || startedKeyRef.current === queueKey) return;
    startedKeyRef.current = queueKey;
    setMessage("");
    void playback.startQueue({
      queueId: nativeQueueId,
      items: queue.map((item) => ({
        asset: item.asset,
        title: item.title,
        subtitle: item.recordTitle,
      })),
      initialAssetId,
    }).catch((error) => {
      if (startedKeyRef.current === queueKey) {
        setMessage(error instanceof Error ? error.message : "无法准备后台播放。");
      }
    });
  }, [initialAssetId, playback, queue, queueKey]);

  const currentIndex = Math.max(0, queue.findIndex((item) => item.assetId === (nativeSessionActive ? playback.state.itemId : initialAssetId)));
  const current = queue[currentIndex] ?? queue.find((item) => item.assetId === initialAssetId) ?? queue[0];
  const duration = nativeSessionActive ? playback.state.durationSeconds || current?.durationSeconds || 0 : current?.durationSeconds || 0;
  const currentTime = nativeSessionActive && playback.state.itemId === current?.assetId ? playback.state.positionSeconds : 0;
  const playing = nativeSessionActive && playback.state.status === "playing";

  useEffect(() => {
    if (!current || !duration || Math.round(duration) === current.durationSeconds) return;
    void Promise.resolve(onDurationKnown(current.assetId, Math.round(duration))).catch(() => undefined);
  }, [current, duration, onDurationKnown]);

  if (!current) {
    return (
      <main className="page recordings-page">
        <button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={18} />返回</button>
        <div className="empty-state"><h2>录音不存在</h2></div>
      </main>
    );
  }

  const togglePlay = async () => {
    try {
      if (playing) await playback.pause(); else await playback.play();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "播放控制失败。");
    }
  };

  return (
    <main className="page recording-player-page">
      <header className="recording-player-topbar">
        <button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={18} />返回</button>
        <div><p className="eyebrow">{current.folderTitle}</p><h1>{current.title}</h1></div>
      </header>
      <section className="recording-player-stage">
        <div className="recording-time-display">{formatPlayerTime(duration ? Math.min(currentTime, duration) : currentTime)}</div>
        <small>{formatAudioDuration(duration || current.durationSeconds)} / {current.recordTitle}</small>
        {playback.preparing.active && <p className="status-message">正在准备后台播放 {playback.preparing.totalBytes ? Math.round((playback.preparing.writtenBytes / playback.preparing.totalBytes) * 100) : 0}%</p>}
        {playback.notificationUnavailable && <p className="status-message">通知权限未授予，播放将无法显示在通知栏或锁屏界面。</p>}
        {message && <p className="status-message">{message}</p>}
      </section>
      <section className="recording-player-controls">
        <div className="speed-row" aria-label="播放倍速">
          {SPEEDS.map((item) => <button key={item} type="button" className={playback.state.speed === item ? "active" : ""} onClick={() => void playback.setSpeed(item)}>{item}x</button>)}
        </div>
        <button type="button" className="play-mode-button" onClick={() => void playback.setMode(nextMode(playback.state.mode))}>
          {playback.state.mode === "single" ? <Repeat1 size={18} /> : playback.state.mode === "shuffle" ? <Shuffle size={18} /> : <Repeat size={18} />}
          {PLAY_MODE_LABELS[playback.state.mode]}
        </button>
        <div className="transport-row">
          <button type="button" className="icon-button" title="上一首" onClick={() => void playback.previous()}><SkipBack size={22} /></button>
          <button type="button" className="icon-button" title="快退 10 秒" onClick={() => void playback.seekBy(-10)}><Rewind size={24} /></button>
          <button type="button" className="player-play-button" title={playing ? "暂停" : "播放"} onClick={() => void togglePlay()}>{playing ? <Pause size={30} /> : <Play size={30} />}</button>
          <button type="button" className="icon-button" title="快进 10 秒" onClick={() => void playback.seekBy(10)}><FastForward size={24} /></button>
          <button type="button" className="icon-button" title="下一首" onClick={() => void playback.next()}><SkipForward size={22} /></button>
        </div>
      </section>
    </main>
  );
};

export const RecordingsPage = ({
  blocks,
  assets,
  podcasts,
  subjects,
  selectedFolderId,
  playerAssetId,
  playerQueueSource,
  query,
  searchOpen,
  onSelectedFolderChange,
  onPlayerChange,
  onQueryChange,
  onSearchOpenChange,
  onBack,
  onRenameAudio,
  onDurationKnown,
}: RecordingsPageProps) => {
  const playback = usePlayback();
  const records = useMemo(() => getRecordBlocks(blocks), [blocks]);
  const folders = useMemo(() => getRecordingFolders(records, assets, subjects, podcasts), [assets, podcasts, records, subjects]);
  const searchResults = useMemo(() => searchRecordingItems(folders, query), [folders, query]);
  const allItems = useMemo(() => folders.flatMap((folder) => folder.items), [folders]);
  const playerItem = playerAssetId ? allItems.find((item) => item.assetId === playerAssetId) : undefined;
  const playerFolder = playerItem ? folders.find((folder) => folder.id === playerItem.folderId) : undefined;
  const playerQueue = playerQueueSource?.kind === "search"
    ? searchResults
    : playerQueueSource?.kind === "folder"
      ? folders.find((folder) => folder.id === playerQueueSource.folderId)?.items ?? []
      : playerFolder?.items ?? [];
  const selectedFolder: RecordingFolder | undefined = selectedFolderId
    ? folders.find((folder) => folder.id === selectedFolderId)
    : undefined;

  if (playerAssetId && playerItem && playerQueue.length > 0) {
    return (
      <>
        {playback.nativeAvailable ? (
          <NativeRecordingPlayerPage initialAssetId={playerAssetId} queue={playerQueue} onBack={() => onPlayerChange(undefined)} onDurationKnown={onDurationKnown} />
        ) : (
          <RecordingPlayerPage initialAssetId={playerAssetId} queue={playerQueue} onBack={() => onPlayerChange(undefined)} onDurationKnown={onDurationKnown} />
        )}
      </>
    );
  }

  if (selectedFolder) {
    return (
      <main className="page recordings-page">
        <PageHeader
          eyebrow="Recordings"
          title={selectedFolder.title}
          subtitle={`${selectedFolder.items.length} 条录音`}
          actions={(
            <button type="button" className="secondary-button" onClick={() => onSelectedFolderChange(undefined)}>
              <ArrowLeft size={18} />
              返回
            </button>
          )}
        />
        <section className="recording-list">
          {selectedFolder.items.length === 0 ? (
            <div className="empty-state">
              <h2>暂无录音</h2>
            </div>
          ) : (
            selectedFolder.items.map((item) => (
              <RecordingRow
                key={item.id}
                item={item}
                onOpen={() => onPlayerChange(item.assetId, { kind: "folder", folderId: selectedFolder.id })}
                onRename={onRenameAudio}
                onDurationKnown={onDurationKnown}
              />
            ))
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="page recordings-page">
      <PageHeader
        eyebrow="Recordings"
        title="录音"
        subtitle="按学科或知识播客查看录音文件。"
        actions={(
          <>
            {onBack && (
              <button type="button" className="secondary-button" onClick={onBack}>
                <ArrowLeft size={18} />
                返回
              </button>
            )}
            <button
              type="button"
              className={`icon-button ${searchOpen ? "active" : ""}`}
              title="搜索录音"
              aria-label="搜索录音"
              onClick={() => onSearchOpenChange(!searchOpen)}
            >
              <Search size={18} />
            </button>
          </>
        )}
      />

      {searchOpen && (
        <label className="search-box recording-search-box">
          <Search size={20} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索录音标题或文件名..."
            autoFocus
          />
        </label>
      )}

      {searchOpen && query.trim() ? (
        <section className="recording-list">
          {searchResults.length === 0 ? (
            <div className="empty-state">
              <h2>没找到录音</h2>
            </div>
          ) : (
            searchResults.map((item) => (
              <RecordingRow
                key={item.id}
                item={item}
                onOpen={() => onPlayerChange(item.assetId, { kind: "search", query })}
                onRename={onRenameAudio}
                onDurationKnown={onDurationKnown}
              />
            ))
          )}
        </section>
      ) : (
        <section className="recording-folder-grid">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="recording-folder-card"
              onClick={() => onSelectedFolderChange(folder.id)}
            >
              <span className="recording-folder-icon">
                <Folder size={24} />
              </span>
              <span>
                <strong>{folder.title}</strong>
                <small>{folder.kind === "knowledge-podcast" ? "知识播客 · " : ""}{folder.items.length} 条录音</small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </section>
      )}
    </main>
  );
};
