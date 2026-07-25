import {
  Camera,
  Bot,
  Clock3,
  Copy,
  History,
  ImagePlus,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AiMarkdown } from "../components/AiMarkdown";
import type { AiChatAttachment, AiChatMessage, AiChatSession, AiKnowledgeScope, AppSettings, Asset, Block, RecordBlock } from "../types";
import { copyTextToClipboard } from "../lib/clipboard";
import { createBaseEntity } from "../lib/entity";
import { isNativePlatform } from "../lib/platform";
import { storage } from "../services/storageAdapter";
import { buildSessionMemorySummary, calculateAiRequestBudget, sendChatCompletion } from "../services/aiClientService";
import {
  aiKnowledgeScopeTitle,
  buildAiKnowledgeContextPackAsync,
  compactAiContextPack,
  estimateAiTokens,
  getAiKnowledgeScopeRecords,
  sessionKnowledgeScope,
} from "../services/aiContextService";
import { createAiImageAttachment, runLocalOcrForAiAttachment } from "../services/aiChatAttachmentService";
import { createAiSessionForScope, titleFromFirstPrompt } from "../services/aiSessionService";
import { DEFAULT_AI_MEMORY_TURNS, getCurrentAiProvider } from "../lib/aiProviders";
import { pickNativeCameraImageFile, pickNativeGalleryImageFile } from "../lib/nativeImagePicker";
import { getSubjectRecordTags } from "../lib/recordTags";

interface AiChatPageProps {
  sessionId: string | null;
  settings: AppSettings;
  blocks: Block[];
  assets: Asset[];
  onOpenSession: (sessionId: string) => void;
  onDeletedSession: () => void;
  onOpenSettings: () => void;
}

const sortedPresets = (settings: AppSettings) =>
  [...(settings.ai?.presets ?? [])]
    .filter((preset) => preset.title.trim() && preset.prompt.trim())
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

const formatBytes = (size: number): string => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const modeLabel = (mode?: string): string => {
  switch (mode) {
    case "recall":
      return "等待你白纸复述";
    case "application":
      return "出变形题";
    case "trap":
      return "挖盲区";
    case "feynman":
      return "费曼追问";
    case "correction":
      return "等你输入理解";
    default:
      return "自定义";
  }
};

const AiChatImageThumb = ({
  image,
  onRemove,
}: {
  image: AiChatAttachment;
  onRemove?: () => void;
}) => {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(image.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image.data]);

  const statusText = image.sentMode === "vision"
    ? "已直发给 AI"
    : image.ocrStatus === "done"
      ? `OCR ${image.ocrText?.trim().length ?? 0} 字`
      : image.ocrStatus === "running" || image.ocrStatus === "queued"
        ? "OCR 中"
        : image.ocrStatus === "failed"
          ? "OCR 失败"
          : "待发送";

  return (
    <figure className={`ai-image-thumb ${image.ocrStatus === "failed" ? "error" : ""}`}>
      {url && <img src={url} alt={image.fileName} />}
      <figcaption>
        <strong>{image.fileName}</strong>
        <span>{formatBytes(image.size)} · {statusText}</span>
        {image.ocrError && <small>{image.ocrError}</small>}
      </figcaption>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="移除图片">
          <X size={14} />
        </button>
      )}
    </figure>
  );
};

export const AiChatPage = ({
  sessionId,
  settings,
  blocks,
  assets,
  onOpenSession,
  onDeletedSession,
  onOpenSettings,
}: AiChatPageProps) => {
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [session, setSession] = useState<AiChatSession | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [messageAttachments, setMessageAttachments] = useState<Record<string, AiChatAttachment[]>>({});
  const [pendingImages, setPendingImages] = useState<AiChatAttachment[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [scopeKind, setScopeKind] = useState<AiKnowledgeScope["kind"]>("tag");
  const [scopeSubject, setScopeSubject] = useState("");
  const [scopeTag, setScopeTag] = useState("");
  const [recentDays, setRecentDays] = useState<7 | 14 | 30>(7);
  const [creatingScope, setCreatingScope] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const presets = useMemo(() => sortedPresets(settings), [settings]);
  const imageInputMode = settings.ai?.imageInputMode ?? "local-ocr";
  const native = isNativePlatform();
  const provider = useMemo(() => getCurrentAiProvider(settings.ai), [settings.ai]);
  const savedRecords = useMemo(
    () => blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt),
    [blocks],
  );
  const scopeSubjects = useMemo(
    () => Array.from(new Set(savedRecords.map((record) => record.subject))).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [savedRecords],
  );

  useEffect(() => {
    if (!scopeSubject && scopeSubjects[0]) setScopeSubject(scopeSubjects[0]);
  }, [scopeSubject, scopeSubjects]);

  const scopeTags = useMemo(() => getSubjectRecordTags(savedRecords, scopeSubject), [savedRecords, scopeSubject]);
  useEffect(() => {
    if (!scopeTags.some((tag) => tag === scopeTag)) setScopeTag(scopeTags[0] ?? "");
  }, [scopeTag, scopeTags]);

  const pendingScope = useMemo<AiKnowledgeScope | undefined>(() => {
    if (scopeKind === "recent") return { kind: "recent", days: recentDays };
    if (scopeKind === "tag" && scopeSubject && scopeTag) return { kind: "tag", subject: scopeSubject, tag: scopeTag };
    return undefined;
  }, [recentDays, scopeKind, scopeSubject, scopeTag]);
  const pendingScopeRecords = useMemo(
    () => pendingScope ? getAiKnowledgeScopeRecords(pendingScope, blocks) : [],
    [blocks, pendingScope],
  );
  const pendingScopeOcrCount = useMemo(() => {
    const assetIds = new Set(pendingScopeRecords.flatMap((record) => record.assets.map((asset) => asset.id)));
    return assets.filter((asset) => assetIds.has(asset.id) && asset.kind === "image" && asset.ocrStatus === "done" && asset.ocrText?.trim()).length;
  }, [assets, pendingScopeRecords]);
  const pendingScopeEstimate = useMemo(
    () => estimateAiTokens(pendingScopeRecords.map((record) => `${record.title}\n${record.contentHtml}`).join("\n")),
    [pendingScopeRecords],
  );

  const refresh = async () => {
    const nextSessions = await storage.listAiSessions?.() ?? [];
    setSessions(nextSessions);
    if (!sessionId) {
      setSession(null);
      setMessages([]);
      return;
    }
    const nextSession = await storage.getAiSession?.(sessionId);
    setSession(nextSession ?? null);
    const nextMessages = nextSession ? await storage.listAiMessages?.(nextSession.id) ?? [] : [];
    const nextAttachments = nextSession ? await storage.listAiAttachments?.(nextSession.id) ?? [] : [];
    setMessages(nextMessages);
    setMessageAttachments(
      nextAttachments.reduce<Record<string, AiChatAttachment[]>>((grouped, attachment) => {
        if (attachment.messageId) {
          grouped[attachment.messageId] = [...(grouped[attachment.messageId] ?? []), attachment];
        }
        return grouped;
      }, {}),
    );
  };

  useEffect(() => {
    setPendingImages([]);
    void refresh();
  }, [sessionId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy, sessionId]);

  const copy = async (text: string) => {
    const copied = await copyTextToClipboard(text);
    setStatus(copied ? "已复制。" : "复制失败，请长按选择文本后手动复制。");
  };

  const openNewChat = async () => {
    if (!session?.attachment) {
      return;
    }
    const scope = sessionKnowledgeScope(session);
    if (!scope) return;
    const nextSession = await createAiSessionForScope(
      scope,
      await buildAiKnowledgeContextPackAsync(scope, blocks, assets),
    );
    if (nextSession) {
      setHistoryOpen(false);
      onOpenSession(nextSession.id);
    }
  };

  const createKnowledgeSession = async () => {
    if (!pendingScope || creatingScope) return;
    setCreatingScope(true);
    setStatus("");
    try {
      const attachment = await buildAiKnowledgeContextPackAsync(pendingScope, blocks, assets);
      const nextSession = await createAiSessionForScope(pendingScope, attachment);
      if (nextSession) {
        setScopePickerOpen(false);
        onOpenSession(nextSession.id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创建知识库问答失败。");
    } finally {
      setCreatingScope(false);
    }
  };

  const updateTitleFromFirstPrompt = async (prompt: string, currentSession: AiChatSession, messageCount: number) => {
    if (messageCount > 0) {
      return currentSession;
    }
    const nextTitle = titleFromFirstPrompt(prompt);
    if (!nextTitle || currentSession.title === nextTitle) {
      return currentSession;
    }
    const saved = await storage.saveAiSession?.({ ...currentSession, title: nextTitle });
    if (saved) {
      setSession(saved);
      return saved;
    }
    return currentSession;
  };

  const updatePendingImage = (updated: AiChatAttachment) => {
    setPendingImages((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const addImageFile = async (file: File) => {
    if (!session || busy) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setStatus("请选择图片文件。");
      return;
    }
    const attachment = await createAiImageAttachment(session.id, file);
    setPendingImages((current) => [...current, attachment]);
    setStatus(imageInputMode === "local-ocr" ? "图片已加入，发送时会先进行本地 OCR。" : "图片已加入。");
  };

  const pickNativeImage = async (picker: () => Promise<File | undefined>) => {
    try {
      const file = await picker();
      if (file) {
        await addImageFile(file);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatus(`图片选择失败：${message}`);
    }
  };

  const removePendingImage = async (id: string) => {
    await storage.deleteAiAttachment?.(id);
    setPendingImages((current) => current.filter((item) => item.id !== id));
  };

  const prepareImagesForSend = async (images: AiChatAttachment[]): Promise<AiChatAttachment[]> => {
    if (images.length === 0) {
      return [];
    }
    if (imageInputMode === "disabled") {
      throw new Error("AI 图片发送已关闭，请在 AI 设置中开启图片问答方式。");
    }
    if (imageInputMode === "vision") {
      const saved = await Promise.all(images.map((image) =>
        storage.saveAiAttachment?.({ ...image, sentMode: "vision" }) ?? image,
      ));
      saved.forEach(updatePendingImage);
      return saved;
    }
    const prepared: AiChatAttachment[] = [];
    for (const image of images) {
      setStatus(`正在 OCR：${image.fileName}`);
      const updated = await runLocalOcrForAiAttachment(image, { onChanged: updatePendingImage });
      prepared.push(updated);
    }
    return prepared;
  };

  const send = async () => {
    const prompt = input.trim();
    const imagesToSend = pendingImages;
    if ((!prompt && imagesToSend.length === 0) || !session || busy) {
      return;
    }
    setBusy(true);
    setStatus("");
    setInput("");

    let preparedImages: AiChatAttachment[] = [];
    try {
      preparedImages = await prepareImagesForSend(imagesToSend);
    } catch (error) {
      setBusy(false);
      const message = error instanceof Error ? error.message : "图片处理失败。";
      setStatus(message);
      return;
    }

    const effectivePrompt = prompt || "请根据我上传的图片内容进行回答或批改。";
    let requestBudget: ReturnType<typeof calculateAiRequestBudget>;
    try {
      requestBudget = calculateAiRequestBudget({
        provider,
        history: messages,
        prompt: effectivePrompt,
        memorySummary: session.memorySummary,
      });
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : "无法为本轮问答分配上下文预算。");
      return;
    }
    const titleSession = await updateTitleFromFirstPrompt(effectivePrompt, session, messages.length);
    const scope = sessionKnowledgeScope(titleSession);
    const freshAttachment = scope
      ? await buildAiKnowledgeContextPackAsync(scope, blocks, assets, effectivePrompt, undefined, {
        maxTokens: requestBudget.retrievalTokens,
        retrievalMode: requestBudget.retrievalMode,
        preferDiverse: requestBudget.retrievalMode === "coverage",
      })
      : undefined;
    if (freshAttachment) {
      requestBudget = calculateAiRequestBudget({
        provider,
        history: messages,
        prompt: effectivePrompt,
        memorySummary: titleSession.memorySummary,
        attachment: freshAttachment,
      });
    }
    const contextSession = freshAttachment
      ? await storage.saveAiSession?.({
        ...titleSession,
        scope,
        scopeTitle: freshAttachment.scopeTitle,
        attachment: compactAiContextPack(freshAttachment),
        lastContextHash: freshAttachment.contextHash,
      }) ?? {
        ...titleSession,
        scope,
        scopeTitle: freshAttachment.scopeTitle,
        attachment: compactAiContextPack(freshAttachment),
        lastContextHash: freshAttachment.contextHash,
      }
      : titleSession;
    const userMessage: AiChatMessage = {
      ...createBaseEntity(),
      sessionId: contextSession.id,
      role: "user",
      content: effectivePrompt,
      attachmentIds: preparedImages.map((image) => image.id),
    };
    await storage.saveAiMessage?.(userMessage);
    const savedPreparedImages = await Promise.all(preparedImages.map((image) =>
      storage.saveAiAttachment?.({ ...image, messageId: userMessage.id }) ?? { ...image, messageId: userMessage.id },
    ));
    setPendingImages([]);
    const visibleHistory = [...messages, userMessage];
    setMessages(visibleHistory);
    setMessageAttachments((current) => ({
      ...current,
      [userMessage.id]: savedPreparedImages,
    }));

    try {
      const apiKey = provider ? (await storage.getAiSecret?.(provider.id))?.apiKey : undefined;
      const content = await sendChatCompletion({
        provider,
        apiKey,
        attachment: freshAttachment ?? contextSession.attachment,
        history: messages,
        prompt: effectivePrompt,
        memorySummary: contextSession.memorySummary,
        imageInputMode,
        imageAttachments: savedPreparedImages,
        budget: requestBudget,
      });
      const assistantMessage: AiChatMessage = {
        ...createBaseEntity(),
        sessionId: contextSession.id,
        role: "assistant",
        content,
      };
      await storage.saveAiMessage?.(assistantMessage);
      const memorySummary = buildSessionMemorySummary([...visibleHistory, assistantMessage], provider?.memoryTurns ?? DEFAULT_AI_MEMORY_TURNS);
      if (memorySummary && memorySummary !== contextSession.memorySummary) {
        await storage.saveAiSession?.({ ...contextSession, memorySummary });
      }
      setMessages([...visibleHistory, assistantMessage]);
      await refresh();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "AI 请求失败。";
      const assistantMessage: AiChatMessage = {
        ...createBaseEntity(),
        sessionId: contextSession.id,
        role: "assistant",
        content: errorText,
        error: errorText,
      };
      await storage.saveAiMessage?.(assistantMessage);
      setMessages([...visibleHistory, assistantMessage]);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const deleteSession = async (id: string) => {
    const ok = window.confirm("删除这段 AI 聊天记录？日志本身不会被删除。");
    if (!ok) {
      return;
    }
    await storage.deleteAiSession?.(id);
    if (sessionId === id) {
      setHistoryOpen(false);
      onDeletedSession();
    } else {
      await refresh();
    }
  };

  const attachment = session?.attachment;
  const selectedChunkCount = attachment?.selectedChunks?.length ?? 0;
  const totalChunkCount = attachment?.totalChunks ?? attachment?.selectedChunks?.length ?? 0;
  const skippedAssetCount = attachment?.skippedAssets.length ?? 0;
  const composerBudget = (() => {
    if (!session || !provider) return undefined;
    try {
      return calculateAiRequestBudget({ provider, history: messages, prompt: input, memorySummary: session.memorySummary, attachment });
    } catch {
      return undefined;
    }
  })();
  const scopeLabel = attachment?.scopeTitle ?? session?.scopeTitle ?? (session ? aiKnowledgeScopeTitle(sessionKnowledgeScope(session) ?? { kind: "date", date: attachment?.date ?? session.updatedAt.slice(0, 10) }) : "AI Chat");

  return (
    <main className="page ai-chat-page immersive">
      <section className="ai-chat-shell">
        <header className="ai-topbar">
          <div className="ai-topbar-title">
            <p>{scopeLabel}</p>
            <h1>{session?.title ?? "AI 问答"}</h1>
          </div>
          <div className="ai-topbar-actions">
            <button type="button" className="icon-button" onClick={() => setScopePickerOpen(true)} aria-label="新建知识库问答" title="新建知识库问答">
              <Sparkles size={18} />
            </button>
            {session?.attachment && (
              <button type="button" className="icon-button" onClick={() => void openNewChat()} aria-label="开启新对话">
                <MessageSquarePlus size={18} />
              </button>
            )}
            <button type="button" className="icon-button" onClick={() => setHistoryOpen(true)} aria-label="打开历史聊天">
              <History size={18} />
            </button>
            <button type="button" className="icon-button" onClick={onOpenSettings} aria-label="AI 设置">
              <Settings size={18} />
            </button>
          </div>
        </header>

        {attachment && (
          <section className="ai-context-strip">
            <strong>{attachment.scopeTitle ?? `${attachment.date} 日志附件`}</strong>
            <span>{attachment.recordIds.length} 条记录</span>
            <span>片段 {selectedChunkCount}/{totalChunkCount}</span>
            {attachment.ocrSummary && (
              <span>
                图片文字 {attachment.ocrSummary.includedImages}/{attachment.ocrSummary.includedImages + attachment.ocrSummary.skippedImages}
              </span>
            )}
            <span>跳过 {skippedAssetCount} 个资源</span>
            <span>每轮自动刷新</span>
            {composerBudget && (
              <span>
                {composerBudget.retrievalMode === "coverage" ? "覆盖检索" : "聚焦检索"} {Math.round(composerBudget.retrievalTargetTokens / 1000)}K
              </span>
            )}
            {composerBudget && <span>预计输入 {composerBudget.estimatedInputTokens.toLocaleString()} token / 最大输出 {composerBudget.outputTokens.toLocaleString()} token</span>}
            {session?.memorySummary && <span>已启用长对话记忆</span>}
            {attachment.warnings.slice(0, 2).map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
            <small>AI 会优先使用命中片段，并在回答末尾标注依据来源。</small>
          </section>
        )}

        <section className="ai-thread">
          {!session ? (
            <div className="empty-state compact">
              <h2>新建一个知识库问答。</h2>
              <p>可以选择某个学科标签，或最近 7、14、30 天的学习记录。</p>
              <button type="button" className="primary-button" onClick={() => setScopePickerOpen(true)}>
                <Sparkles size={18} />
                新建知识库问答
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="ai-welcome">
              <Bot size={28} />
              <h2>日志已经准备好。</h2>
              <p>你可以让 AI 自测、抽问、总结薄弱点，或者按苏格拉底式一步步追问。</p>
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`ai-bubble-row ${message.role} ${message.error ? "error" : ""}`}>
                {message.role === "assistant" && (
                  <span className="ai-avatar">
                    <Bot size={17} />
                  </span>
                )}
                <div className="ai-bubble">
                  <header>
                    <span>{message.role === "user" ? "你" : "AI"}</span>
                    <button type="button" onClick={() => void copy(message.content)}>
                      <Copy size={14} />
                      复制
                    </button>
                  </header>
                  <div className="ai-markdown">
                    {(messageAttachments[message.id] ?? []).length > 0 && (
                      <div className="ai-message-images">
                        {(messageAttachments[message.id] ?? []).map((image) => (
                          <AiChatImageThumb key={image.id} image={image} />
                        ))}
                      </div>
                    )}
                    <AiMarkdown content={message.content} />
                  </div>
                </div>
                {message.role === "user" && (
                  <span className="ai-avatar user">
                    <User size={17} />
                  </span>
                )}
              </article>
            ))
          )}
          {busy && (
            <article className="ai-bubble-row assistant">
              <span className="ai-avatar">
                <Bot size={17} />
              </span>
              <div className="ai-bubble typing">
                <RefreshCw size={16} className="spin" />
                正在思考...
              </div>
            </article>
          )}
          <div ref={messageEndRef} />
        </section>

        {session && (
          <footer className="ai-composer">
            {presets.length > 0 && (
              <div className="ai-preset-row">
                {presets.map((preset) => (
                  <button key={preset.id} type="button" onClick={() => setInput(preset.prompt)}>
                    <strong>{preset.title}</strong>
                    <small>{modeLabel(preset.mode)}</small>
                  </button>
                ))}
              </div>
            )}
            <div className="ai-range-quiz-row">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setInput("请抽测此范围：跨不同记录挑选核心知识点，每次只出 1 题，不要先给答案，等我作答后再批改。")}
              >
                <Sparkles size={16} />
                抽测此范围
              </button>
              {composerBudget && <small>本轮检索预算 {composerBudget.retrievalTokens.toLocaleString()} token</small>}
            </div>
            {pendingImages.length > 0 && (
              <div className="ai-pending-images">
                {pendingImages.map((image) => (
                  <AiChatImageThumb key={image.id} image={image} onRemove={() => void removePendingImage(image.id)} />
                ))}
              </div>
            )}
            <form
              className="ai-input-bar"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <div className="ai-image-actions">
                {native ? (
                  <>
                    <button type="button" className="icon-button" disabled={busy} onClick={() => void pickNativeImage(() => pickNativeCameraImageFile("ai-camera-image"))} aria-label="拍照上传">
                      <Camera size={18} />
                    </button>
                    <button type="button" className="icon-button" disabled={busy} onClick={() => void pickNativeImage(() => pickNativeGalleryImageFile("ai-gallery-image"))} aria-label="从相册上传">
                      <ImagePlus size={18} />
                    </button>
                  </>
                ) : (
                  <button type="button" className="icon-button" disabled={busy} onClick={() => fileInputRef.current?.click()} aria-label="上传图片">
                    <ImagePlus size={18} />
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void addImageFile(file);
                    }
                    event.target.value = "";
                  }}
                />
              </div>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="带着这份日志问 AI，比如：用苏格拉底式方法抽问我"
                rows={2}
              />
              <button type="submit" className="primary-button" disabled={busy || (!input.trim() && pendingImages.length === 0)}>
                {busy ? <RefreshCw size={18} className="spin" /> : <Send size={18} />}
                发送
              </button>
            </form>
            {status && <p className="status-message">{status}</p>}
          </footer>
        )}
      </section>

      {scopePickerOpen && (
        <div className="ai-history-backdrop" onClick={() => !creatingScope && setScopePickerOpen(false)}>
          <section className="ai-scope-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="新建知识库问答">
            <header>
              <div>
                <p className="eyebrow">Knowledge Base</p>
                <h2>新建知识库问答</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setScopePickerOpen(false)} disabled={creatingScope} aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="ai-scope-mode-control" role="tablist" aria-label="知识范围">
              <button type="button" role="tab" aria-selected={scopeKind === "tag"} className={scopeKind === "tag" ? "active" : ""} onClick={() => setScopeKind("tag")}>
                学科标签
              </button>
              <button type="button" role="tab" aria-selected={scopeKind === "recent"} className={scopeKind === "recent" ? "active" : ""} onClick={() => setScopeKind("recent")}>
                近期学习
              </button>
            </div>
            {scopeKind === "tag" ? (
              <div className="ai-scope-fields">
                <label>
                  学科
                  <select value={scopeSubject} onChange={(event) => setScopeSubject(event.target.value)}>
                    {scopeSubjects.length === 0 && <option value="">没有可用学科</option>}
                    {scopeSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                  </select>
                </label>
                <label>
                  标签
                  <select value={scopeTag} onChange={(event) => setScopeTag(event.target.value)} disabled={scopeTags.length === 0}>
                    {scopeTags.length === 0 && <option value="">该学科没有已保存标签</option>}
                    {scopeTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <div className="ai-recent-range-control" role="tablist" aria-label="近期范围">
                {([7, 14, 30] as const).map((days) => (
                  <button key={days} type="button" role="tab" aria-selected={recentDays === days} className={recentDays === days ? "active" : ""} onClick={() => setRecentDays(days)}>
                    {days} 天
                  </button>
                ))}
              </div>
            )}
            <div className="ai-scope-preview">
              <strong>{pendingScope ? aiKnowledgeScopeTitle(pendingScope) : "请选择知识范围"}</strong>
              <span>命中 {pendingScopeRecords.length} 条记录</span>
              <span>可用 OCR 图片 {pendingScopeOcrCount} 张</span>
              <span>原始内容约 {pendingScopeEstimate.toLocaleString()} token，发送时会按模型窗口检索并截取。</span>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setScopePickerOpen(false)} disabled={creatingScope}>取消</button>
              <button type="button" className="primary-button" onClick={() => void createKnowledgeSession()} disabled={!pendingScope || pendingScopeRecords.length === 0 || creatingScope}>
                {creatingScope ? <RefreshCw size={18} className="spin" /> : <Sparkles size={18} />}
                创建问答
              </button>
            </footer>
          </section>
        </div>
      )}

      {historyOpen && (
        <div className="ai-history-backdrop" onClick={() => setHistoryOpen(false)}>
          <aside className="ai-history-drawer" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">History</p>
                <h2>聊天记录</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史记录">
                <X size={18} />
              </button>
            </header>
            <div className="ai-history-list">
              {sessions.length === 0 ? (
                <p className="helper-text">还没有 AI 聊天记录。</p>
              ) : (
                sessions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === sessionId ? "active" : ""}
                    onClick={() => {
                      setHistoryOpen(false);
                      onOpenSession(item.id);
                    }}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        <Clock3 size={13} />
                        {item.scopeTitle ?? item.attachment?.scopeTitle ?? item.sourceDate ?? item.updatedAt.slice(0, 10)} / {item.updatedAt.slice(11, 16)}
                      </small>
                    </span>
                    <Trash2
                      size={16}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteSession(item.id);
                      }}
                    />
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
};
