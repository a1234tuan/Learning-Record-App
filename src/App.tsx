import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ClipboardCheck,
  Home,
  Layers,
  MoreHorizontal,
  Search,
  Settings,
} from "lucide-react";

import { useAppData } from "./hooks/useAppData";
import { TodayPage } from "./pages/TodayPage";
import { JournalPage } from "./pages/JournalPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { SearchPage } from "./pages/SearchPage";
import { StatsPage } from "./pages/StatsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { RecordEditorPage } from "./pages/RecordEditorPage";
import { MorePage } from "./pages/MorePage";
import { AiChatPage } from "./pages/AiChatPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { TrashPage } from "./pages/TrashPage";
import { PageTransition } from "./components/PageTransition";
import type { RecordBlock, Subject } from "./types";
import { buildDayLogAiContext } from "./services/dayLogAiContextService";
import { createAiSessionForDate } from "./services/aiSessionService";
import { getFavoriteRecords } from "./lib/journalSelectors";

type Route = "today" | "journal" | "categories" | "search" | "stats" | "settings" | "more" | "record" | "ai" | "favorites" | "trash";
type RecordSource = Exclude<Route, "record">;

const navItems: Array<{ route: Route; label: string; icon: typeof Home }> = [
  { route: "today", label: "今天", icon: Home },
  { route: "journal", label: "日志", icon: CalendarDays },
  { route: "categories", label: "分类", icon: Layers },
  { route: "search", label: "搜索", icon: Search },
  { route: "ai", label: "AI问答", icon: BrainCircuit },
  { route: "stats", label: "统计", icon: BarChart3 },
  { route: "settings", label: "设置", icon: Settings },
];

const bottomNavItems: Array<{ route: Route; label: string; icon: typeof Home }> = [
  { route: "today", label: "今天", icon: Home },
  { route: "journal", label: "日志", icon: CalendarDays },
  { route: "categories", label: "分类", icon: Layers },
  { route: "search", label: "搜索", icon: Search },
  { route: "more", label: "更多", icon: MoreHorizontal },
];

export const App = () => {
  const [route, setRoute] = useState<Route>("today");
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [highlightAssetId, setHighlightAssetId] = useState<string | undefined>();
  const [activeAiSessionId, setActiveAiSessionId] = useState<string | null>(null);
  const [recordSource, setRecordSource] = useState<RecordSource>("journal");
  const [backToast, setBackToast] = useState("");
  const lastBackPressRef = useRef(0);
  const backToastTimerRef = useRef<number | null>(null);
  const app = useAppData();

  const navigate = useCallback((nextRoute: Route) => {
    lastBackPressRef.current = 0;
    if (backToastTimerRef.current) {
      window.clearTimeout(backToastTimerRef.current);
      backToastTimerRef.current = null;
    }
    setBackToast("");
    setActiveRecordId(null);
    setHighlightAssetId(undefined);
    if (nextRoute !== "ai") {
      setActiveAiSessionId(null);
    }
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    if (!app.settings) {
      return;
    }
    document.documentElement.style.setProperty("--font-scale", String(app.settings.fontScale));
    document.documentElement.style.setProperty("--reading-line-height", String(app.settings.lineHeight));
    document.documentElement.dataset.theme = app.settings.theme;
  }, [app.settings]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return undefined;
    }

    let remove: (() => Promise<void>) | undefined;
    let cancelled = false;

    const showExitHint = () => {
      setBackToast("再次点击退出");
      if (backToastTimerRef.current) {
        window.clearTimeout(backToastTimerRef.current);
      }
      backToastTimerRef.current = window.setTimeout(() => {
        setBackToast("");
        backToastTimerRef.current = null;
      }, 2000);
    };

    void CapacitorApp.addListener("backButton", () => {
      if (document.querySelector(".image-lightbox")) {
        return;
      }

      if (route === "record") {
        navigate(recordSource);
        return;
      }

      if (route === "stats" || route === "settings" || route === "ai" || route === "favorites" || route === "trash") {
        navigate("more");
        return;
      }

      if (route !== "today") {
        navigate("today");
        return;
      }

      const now = Date.now();
      if (now - lastBackPressRef.current <= 2000) {
        if (backToastTimerRef.current) {
          window.clearTimeout(backToastTimerRef.current);
          backToastTimerRef.current = null;
        }
        setBackToast("");
        void CapacitorApp.exitApp();
        return;
      }

      lastBackPressRef.current = now;
      showExitHint();
    }).then((handle) => {
      remove = handle.remove;
      if (cancelled) {
        void handle.remove();
      }
    });

    return () => {
      cancelled = true;
      if (remove) {
        void remove();
      }
    };
  }, [navigate, recordSource, route]);

  const favoriteRecords = useMemo(
    () => getFavoriteRecords(app.blocks.filter((block): block is RecordBlock => block.type === "record")),
    [app.blocks],
  );

  if (!app.initialized || !app.settings) {
    return (
      <div className="loading-screen">
        <ClipboardCheck size={28} />
        <span>正在打开你的本地学习日志...</span>
      </div>
    );
  }

  const settings = app.settings;
  const openRecord = (record: RecordBlock, source: RecordSource = route === "record" ? recordSource : route, assetId?: string) => {
    setActiveRecordId(record.id);
    setHighlightAssetId(assetId);
    setRecordSource(source);
    setRoute("record");
  };
  const closeRecord = () => navigate(recordSource);
  const activeRecord = app.blocks.find((block): block is RecordBlock => block.type === "record" && block.id === activeRecordId);
  const openAiForDate = async (date: string) => {
    const attachment = buildDayLogAiContext(date, app.blocks, app.assets);
    const session = await createAiSessionForDate(date, attachment);
    if (session) {
      setActiveAiSessionId(session.id);
      setRoute("ai");
    }
  };

  const renderPage = () => {
    switch (route) {
      case "today":
        return (
          <TodayPage
            entry={app.todayEntry}
            blocks={app.todayBlocks}
            examDate={settings.examDate}
            subjects={app.activeSubjects}
            onSaveEntry={(entry) => void app.saveEntry(entry)}
            onCreateRecord={(date: string, subject: Subject) => app.createRecordBlock(date, subject)}
            onAddSubject={app.addSubject}
            onOpenRecord={(record) => openRecord(record, "today")}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
          />
        );
      case "journal":
        return (
          <JournalPage
            blocks={app.blocks}
            subjects={app.subjects}
            onOpenRecord={(record) => openRecord(record, "journal")}
            onOpenCategories={() => navigate("categories")}
            onAskAi={(date) => void openAiForDate(date)}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
          />
        );
      case "categories":
        return (
          <CategoriesPage
            blocks={app.blocks}
            subjects={app.subjects}
            onOpenRecord={(record) => openRecord(record, "categories")}
            onAddSubject={app.addSubject}
            onRenameSubject={app.renameSubject}
            onSaveSubjects={app.saveSubjects}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
          />
        );
      case "record":
        return activeRecord ? (
          <RecordEditorPage
            record={activeRecord}
            onBack={closeRecord}
            onSave={async (record) => {
              await app.saveBlock(record);
              closeRecord();
            }}
            onDelete={async (recordId) => {
              await app.deleteBlock(recordId);
              closeRecord();
            }}
            onToggleFavorite={(record, favorite) => app.toggleRecordFavorite(record.id, favorite)}
            onAddAsset={app.saveAssetFile}
            onAssetChanged={app.refresh}
            highlightedAssetId={highlightAssetId}
            subjects={app.subjects}
            onAddSubject={app.addSubject}
          />
        ) : (
          <JournalPage
            blocks={app.blocks}
            subjects={app.subjects}
            onOpenRecord={(record) => openRecord(record, "journal")}
            onOpenCategories={() => navigate("categories")}
            onAskAi={(date) => void openAiForDate(date)}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
          />
        );
      case "search":
        return (
          <SearchPage
            entries={app.entries}
            blocks={app.blocks}
            assets={app.assets}
            onOpenRecord={(recordId, assetId) => {
              const record = app.blocks.find((block): block is RecordBlock => block.type === "record" && block.id === recordId);
              if (record) {
                openRecord(record, "search", assetId);
              }
            }}
          />
        );
      case "stats":
        return <StatsPage blocks={app.blocks} assets={app.assets} subjects={app.subjects} />;
      case "more":
        return (
          <MorePage
            onOpenStats={() => navigate("stats")}
            onOpenSettings={() => navigate("settings")}
            onOpenAi={() => navigate("ai")}
            onOpenFavorites={() => navigate("favorites")}
            onOpenTrash={() => navigate("trash")}
            onRestored={app.refresh}
            settings={settings}
          />
        );
      case "favorites":
        return (
          <FavoritesPage
            records={favoriteRecords}
            onOpenRecord={(record) => openRecord(record, "favorites")}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
          />
        );
      case "trash":
        return (
          <TrashPage
            records={app.deletedRecords}
            onRestore={(record) => app.restoreBlock(record.id)}
            onPermanentDelete={async (record) => {
              const ok = window.confirm(`永久删除“${record.title}”吗？\n\n这一步无法恢复。`);
              if (ok) {
                await app.permanentlyDeleteBlock(record.id);
              }
            }}
            onClearTrash={async () => {
              const ok = window.confirm("确定清空回收站吗？\n\n所有回收站记录都会被永久删除，无法恢复。");
              if (!ok) {
                return;
              }
              for (const record of app.deletedRecords) {
                await app.permanentlyDeleteBlock(record.id);
              }
            }}
            onPurgeExpired={async () => {
              await app.purgeExpiredDeletedBlocks(30);
            }}
          />
        );
      case "ai":
        return (
          <AiChatPage
            sessionId={activeAiSessionId}
            settings={settings}
            onOpenSession={(sessionId) => {
              setActiveAiSessionId(sessionId);
              setRoute("ai");
            }}
            onDeletedSession={() => {
              setActiveAiSessionId(null);
              setRoute("ai");
            }}
            onOpenSettings={() => navigate("more")}
          />
        );
      case "settings":
        return (
          <SettingsPage
            settings={settings}
            onSaveSettings={(settings) => void app.persistSettings(settings)}
            onRestored={app.refresh}
          />
        );
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>学</span>
          <div>
            <strong>学习日志</strong>
            <small>离线优先</small>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.route}
                type="button"
                className={route === item.route ? "active" : ""}
                onClick={() => navigate(item.route)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <section className="pinned-panel">
          <p className="eyebrow">Pinned</p>
          {favoriteRecords.length === 0 ? (
            <small>收藏的日志会出现在这里。</small>
          ) : (
            favoriteRecords.slice(0, 5).map((record) => <small key={record.id}>{record.title}</small>)
          )}
        </section>
      </aside>
      <div className="content-area">
        <PageTransition pageKey={route === "record" ? `${route}-${activeRecordId ?? "empty"}` : route}>
          {renderPage()}
        </PageTransition>
      </div>
      {backToast && (
        <div className="app-toast" role="status" aria-live="polite">
          {backToast}
        </div>
      )}
      <nav className="bottom-nav">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const active = route === item.route || (item.route === "more" && (route === "stats" || route === "settings" || route === "ai" || route === "favorites" || route === "trash"));
          return (
            <button
              key={item.route}
              type="button"
              className={active ? "active" : ""}
              onClick={() => navigate(item.route)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

