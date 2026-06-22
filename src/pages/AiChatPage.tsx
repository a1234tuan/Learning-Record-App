import {
  Bot,
  Clock3,
  Copy,
  History,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AiChatMessage, AiChatSession, AppSettings } from "../types";
import { createBaseEntity } from "../lib/entity";
import { storage } from "../services/storageAdapter";
import { sendChatCompletion } from "../services/aiClientService";
import { createAiSessionFromExistingAttachment, titleFromFirstPrompt } from "../services/aiSessionService";

interface AiChatPageProps {
  sessionId: string | null;
  settings: AppSettings;
  onOpenSession: (sessionId: string) => void;
  onDeletedSession: () => void;
  onOpenSettings: () => void;
}

const sortedPresets = (settings: AppSettings) =>
  [...(settings.ai?.presets ?? [])]
    .filter((preset) => preset.title.trim() && preset.prompt.trim())
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

export const AiChatPage = ({
  sessionId,
  settings,
  onOpenSession,
  onDeletedSession,
  onOpenSettings,
}: AiChatPageProps) => {
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [session, setSession] = useState<AiChatSession | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const presets = useMemo(() => sortedPresets(settings), [settings]);

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
    setMessages(nextSession ? await storage.listAiMessages?.(nextSession.id) ?? [] : []);
  };

  useEffect(() => {
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
    const nextSession = await createAiSessionFromExistingAttachment(session);
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

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || !session || busy) {
      return;
    }
    setBusy(true);
    setStatus("");
    setInput("");

    const titleSession = await updateTitleFromFirstPrompt(prompt, session, messages.length);
    const userMessage: AiChatMessage = {
      ...createBaseEntity(),
      sessionId: titleSession.id,
      role: "user",
      content: prompt,
    };
    await storage.saveAiMessage?.(userMessage);
    const visibleHistory = [...messages, userMessage];
    setMessages(visibleHistory);

    try {
      const apiKey = (await storage.getAiSecret?.())?.apiKey;
      const content = await sendChatCompletion({
        config: settings.ai,
        apiKey,
        attachment: titleSession.attachment,
        history: messages,
        prompt,
      });
      const assistantMessage: AiChatMessage = {
        ...createBaseEntity(),
        sessionId: titleSession.id,
        role: "assistant",
        content,
      };
      await storage.saveAiMessage?.(assistantMessage);
      setMessages([...visibleHistory, assistantMessage]);
      await refresh();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "AI 请求失败。";
      const assistantMessage: AiChatMessage = {
        ...createBaseEntity(),
        sessionId: titleSession.id,
        role: "assistant",
        content: errorText,
        error: errorText,
      };
      await storage.saveAiMessage?.(assistantMessage);
      setMessages([...visibleHistory, assistantMessage]);
    } finally {
      setBusy(false);
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
            {attachment.ocrSummary && (
              <span>
                图片文字 {attachment.ocrSummary.includedImages}/{attachment.ocrSummary.includedImages + attachment.ocrSummary.skippedImages}
              </span>
            )}
            {attachment.warnings.slice(0, 2).map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
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
              <h2>日志已准备好。</h2>
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
                    {preset.title}
                  </button>
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
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="带着这份日志问 AI，比如：用苏格拉底式方法抽问我"
                rows={2}
              />
              <button type="submit" className="primary-button" disabled={busy || !input.trim()}>
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
