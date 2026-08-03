import {
  ArrowLeft,
  CircleAlert,
  Headphones,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AiKnowledgeScopePicker } from "../components/AiKnowledgeScopePicker";
import type { Asset, Block, KnowledgePodcast, KnowledgePodcastAudioUnit, KnowledgePodcastSegment, RecordBlock } from "../types";
import { createEmptyPodcast, invalidatePodcastAudioUnits } from "../services/knowledgePodcastService";
import { storage } from "../services/storageAdapter";
import { aiKnowledgeScopeTitle, buildAiKnowledgeContextPack, getAiKnowledgeScopeRecords } from "../services/aiContextService";
import { PageHeader } from "../components/ui";
import {
  cancelKnowledgePodcastJob,
  isKnowledgePodcastJobRunning,
  startKnowledgePodcastAudioJob,
  startKnowledgePodcastScriptJob,
} from "../services/knowledgePodcastJobService";

interface KnowledgePodcastPageProps {
  podcasts: KnowledgePodcast[];
  blocks: Block[];
  assets: Asset[];
  podcastId?: string;
  screen?: "editor" | "scope";
  onBack: () => void;
  onOpenScope: () => void;
  onOpenPodcast: (id: string) => void;
  onSavePodcast: (podcast: KnowledgePodcast) => Promise<KnowledgePodcast>;
  onDeletePodcast: (id: string) => Promise<void>;
  onOpenRecord: (record: RecordBlock) => void;
}

const recordsOf = (blocks: Block[]) => blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt);

const modeLabel = (mode: KnowledgePodcast["mode"]) => mode === "summary" ? "精炼回顾" : "复习讲解";

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
};

const formatElapsed = (startedAt: string | undefined, currentTime: number): string => {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((currentTime - new Date(startedAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};

const getAudioUrl = (asset: Asset | undefined) => asset ? URL.createObjectURL(asset.data) : undefined;

export const KnowledgePodcastPage = ({
  podcasts,
  blocks,
  assets,
  podcastId,
  screen = "editor",
  onBack,
  onOpenScope,
  onOpenPodcast,
  onSavePodcast,
  onDeletePodcast,
  onOpenRecord,
}: KnowledgePodcastPageProps) => {
  const records = useMemo(() => recordsOf(blocks), [blocks]);
  const selected = podcasts.find((item) => item.id === podcastId);
  if (!selected) {
    return (
      <PodcastList
        podcasts={podcasts}
        onBack={onBack}
        onOpenPodcast={onOpenPodcast}
        onCreate={() => {
          const next = createEmptyPodcast({ kind: "recent", days: 7 });
          void onSavePodcast(next).then((saved) => onOpenPodcast(saved.id));
        }}
      />
    );
  }
  if (screen === "scope") {
    return (
      <AiKnowledgeScopePicker
        blocks={blocks}
        assets={assets}
        initialScope={selected.scope}
        includeDate
        eyebrow="Knowledge Podcast"
        title="选择播客知识范围"
        ariaLabel="选择播客知识范围"
        confirmLabel="使用此范围"
        onBack={onBack}
        onConfirm={async (scope) => {
          const sourceRecords = getAiKnowledgeScopeRecords(scope, blocks, new Date().toISOString().slice(0, 10));
          await onSavePodcast({
            ...selected,
            scope,
            sourceRecordIds: sourceRecords.map((record) => record.id),
            scriptStatus: JSON.stringify(selected.scope) === JSON.stringify(scope) ? selected.scriptStatus : "idle",
            audioStatus: "idle",
            updatedAt: new Date().toISOString(),
          });
          onBack();
        }}
      />
    );
  }
  return (
    <PodcastEditor
      podcast={selected}
      records={records}
      assets={assets}
      onBack={onBack}
      onOpenScope={onOpenScope}
      onSavePodcast={onSavePodcast}
      onDeletePodcast={onDeletePodcast}
      onOpenRecord={onOpenRecord}
    />
  );
};

const PodcastList = ({
  podcasts,
  onBack,
  onOpenPodcast,
  onCreate,
}: {
  podcasts: KnowledgePodcast[];
  onBack: () => void;
  onOpenPodcast: (id: string) => void;
  onCreate: () => void;
}) => (
  <main className="page knowledge-podcast-page">
    <PageHeader
      eyebrow="Knowledge Podcast"
      title="知识播客"
      subtitle="把本地学习记录整理成可收听、可回溯的知识回顾。"
      actions={<button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={17} />返回</button>}
    />
    <section className="podcast-intro-card">
      <Headphones size={30} />
      <div><strong>一次性知识回顾</strong><p>先生成并编辑文字稿，再按章节生成语音。音频只是可重建缓存，文字稿会一直保留。</p></div>
      <button type="button" className="primary-button" onClick={onCreate}><Plus size={17} />新建播客</button>
    </section>
    <section className="podcast-list">
      {podcasts.length === 0 ? <div className="empty-state"><h2>还没有知识播客</h2><p>从最近记录开始生成你的第一期知识回顾。</p></div> : podcasts.map((podcast) => (
        <button type="button" className="podcast-list-row" key={podcast.id} onClick={() => onOpenPodcast(podcast.id)}>
          <span className="podcast-list-icon"><Headphones size={20} /></span>
          <span><strong>{podcast.title}</strong><small>{modeLabel(podcast.mode)} · {podcast.segments.length} 个章节 · {podcast.scope ? aiKnowledgeScopeTitle(podcast.scope) : "未设置范围"}</small></span>
          <span className={`podcast-status ${podcast.audioStatus}`}>{podcast.audioStatus === "ready" ? "可播放" : podcast.scriptStatus === "ready" ? "脚本已就绪" : "草稿"}</span>
        </button>
      ))}
    </section>
  </main>
);

const PodcastEditor = ({
  podcast: initialPodcast,
  records,
  assets,
  onBack,
  onOpenScope,
  onSavePodcast,
  onDeletePodcast,
  onOpenRecord,
}: {
  podcast: KnowledgePodcast;
  records: RecordBlock[];
  assets: Asset[];
  onBack: () => void;
  onOpenScope: () => void;
  onSavePodcast: (podcast: KnowledgePodcast) => Promise<KnowledgePodcast>;
  onDeletePodcast: (id: string) => Promise<void>;
  onOpenRecord: (record: RecordBlock) => void;
}) => {
  const [podcast, setPodcast] = useState(initialPodcast);
  const [message, setMessage] = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [playingUnitId, setPlayingUnitId] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(initialPodcast.playback?.positionSeconds ?? 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string>();
  const lastPlaybackSaveRef = useRef(0);
  const scriptRunning = podcast.scriptStatus === "generating" || isKnowledgePodcastJobRunning(podcast.id, "script");
  const audioRunning = podcast.audioStatus === "generating" || isKnowledgePodcastJobRunning(podcast.id, "audio");
  const sourceMap = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const currentContextHash = useMemo(() => {
    if (podcast.scriptStatus !== "ready") return podcast.contextHash;
    try { return buildAiKnowledgeContextPack(podcast.scope, records, assets).contextHash; } catch { return podcast.contextHash; }
  }, [assets, podcast.contextHash, podcast.scope, podcast.scriptStatus, records]);
  const sourceChanged = Boolean(podcast.contextHash && currentContextHash && podcast.contextHash !== currentContextHash);
  const legacyAudioLayout = podcast.audioLayoutVersion !== 2;
  const audioUnits = podcast.audioUnits ?? [];
  const openingUnit = audioUnits.find((unit) => unit.kind === "opening");
  const closingUnit = audioUnits.find((unit) => unit.kind === "closing");
  const unitForSegment = (segmentId: string) => audioUnits.find((unit) => unit.kind === "segment" && unit.segmentId === segmentId);
  const unitStatusLabel = (unit: KnowledgePodcastAudioUnit | undefined) => unit?.audioStatus === "ready" ? "已生成" : unit?.audioStatus === "failed" ? "失败" : "待生成";

  useEffect(() => {
    setPodcast(initialPodcast);
  }, [initialPodcast, records]);
  useEffect(() => () => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);
  useEffect(() => {
    if (podcast.generation?.status !== "running") return undefined;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [podcast.generation?.status]);
  const updatePodcast = (patch: Partial<KnowledgePodcast>) => setPodcast((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));

  const saveDraft = async () => {
    const saved = await onSavePodcast(podcast);
    setPodcast(saved);
    setMessage("播客草稿已保存。");
  };

  const generateScript = async () => {
    const scope = podcast.scope;
    const sourceRecords = getAiKnowledgeScopeRecords(scope, records, new Date().toISOString().slice(0, 10));
    if (sourceRecords.length === 0) { setMessage("当前范围没有可用于播客的记录。"); return; }
    const draft = { ...podcast, scope, audioStatus: "idle" as const, sourceRecordIds: sourceRecords.map((record) => record.id), lastError: undefined };
    try {
      const saved = await onSavePodcast(draft);
      setPodcast(saved);
      await startKnowledgePodcastScriptJob(saved.id);
      setMessage("脚本已转入后台生成，可以切换到其他页面。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法启动脚本生成。 ");
    }
  };

  const generateAudio = async (onlyUnitId?: string) => {
    try {
      const saved = await onSavePodcast(podcast);
      setPodcast(saved);
      await startKnowledgePodcastAudioJob(saved.id, onlyUnitId);
      setMessage("音频已转入后台生成，可以切换到其他页面。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法启动音频生成。 ");
    }
  };

  const playUnit = async (unit: KnowledgePodcastAudioUnit, startAt = 0) => {
    const asset = unit.audioAssetId ? assets.find((item) => item.id === unit.audioAssetId) : undefined;
    if (!asset) { setMessage("该音频单元尚未生成，请重新生成。 "); return; }
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = getAudioUrl(asset); if (!url) return;
    urlRef.current = url;
    const audio = new Audio(url); audioRef.current = audio; audio.playbackRate = playbackRate;
    audio.currentTime = startAt;
    audio.ontimeupdate = () => {
      setPosition(audio.currentTime);
      if (Date.now() - lastPlaybackSaveRef.current > 2000) {
        lastPlaybackSaveRef.current = Date.now();
        void storage.saveKnowledgePodcast?.({ ...podcast, playback: { unitId: unit.id, positionSeconds: audio.currentTime } });
      }
    };
    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration)) return;
      void storage.patchAsset?.(asset.id, { durationSeconds: audio.duration });
      const updated = {
        ...podcast,
        audioUnits: podcast.audioUnits?.map((item) => item.id === unit.id ? { ...item, durationSeconds: audio.duration } : item),
      };
      setPodcast(updated);
      void storage.saveKnowledgePodcast?.(updated);
    };
    audio.onplay = () => { setPlaying(true); setPlayingUnitId(unit.id); };
    audio.onpause = () => setPlaying(false);
    audio.onended = () => {
      const next = audioUnits.find((item) => item.order === unit.order + 1 && item.audioStatus === "ready");
      if (next) void playUnit(next); else setPlaying(false);
    };
    await audio.play();
    const saved = { ...podcast, playback: { unitId: unit.id, positionSeconds: startAt } };
    setPodcast(saved); await onSavePodcast(saved);
  };

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const stopPlayback = () => {
    if (audioRef.current && playingUnitId) {
      void storage.saveKnowledgePodcast?.({ ...podcast, playback: { unitId: playingUnitId, positionSeconds: audioRef.current.currentTime } });
    }
    audioRef.current?.pause();
    setPlaying(false);
  };

  const playAdjacent = (direction: -1 | 1) => {
    const activeId = playingUnitId ?? podcast.playback?.unitId ?? podcast.playback?.segmentId;
    const currentOrder = audioUnits.find((unit) => unit.id === activeId)?.order ?? -1;
    const next = audioUnits.find((unit) => unit.order === currentOrder + direction && unit.audioStatus === "ready");
    if (next) void playUnit(next);
  };

  const invalidateUnit = (current: KnowledgePodcast, kind: KnowledgePodcastAudioUnit["kind"], segmentId?: string): KnowledgePodcast => ({
    ...current,
    audioStatus: "idle",
    audioUnits: current.audioUnits?.map((unit) => unit.kind === kind && (kind !== "segment" || unit.segmentId === segmentId)
      ? { ...unit, textHash: "", audioStatus: "pending", error: undefined }
      : unit),
  });

  const updateSegment = (id: string, patch: Partial<KnowledgePodcastSegment>) => {
    setPodcast((current) => {
      const next = {
        ...current,
        segments: current.segments.map((segment) => segment.id === id ? { ...segment, ...patch, ...(patch.text !== undefined ? { textHash: "", audioStatus: "pending" as const } : {}) } : segment),
        audioUnits: patch.title !== undefined ? current.audioUnits?.map((unit) => unit.kind === "segment" && unit.segmentId === id ? { ...unit, title: patch.title?.trim() || unit.title } : unit) : current.audioUnits,
      };
      return patch.text !== undefined ? invalidateUnit(next, "segment", id) : next;
    });
  };

  return (
    <main className="page knowledge-podcast-page podcast-editor-page">
      <PageHeader eyebrow="Knowledge Podcast" title={podcast.title || "未命名知识播客"} subtitle="编辑脚本、生成章节音频并回到来源记录。" actions={<button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={17} />返回列表</button>} />
      <section className="podcast-editor-toolbar">
        <label>标题<input value={podcast.title} onChange={(event) => updatePodcast({ title: event.target.value })} /></label>
        <label>模式<select value={podcast.mode} onChange={(event) => updatePodcast({ mode: event.target.value as KnowledgePodcast["mode"], scriptStatus: "idle", audioStatus: "idle" })}><option value="summary">精炼回顾</option><option value="explain">复习讲解</option></select></label>
        <label>目标时长<select value={podcast.targetMinutes} onChange={(event) => updatePodcast({ targetMinutes: Number(event.target.value) as KnowledgePodcast["targetMinutes"], scriptStatus: "idle", audioStatus: "idle" })}><option value={3}>3 分钟</option><option value={5}>5 分钟</option><option value={10}>10 分钟</option></select></label>
        <label>Fish 模型<input value={podcast.ttsConfig.model} onChange={(event) => setPodcast((current) => invalidatePodcastAudioUnits({ ...current, ttsConfig: { ...current.ttsConfig, model: event.target.value } }))} /></label>
        <label>Voice ID<input value={podcast.ttsConfig.voiceId} onChange={(event) => setPodcast((current) => invalidatePodcastAudioUnits({ ...current, ttsConfig: { ...current.ttsConfig, voiceId: event.target.value } }))} placeholder="Fish Audio reference_id" /></label>
      </section>
      <section className="podcast-scope-card">
        <header><div><p className="eyebrow">Knowledge Scope</p><h2>知识范围</h2><p>{aiKnowledgeScopeTitle(podcast.scope)} · 命中 {getAiKnowledgeScopeRecords(podcast.scope, records, new Date().toISOString().slice(0, 10)).length} 条日志</p></div><button type="button" className="secondary-button" onClick={onOpenScope}>选择知识范围</button></header>
      </section>
      {message && <p className="status-message">{message}</p>}
      {podcast.generation && (
        <section className={`podcast-generation-status ${podcast.generation.status}`} role="status" aria-live="polite">
          <div>
            <strong>{podcast.generation.message}</strong>
            <small>
              {[podcast.generation.providerName, podcast.generation.model].filter(Boolean).join(" / ")}
              {podcast.generation.status === "running" ? ` · 已用时 ${formatElapsed(podcast.generation.startedAt, currentTime)}` : ""}
              {podcast.generation.current !== undefined && podcast.generation.total !== undefined ? ` · ${podcast.generation.current}/${podcast.generation.total}` : ""}
              {podcast.generation.partCurrent !== undefined && podcast.generation.partTotal !== undefined ? ` · 分片 ${podcast.generation.partCurrent}/${podcast.generation.partTotal}` : ""}
            </small>
          </div>
          {podcast.generation.status === "running" && (
            <button type="button" className="secondary-button" onClick={() => cancelKnowledgePodcastJob(podcast.id, podcast.generation!.kind)}>取消</button>
          )}
        </section>
      )}
      {podcast.scriptDiagnostic && (
        <p className="podcast-diagnostic">
          最近脚本请求：{podcast.scriptDiagnostic.providerName} / {podcast.scriptDiagnostic.model}
          {podcast.scriptDiagnostic.finishReason ? ` · ${podcast.scriptDiagnostic.finishReason}` : ""}
          {podcast.scriptDiagnostic.usage?.promptTokens !== undefined ? ` · 输入 ${podcast.scriptDiagnostic.usage.promptTokens}` : ""}
          {podcast.scriptDiagnostic.usage?.completionTokens !== undefined ? ` · 输出 ${podcast.scriptDiagnostic.usage.completionTokens}` : ""}
          {podcast.scriptDiagnostic.usage?.reasoningTokens !== undefined ? ` · 推理 ${podcast.scriptDiagnostic.usage.reasoningTokens}` : ""} Token
          {podcast.scriptDiagnostic.requestId ? ` · 请求 ID ${podcast.scriptDiagnostic.requestId}` : ""}
        </p>
      )}
      {sourceChanged && <p className="status-message">来源记录已更新，建议重新生成脚本；当前手工编辑内容不会被自动覆盖。</p>}
      {legacyAudioLayout && podcast.segments.some((segment) => segment.audioAssetId) && <p className="status-message">音频格式已更新，需要重新生成整期音频后，开场、章节与结尾才会作为独立录音播放。</p>}
      {podcast.lastError && <p className="error-message"><CircleAlert size={16} />{podcast.lastError}</p>}
      <section className="podcast-actions">
        <button type="button" className="secondary-button" onClick={() => void saveDraft()}><Save size={17} />保存草稿</button>
        <button type="button" className="primary-button" onClick={() => void generateScript()} disabled={scriptRunning || audioRunning}><Sparkles size={17} />{scriptRunning ? "生成脚本中…" : "生成脚本"}</button>
        <button type="button" className="primary-button" onClick={() => void generateAudio(undefined)} disabled={scriptRunning || audioRunning || podcast.scriptStatus !== "ready"}><Headphones size={17} />{audioRunning ? "生成音频中…" : legacyAudioLayout ? "重新生成整期音频" : "生成音频"}</button>
      </section>
      <section className="podcast-script-card">
        <article className="podcast-segment-card">
          <header><strong>开场</strong><span>{unitStatusLabel(openingUnit)}</span></header>
          <textarea value={podcast.opening ?? ""} onChange={(event) => setPodcast((current) => invalidateUnit({ ...current, opening: event.target.value }, "opening"))} rows={3} placeholder="生成脚本后可编辑开场" />
          {openingUnit && <footer>
            {openingUnit.audioStatus === "failed" && <button type="button" className="secondary-button" onClick={() => void generateAudio(openingUnit.id)}><RotateCcw size={15} />重试</button>}
            {openingUnit.audioStatus === "ready" && <button type="button" className="secondary-button" onClick={() => playing && playingUnitId === openingUnit.id ? stopPlayback() : void playUnit(openingUnit)}>{playing && playingUnitId === openingUnit.id ? <Pause size={15} /> : <Play size={15} />}{playing && playingUnitId === openingUnit.id ? "暂停" : "播放"}</button>}
            {openingUnit.error && <small className="error-text">{openingUnit.error}</small>}
          </footer>}
        </article>
        <div className="podcast-segment-list">
          {podcast.segments.length === 0 && <div className="empty-state"><h2>还没有脚本</h2><p>选择知识范围后生成一份脚本。</p></div>}
          {podcast.segments.map((segment) => {
            const unit = unitForSegment(segment.id);
            return <article className="podcast-segment-card" key={segment.id}>
              <header><input value={segment.title} onChange={(event) => updateSegment(segment.id, { title: event.target.value })} /><span>{unitStatusLabel(unit)}</span></header>
              <textarea value={segment.text} onChange={(event) => updateSegment(segment.id, { text: event.target.value })} rows={6} />
              <footer>
                <span>来源 {segment.sourceRecordIds.length} 条</span>
                {segment.sourceRecordIds.map((id) => sourceMap.get(id)).filter(Boolean).map((record) => <button type="button" className="link-button" key={record!.id} onClick={() => onOpenRecord(record!)}>{record!.title}</button>)}
                {unit?.audioStatus === "failed" && <button type="button" className="secondary-button" onClick={() => void generateAudio(unit.id)}><RotateCcw size={15} />重试</button>}
                {unit?.audioStatus === "ready" && <button type="button" className="secondary-button" onClick={() => playing && playingUnitId === unit.id ? stopPlayback() : void playUnit(unit)}>{playing && playingUnitId === unit.id ? <Pause size={15} /> : <Play size={15} />}{playing && playingUnitId === unit.id ? "暂停" : "播放"}</button>}
              </footer>
              {unit?.error && <small className="error-text">{unit.error}</small>}
            </article>;
          })}
        </div>
        <article className="podcast-segment-card">
          <header><strong>结尾</strong><span>{unitStatusLabel(closingUnit)}</span></header>
          <textarea value={podcast.closing ?? ""} onChange={(event) => setPodcast((current) => invalidateUnit({ ...current, closing: event.target.value }, "closing"))} rows={3} placeholder="生成脚本后可编辑结尾" />
          {closingUnit && <footer>
            {closingUnit.audioStatus === "failed" && <button type="button" className="secondary-button" onClick={() => void generateAudio(closingUnit.id)}><RotateCcw size={15} />重试</button>}
            {closingUnit.audioStatus === "ready" && <button type="button" className="secondary-button" onClick={() => playing && playingUnitId === closingUnit.id ? stopPlayback() : void playUnit(closingUnit)}>{playing && playingUnitId === closingUnit.id ? <Pause size={15} /> : <Play size={15} />}{playing && playingUnitId === closingUnit.id ? "暂停" : "播放"}</button>}
            {closingUnit.error && <small className="error-text">{closingUnit.error}</small>}
          </footer>}
        </article>
      </section>
      {!legacyAudioLayout && <section className="podcast-player-card">
        <div className="podcast-player-heading"><strong>{playingUnitId ? audioUnits.find((unit) => unit.id === playingUnitId)?.title : "尚未播放"}</strong><small>{formatTime(position)}</small></div>
        <input type="range" min={0} max={Math.max(1, audioRef.current?.duration || 1)} value={position} onChange={(event) => { const value = Number(event.target.value); setPosition(value); if (audioRef.current) audioRef.current.currentTime = value; }} />
        <div className="podcast-player-actions"><button type="button" className="secondary-button" onClick={() => playAdjacent(-1)}>上一项</button><button type="button" className="primary-button" onClick={() => { const unit = audioUnits.find((item) => item.id === (playingUnitId ?? podcast.playback?.unitId ?? podcast.playback?.segmentId)) ?? audioUnits.find((item) => item.audioStatus === "ready"); if (unit) void playUnit(unit, playingUnitId === unit.id ? position : podcast.playback?.positionSeconds ?? 0); }}><Play size={17} />播放/继续</button><button type="button" className="secondary-button" onClick={stopPlayback}><Pause size={17} />暂停</button><button type="button" className="secondary-button" onClick={() => playAdjacent(1)}>下一项</button></div>
        <div className="podcast-player-options"><label>播放速度<select value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))} aria-label="播放速度">{[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}</select></label><span>当前位置 {formatTime(position)}</span></div>
      </section>}
      <button type="button" className="danger-text-button" onClick={() => { if (window.confirm("删除这期知识播客及其生成音频吗？")) void onDeletePodcast(podcast.id).then(onBack); }}><Trash2 size={16} />删除这期播客</button>
    </main>
  );
};
