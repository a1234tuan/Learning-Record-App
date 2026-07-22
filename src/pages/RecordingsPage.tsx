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
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Asset, Block, Subject, SubjectConfig } from "../types";
import { PageHeader } from "../components/ui";
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
  subjects: SubjectConfig[];
  selectedSubject?: Subject;
  playerAssetId?: string;
  query: string;
  searchOpen: boolean;
  onSelectedSubjectChange: (subject: Subject | undefined) => void;
  onPlayerChange: (assetId: string | undefined) => void;
  onQueryChange: (query: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onRenameAudio: (assetId: string, title: string) => Promise<void> | void;
  onDurationKnown: (assetId: string, durationSeconds: number) => Promise<void> | void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
type PlaybackSpeed = (typeof SPEEDS)[number];
type PlayMode = "single" | "folder" | "order";

const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  single: "单录音循环",
  folder: "文件夹循环",
  order: "顺序播放",
};

const nextMode = (mode: PlayMode): PlayMode =>
  mode === "single" ? "folder" : mode === "folder" ? "order" : "single";

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
  const [mode, setMode] = useState<PlayMode>("single");
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
    if (mode !== "order" && queue.length > 0) {
      goToIndex(queue.length - 1);
    }
  };

  const goNext = () => {
    if (currentIndex < queue.length - 1) {
      goToIndex(currentIndex + 1);
      return;
    }
    if (mode !== "order" && queue.length > 0) {
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
    if (mode === "folder" && queue.length > 0) {
      goToIndex(0);
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
          <p className="eyebrow">{current.subject}</p>
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
          {mode === "single" ? <Repeat1 size={18} /> : mode === "folder" ? <Repeat size={18} /> : <Mic2 size={18} />}
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

export const RecordingsPage = ({
  blocks,
  assets,
  subjects,
  selectedSubject,
  playerAssetId,
  query,
  searchOpen,
  onSelectedSubjectChange,
  onPlayerChange,
  onQueryChange,
  onSearchOpenChange,
  onBack,
  onRenameAudio,
  onDurationKnown,
}: RecordingsPageProps) => {
  const records = useMemo(() => getRecordBlocks(blocks), [blocks]);
  const folders = useMemo(() => getRecordingFolders(records, assets, subjects), [assets, records, subjects]);
  const searchResults = useMemo(() => searchRecordingItems(folders, query), [folders, query]);
  const allItems = useMemo(() => folders.flatMap((folder) => folder.items), [folders]);
  const playerItem = playerAssetId ? allItems.find((item) => item.assetId === playerAssetId) : undefined;
  const playerFolder = playerItem ? folders.find((folder) => folder.subject === playerItem.subject) : undefined;
  const selectedFolder: RecordingFolder | undefined = selectedSubject
    ? folders.find((folder) => folder.subject === selectedSubject) ?? { subject: selectedSubject, items: [] }
    : undefined;

  if (playerAssetId && playerItem && playerFolder) {
    return (
      <RecordingPlayerPage
        initialAssetId={playerAssetId}
        queue={playerFolder.items}
        onBack={() => onPlayerChange(undefined)}
        onDurationKnown={onDurationKnown}
      />
    );
  }

  if (selectedFolder) {
    return (
      <main className="page recordings-page">
        <PageHeader
          eyebrow="Recordings"
          title={selectedFolder.subject}
          subtitle={`${selectedFolder.items.length} 条录音`}
          actions={(
            <button type="button" className="secondary-button" onClick={() => onSelectedSubjectChange(undefined)}>
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
                onOpen={() => onPlayerChange(item.assetId)}
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
        subtitle="按学科查看日志里的录音文件。"
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
                onOpen={() => onPlayerChange(item.assetId)}
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
              key={folder.subject}
              type="button"
              className="recording-folder-card"
              onClick={() => onSelectedSubjectChange(folder.subject)}
            >
              <span className="recording-folder-icon">
                <Folder size={24} />
              </span>
              <span>
                <strong>{folder.subject}</strong>
                <small>{folder.items.length} 条录音</small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </section>
      )}
    </main>
  );
};
