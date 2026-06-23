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
  Trash2,
  User,
  X,
} from "lucide-react";
import { Camera as CapacitorCamera, CameraResultType, CameraSource, MediaTypeSelection } from "@capacitor/camera";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AiChatAttachment, AiChatMessage, AiChatSession, AppSettings, Asset, Block } from "../types";
import { createBaseEntity } from "../lib/entity";
import { isNativePlatform } from "../lib/platform";
import { storage } from "../services/storageAdapter";
import { buildSessionMemorySummary, sendChatCompletion } from "../services/aiClientService";
import { buildAiContextPack } from "../services/aiContextService";
import { createAiImageAttachment, runLocalOcrForAiAttachment } from "../services/aiChatAttachmentService";
import { createAiSessionForDate, createAiSessionFromExistingAttachment, titleFromFirstPrompt } from "../services/aiSessionService";
import { DEFAULT_AI_MEMORY_TURNS, getCurrentAiProvider } from "../lib/aiProviders";

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
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const presets = useMemo(() => sortedPresets(settings), [settings]);
  const imageInputMode = settings.ai?.imageInputMode ?? "local-ocr";
  const native = isNativePlatform();

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
    await navigator.clipboard.writeText(text);
    setStatus("已复制。");
  };

  const openNewChat = async () => {
    if (!session?.attachment) {
      return;
    }
    const nextSession = session.sourceDate
      ? await createAiSessionForDate(session.sourceDate, buildAiContextPack(session.sourceDate, blocks, assets))
      : await createAiSessionFromExistingAttachment(session);
    if (nextSession) {
      setHistoryOpen(false);
      onOpenSession(nextSession.id);
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

  const mediaResultToFile = async (media: { webPath?: string; format?: string; metadata?: { format?: string } }, prefix: string) => {
    if (!media.webPath) {
      return undefined;
    }
    const response = await fetch(media.webPath);
    const blob = await response.blob();
    const format = media.format ?? media.metadata?.format;
    const extension = format ? `.${format}` : ".jpg";
    return new File([blob], `${prefix}-${Date.now()}${extension}`, {
      type: blob.type || `image/${format ?? "jpeg"}`,
    });
  };

  const pickNativeImage = async (source: CameraSource) => {
    const photo = await CapacitorCamera.getPhoto({
      quality: 88,
      resultType: CameraResultType.Uri,
      source,
    });
    const file = await mediaResultToFile(photo, "ai-chat-image");
    if (file) {
      await addImageFile(file);
    }
  };

  const pickNativeGalleryImage = async () => {
    try {
      const result = await CapacitorCamera.chooseFromGallery({
        mediaType: MediaTypeSelection.Photo,
        allowMultipleSelection: false,
        quality: 88,
      });
      const photo = result.results?.[0];
      const file = photo ? await mediaResultToFile(photo, "ai-gallery-image") : undefined;
      if (file) {
        await addImageFile(file);
      }
    } catch {
      await pickNativeImage(CameraSource.Photos);
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
    const titleSession = await updateTitleFromFirstPrompt(effectivePrompt, session, messages.length);
    const freshAttachment = titleSession.sourceDate
      ? buildAiContextPack(titleSession.sourceDate, blocks, assets, effectivePrompt)
      : titleSession.attachment
        ? buildAiContextPack(titleSession.attachment.date, blocks, assets, effectivePrompt)
        : undefined;
    const contextSession = freshAttachment && freshAttachment.contextHash !== titleSession.lastContextHash
      ? await storage.saveAiSession?.({
        ...titleSession,
        attachment: freshAttachment,
        lastContextHash: freshAttachment.contextHash,
      }) ?? { ...titleSession, attachment: freshAttachment, lastContextHash: freshAttachment.contextHash }
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
      const provider = getCurrentAiProvider(settings.ai);
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

  return (
    <main className="page ai-chat-page immersive">
      <section className="ai-chat-shell">
        <header className="ai-topbar">
          <div className="ai-topbar-title">
            <p>{attachment?.date ?? "AI Chat"}</p>
            <h1>{session?.title ?? "AI 问答"}</h1>
          </div>
          <div className="ai-topbar-actions">
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
            <strong>{attachment.date} 日志附件</strong>
            <span>{attachment.recordIds.length} 条记录</span>
            <span>片段 {selectedChunkCount}/{totalChunkCount}</span>
            {attachment.ocrSummary && (
              <span>
                图片文字 {attachment.ocrSummary.includedImages}/{attachment.ocrSummary.includedImages + attachment.ocrSummary.skippedImages}
              </span>
            )}
            <span>跳过 {skippedAssetCount} 个资源</span>
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
              <h2>从日志卡片开启一个 AI 问答。</h2>
              <p>右上角可以查看本机历史聊天记录。</p>
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
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
                    <button type="button" className="icon-button" disabled={busy} onClick={() => void pickNativeImage(CameraSource.Camera)} aria-label="拍照上传">
                      <Camera size={18} />
                    </button>
                    <button type="button" className="icon-button" disabled={busy} onClick={() => void pickNativeGalleryImage()} aria-label="从相册上传">
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
                        {item.sourceDate ?? item.updatedAt.slice(0, 10)} / {item.updatedAt.slice(11, 16)}
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
