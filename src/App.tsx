import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  CalendarCheck,
  ClipboardCheck,
  Home,
  Layers,
  Mic2,
  MoreHorizontal,
  Settings,
} from "lucide-react";

import { useAppData } from "./hooks/useAppData";
import { TodayPage } from "./pages/TodayPage";
import { JournalPage } from "./pages/JournalPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { SearchPage } from "./pages/SearchPage";
import { RecordingsPage } from "./pages/RecordingsPage";
import { ReviewPage } from "./pages/ReviewPage";
import { StatsPage } from "./pages/StatsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { RecordEditorPage } from "./pages/RecordEditorPage";
import { MorePage } from "./pages/MorePage";
import { BackupPage } from "./pages/BackupPage";
import { AiToolsPage } from "./pages/AiToolsPage";
import { AiChatPage } from "./pages/AiChatPage";
import { OcrSettingsPage } from "./pages/OcrSettingsPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { TrashPage } from "./pages/TrashPage";
import { UsageGuidePage } from "./pages/UsageGuidePage";
import { PageTransition } from "./components/PageTransition";
import type { RecordBlock, Subject } from "./types";
import { buildDayLogAiContext } from "./services/dayLogAiContextService";
import { createAiSessionForDate } from "./services/aiSessionService";
import { getFavoriteRecords } from "./lib/journalSelectors";
import { todayISO } from "./lib/date";
import {
  createInitialTabMemory,
  getRecordState,
  getTabDepth,
  popTabDepth,
  type MoreSubRoute,
  type TabKey,
  type TabMemory,
} from "./lib/tabNavigation";

const isEditableElement = (target: EventTarget | Element | null) => {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
};

const useKeyboardVisible = () => {
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const initialHeight = visualViewport?.height ?? window.innerHeight;
    let focusTimer: number | null = null;

    const update = () => {
      const activeEditable = isEditableElement(document.activeElement);
      const currentHeight = visualViewport?.height ?? window.innerHeight;
      const heightDelta = initialHeight - currentHeight;
      const mobileViewport = window.matchMedia("(max-width: 920px)").matches;
      const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
      const mobileInputFallback = mobileViewport && (coarsePointer || Capacitor.isNativePlatform());
      setKeyboardVisible(activeEditable && (heightDelta > 120 || mobileInputFallback));
    };

    const updateAfterFocus = () => {
      if (focusTimer) {
        window.clearTimeout(focusTimer);
      }
      focusTimer = window.setTimeout(update, 80);
    };

    const handleFocusOut = () => {
      if (focusTimer) {
        window.clearTimeout(focusTimer);
      }
      focusTimer = window.setTimeout(update, 120);
    };

    window.addEventListener("focusin", updateAfterFocus);
    window.addEventListener("focusout", handleFocusOut);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      if (focusTimer) {
        window.clearTimeout(focusTimer);
      }
      window.removeEventListener("focusin", updateAfterFocus);
      window.removeEventListener("focusout", handleFocusOut);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return keyboardVisible;
};

const navItems: Array<{ tab: TabKey; subRoute?: Exclude<MoreSubRoute, null>; label: string; icon: typeof Home }> = [
  { tab: "today", label: "今天", icon: Home },
  { tab: "journal", label: "日志", icon: CalendarDays },
  { tab: "categories", label: "分类", icon: Layers },
  { tab: "review", label: "复习", icon: CalendarCheck },
  { tab: "more", subRoute: "recordings", label: "录音", icon: Mic2 },
  { tab: "more", subRoute: "ai", label: "AI问答", icon: BrainCircuit },
  { tab: "more", subRoute: "stats", label: "统计", icon: BarChart3 },
  { tab: "more", subRoute: "settings", label: "设置", icon: Settings },
];

const bottomNavItems: Array<{ tab: TabKey; label: string; icon: typeof Home }> = [
  { tab: "today", label: "今天", icon: Home },
  { tab: "journal", label: "日志", icon: CalendarDays },
  { tab: "categories", label: "分类", icon: Layers },
  { tab: "review", label: "复习", icon: CalendarCheck },
  { tab: "more", label: "更多", icon: MoreHorizontal },
];

export const App = () => {
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [tabMemory, setTabMemory] = useState<TabMemory>(() => createInitialTabMemory());
  const [activeAiSessionId, setActiveAiSessionId] = useState<string | null>(null);
  const [backToast, setBackToast] = useState("");
  const [reviewToast, setReviewToast] = useState("");
  const lastBackPressRef = useRef(0);
  const backToastTimerRef = useRef<number | null>(null);
  const app = useAppData();
  const keyboardVisible = useKeyboardVisible();

  const clearBackHint = useCallback(() => {
    lastBackPressRef.current = 0;
    if (backToastTimerRef.current) {
      window.clearTimeout(backToastTimerRef.current);
      backToastTimerRef.current = null;
    }
    setBackToast("");
  }, []);

  const switchTab = useCallback(
    (tab: TabKey) => {
      clearBackHint();
      setActiveTab(tab);
    },
    [clearBackHint],
  );

  const openMoreSubRoute = useCallback(
    (subRoute: MoreSubRoute) => {
      clearBackHint();
      setTabMemory((current) => ({
        ...current,
        more: {
          ...current.more,
          subRoute,
          recordId: undefined,
          highlightAssetId: undefined,
          recordEditing: undefined,
        },
      }));
      setActiveTab("more");
    },
    [clearBackHint],
  );

  const openRecordInTab = useCallback(
    (record: RecordBlock, tab: TabKey, assetId?: string, editing = false) => {
      clearBackHint();
      setTabMemory((current) => ({
        ...current,
        [tab]: {
          ...current[tab],
          recordId: record.id,
          highlightAssetId: assetId,
          recordEditing: editing,
        },
      }));
      setActiveTab(tab);
    },
    [clearBackHint],
  );

  const closeRecordInCurrentTab = useCallback(() => {
    setTabMemory((current) => ({
      ...current,
      [activeTab]: {
        ...current[activeTab],
        recordId: undefined,
        highlightAssetId: undefined,
        recordEditing: undefined,
      },
    }));
  }, [activeTab]);

  const setCurrentRecordEditing = useCallback((recordEditing: boolean) => {
    setTabMemory((current) => ({
      ...current,
      [activeTab]: {
        ...current[activeTab],
        recordEditing,
      },
    }));
  }, [activeTab]);

  const popCurrentTabDepth = useCallback(() => {
    setTabMemory((current) => popTabDepth(current, activeTab));
  }, [activeTab]);

  useEffect(() => {
    if (!app.settings) {
      return;
    }
    document.documentElement.style.setProperty("--font-scale", String(app.settings.fontScale));
    document.documentElement.style.setProperty("--reading-line-height", String(app.settings.lineHeight));
    document.documentElement.dataset.theme = app.settings.theme;
  }, [app.settings]);

  useEffect(() => {
    if (!app.initialized || app.dueRecordReviews.length === 0) {
      return;
    }
    const key = "study-journal-review-toast-date";
    const today = todayISO();
    if (localStorage.getItem(key) === today) {
      return;
    }
    localStorage.setItem(key, today);
    setReviewToast(`今天有 ${app.dueRecordReviews.length} 条笔记待复习`);
    const timer = window.setTimeout(() => setReviewToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [app.dueRecordReviews.length, app.initialized]);

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

      if (getTabDepth(activeTab, tabMemory) > 0) {
        clearBackHint();
        popCurrentTabDepth();
        return;
      }

      if (activeTab !== "today") {
        switchTab("today");
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
  }, [activeTab, clearBackHint, popCurrentTabDepth, switchTab, tabMemory]);

  const favoriteRecords = useMemo(
    () => getFavoriteRecords(app.blocks.filter((block): block is RecordBlock => block.type === "record")),
    [app.blocks],
  );
  const recordReviewsByRecord = useMemo(
    () => Object.fromEntries(app.recordReviews.map((review) => [review.recordId, review])),
    [app.recordReviews],
  );
  const reviewLogsByRecord = useMemo(() => {
    const grouped: Record<string, typeof app.recordReviewLogs> = {};
    for (const log of app.recordReviewLogs) {
      grouped[log.recordId] = [...(grouped[log.recordId] ?? []), log];
    }
    return grouped;
  }, [app.recordReviewLogs]);
  const recordTitlesById = useMemo(
    () => Object.fromEntries(app.blocks.filter((block): block is RecordBlock => block.type === "record").map((record) => [record.id, record.title])),
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
  const currentRecordState = getRecordState(activeTab, tabMemory);
  const currentRecord = currentRecordState.recordId
    ? app.blocks.find((block): block is RecordBlock => block.type === "record" && block.id === currentRecordState.recordId)
    : undefined;

  const openAiForDate = async (date: string) => {
    const attachment = buildDayLogAiContext(date, app.blocks, app.assets);
    const session = await createAiSessionForDate(date, attachment);
    if (session) {
      setActiveAiSessionId(session.id);
      openMoreSubRoute("ai");
    }
  };

  const renderRecordPage = (record: RecordBlock, highlightedAssetId?: string) => (
    <RecordEditorPage
      record={record}
      initialEditing={Boolean(currentRecordState.recordEditing)}
      onEditingChange={setCurrentRecordEditing}
      onBack={closeRecordInCurrentTab}
      onSave={async (nextRecord) => app.saveBlock(nextRecord)}
      onDelete={async (recordId) => {
        await app.deleteBlock(recordId);
        closeRecordInCurrentTab();
      }}
      onToggleFavorite={(record, favorite) => app.toggleRecordFavorite(record.id, favorite)}
      onAddAsset={app.saveAssetFile}
      onAssetTitleChange={app.renameAssetTitle}
      onAssetChanged={app.refresh}
      highlightedAssetId={highlightedAssetId}
      subjects={app.subjects}
      onGetDraft={app.getRecordDraft}
      onSaveDraft={app.saveRecordDraft}
      onDeleteDraft={app.deleteRecordDraft}
      reviewState={recordReviewsByRecord[record.id]}
      reviewLogs={reviewLogsByRecord[record.id] ?? []}
      onAddToReview={async (recordId) => {
        await app.addRecordToReview(recordId);
      }}
      onResetReview={async (recordId) => {
        await app.resetRecordReview(recordId);
      }}
      onRemoveReview={async (recordId) => {
        await app.removeRecordFromReview(recordId);
      }}
    />
  );

  const renderMorePage = () => {
    if (currentRecord) {
      return renderRecordPage(currentRecord, tabMemory.more.highlightAssetId);
    }

    switch (tabMemory.more.subRoute) {
      case "stats":
        return <StatsPage blocks={app.blocks} assets={app.assets} subjects={app.subjects} reviewStats={app.recordReviewStats} />;
      case "recordings":
        return (
          <RecordingsPage
            blocks={app.blocks}
            assets={app.assets}
            subjects={app.subjects}
            selectedSubject={tabMemory.more.recordingsState.selectedSubject}
            playerAssetId={tabMemory.more.recordingsState.playerAssetId}
            query={tabMemory.more.recordingsState.query}
            searchOpen={tabMemory.more.recordingsState.searchOpen}
            onSelectedSubjectChange={(selectedSubject) =>
              setTabMemory((current) => ({
                ...current,
                more: { ...current.more, recordingsState: { ...current.more.recordingsState, selectedSubject } },
              }))
            }
            onPlayerChange={(playerAssetId) =>
              setTabMemory((current) => ({
                ...current,
                more: { ...current.more, recordingsState: { ...current.more.recordingsState, playerAssetId } },
              }))
            }
            onQueryChange={(query) =>
              setTabMemory((current) => ({
                ...current,
                more: { ...current.more, recordingsState: { ...current.more.recordingsState, query } },
              }))
            }
            onSearchOpenChange={(searchOpen) =>
              setTabMemory((current) => ({
                ...current,
                more: { ...current.more, recordingsState: { ...current.more.recordingsState, searchOpen } },
              }))
            }
            onRenameAudio={app.renameAssetTitle}
            onDurationKnown={app.updateAssetDuration}
          />
        );
      case "settings":
        return (
          <SettingsPage
            settings={settings}
            onSaveSettings={(nextSettings) => void app.persistSettings(nextSettings)}
            onRestored={app.refresh}
          />
        );
      case "favorites":
        return (
          <FavoritesPage
            records={favoriteRecords}
            onOpenRecord={(record) => openRecordInTab(record, "more")}
            onAskAi={(date) => void openAiForDate(date)}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
            reviewStatesByRecord={recordReviewsByRecord}
            onAddToReview={(recordId) => void app.addRecordToReview(recordId)}
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
      case "backup":
        return <BackupPage settings={settings} onRestored={app.refresh} />;
      case "aiTools":
        return (
          <AiToolsPage
            settings={settings}
            onChanged={app.refresh}
            onOpenAi={() => openMoreSubRoute("ai")}
          />
        );
      case "ocrSettings":
        return <OcrSettingsPage onChanged={app.refresh} />;
      case "guide":
        return <UsageGuidePage />;
      case "ai":
        return (
          <AiChatPage
            sessionId={activeAiSessionId}
            settings={settings}
            blocks={app.blocks}
            assets={app.assets}
            onOpenSession={(sessionId) => {
              setActiveAiSessionId(sessionId);
              openMoreSubRoute("ai");
            }}
            onDeletedSession={() => {
              setActiveAiSessionId(null);
              openMoreSubRoute("ai");
            }}
            onOpenSettings={() => openMoreSubRoute(null)}
          />
        );
      case null:
        return (
          <MorePage
            onOpenBackup={() => openMoreSubRoute("backup")}
            onOpenAiTools={() => openMoreSubRoute("aiTools")}
            onOpenOcrSettings={() => openMoreSubRoute("ocrSettings")}
            onOpenStats={() => openMoreSubRoute("stats")}
            onOpenSettings={() => openMoreSubRoute("settings")}
            onOpenTrash={() => openMoreSubRoute("trash")}
            onOpenRecordings={() => openMoreSubRoute("recordings")}
            onOpenGuide={() => openMoreSubRoute("guide")}
            settings={settings}
          />
        );
    }
  };

  const renderCurrentTab = () => {
    switch (activeTab) {
      case "today":
        return currentRecord ? (
          renderRecordPage(currentRecord, tabMemory.today.highlightAssetId)
        ) : (
          <TodayPage
            entry={app.todayEntry}
            blocks={app.todayBlocks}
            examDate={settings.examDate}
            subjects={app.activeSubjects}
            onSaveEntry={(entry) => void app.saveEntry(entry)}
            onCreateRecord={(date: string, subject: Subject) => app.createRecordBlock(date, subject)}
            onOpenFavorites={() => openMoreSubRoute("favorites")}
            onOpenRecord={(record) => openRecordInTab(record, "today")}
            onOpenReview={() => switchTab("review")}
            onAskAi={(date) => void openAiForDate(date)}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
            reviewStatesByRecord={recordReviewsByRecord}
            dueReviewStates={app.dueRecordReviews}
            reviewTitlesByRecord={recordTitlesById}
            onAddToReview={(recordId) => void app.addRecordToReview(recordId)}
          />
        );
      case "journal":
        return currentRecord ? (
          renderRecordPage(currentRecord, tabMemory.journal.highlightAssetId)
        ) : tabMemory.journal.searchOpen ? (
          <SearchPage
            entries={app.entries}
            blocks={app.blocks}
            assets={app.assets}
            query={tabMemory.journal.searchQuery}
            onQueryChange={(searchQuery) =>
              setTabMemory((current) => ({ ...current, journal: { ...current.journal, searchQuery } }))
            }
            onBack={() =>
              setTabMemory((current) => ({ ...current, journal: { ...current.journal, searchOpen: false } }))
            }
            onOpenRecord={(recordId, assetId) => {
              const record = app.blocks.find((block): block is RecordBlock => block.type === "record" && block.id === recordId);
              if (record) {
                openRecordInTab(record, "journal", assetId);
              }
            }}
          />
        ) : (
          <JournalPage
            blocks={app.blocks}
            subjects={app.subjects}
            month={tabMemory.journal.month}
            selectedDate={tabMemory.journal.selectedDate}
            selectedSubject={tabMemory.journal.selectedSubject}
            onMonthChange={(month) =>
              setTabMemory((current) => ({ ...current, journal: { ...current.journal, month } }))
            }
            onSelectedDateChange={(selectedDate) =>
              setTabMemory((current) => ({
                ...current,
                journal: { ...current.journal, selectedDate, selectedSubject: undefined },
              }))
            }
            onSelectedSubjectChange={(selectedSubject) =>
              setTabMemory((current) => ({ ...current, journal: { ...current.journal, selectedSubject } }))
            }
            onOpenRecord={(record) => openRecordInTab(record, "journal")}
            onOpenSearch={() =>
              setTabMemory((current) => ({ ...current, journal: { ...current.journal, searchOpen: true } }))
            }
            onAskAi={(date) => void openAiForDate(date)}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
            reviewStatesByRecord={recordReviewsByRecord}
            onAddToReview={(recordId) => void app.addRecordToReview(recordId)}
            onAddManyToReview={async (recordIds) => {
              const result = await app.addRecordsToReview(recordIds);
              return `成功加入 ${result.added} 条，重置 ${result.reset} 条，跳过 ${result.skippedActive} 条已在复习中的记录。`;
            }}
          />
        );
      case "categories":
        return currentRecord ? (
          renderRecordPage(currentRecord, tabMemory.categories.highlightAssetId)
        ) : (
          <CategoriesPage
            blocks={app.blocks}
            subjects={app.subjects}
            activeSubject={tabMemory.categories.activeSubject}
            managing={tabMemory.categories.managing}
            onActiveSubjectChange={(activeSubject) =>
              setTabMemory((current) => ({ ...current, categories: { ...current.categories, activeSubject } }))
            }
            onManagingChange={(managing) =>
              setTabMemory((current) => ({ ...current, categories: { ...current.categories, managing } }))
            }
            onOpenRecord={(record) => openRecordInTab(record, "categories")}
            onAskAi={(date) => void openAiForDate(date)}
            onAddSubject={app.addSubject}
            onRenameSubject={app.renameSubject}
            onSaveSubjects={app.saveSubjects}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
            reviewStatesByRecord={recordReviewsByRecord}
            onAddToReview={(recordId) => void app.addRecordToReview(recordId)}
          />
        );
      case "review":
        return currentRecord ? (
          renderRecordPage(currentRecord, tabMemory.review.highlightAssetId)
        ) : (
          <ReviewPage
            records={app.blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt)}
            dueReviews={app.dueRecordReviews}
            reviewStates={app.recordReviews}
            stats={app.recordReviewStats}
            mode={tabMemory.review.mode}
            queueIds={tabMemory.review.queueIds}
            currentRecordId={tabMemory.review.currentRecordId}
            onModeChange={(mode) =>
              setTabMemory((current) => ({ ...current, review: { ...current.review, mode } }))
            }
            onQueueChange={(queueIds) =>
              setTabMemory((current) => ({ ...current, review: { ...current.review, queueIds } }))
            }
            onCurrentRecordChange={(currentRecordId) =>
              setTabMemory((current) => ({ ...current, review: { ...current.review, currentRecordId } }))
            }
            onEnsureDay={app.ensureRecordReviewDay}
            onRate={async (recordId, rating) => {
              await app.rateRecordReview(recordId, rating);
            }}
            onRefresh={app.refresh}
            onOpenRecord={(record) => openRecordInTab(record, "review")}
            onEditRecord={(record) => openRecordInTab(record, "review", undefined, true)}
            onAddToReview={async (recordId) => {
              await app.addRecordToReview(recordId);
            }}
            onRemoveReview={async (recordId) => {
              await app.removeRecordFromReview(recordId);
            }}
            onResetReview={async (recordId) => {
              await app.resetRecordReview(recordId);
            }}
          />
        );
      case "more":
        return renderMorePage();
    }
  };

  const pageKey = (() => {
    const depth = getTabDepth(activeTab, tabMemory);
    const recordPart = currentRecordState.recordId ?? "root";
    if (activeTab === "journal") {
      return `${activeTab}-${depth}-${recordPart}-${tabMemory.journal.searchOpen ? "search" : "browse"}`;
    }
    if (activeTab === "categories") {
      return `${activeTab}-${depth}-${recordPart}-${tabMemory.categories.managing ? "manage" : tabMemory.categories.activeSubject ?? "all"}`;
    }
    if (activeTab === "review") {
      return `${activeTab}-${depth}-${recordPart}-${tabMemory.review.mode}-${tabMemory.review.currentRecordId ?? "root"}-${tabMemory.review.queueIds.join(".")}`;
    }
    if (activeTab === "more") {
      return `${activeTab}-${depth}-${recordPart}-${tabMemory.more.subRoute ?? "root"}-${activeAiSessionId ?? "none"}`;
    }
    return `${activeTab}-${depth}-${recordPart}`;
  })();

  const shellClassName = [
    "app-shell",
    keyboardVisible ? "keyboard-open" : "",
    activeTab === "more" && tabMemory.more.subRoute === "ai" ? "ai-chat-active" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClassName}>
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
            const active = item.subRoute
              ? activeTab === "more" && tabMemory.more.subRoute === item.subRoute
              : activeTab === item.tab;
            return (
              <button
                key={`${item.tab}-${item.subRoute ?? "root"}`}
                type="button"
                className={active ? "active" : ""}
                onClick={() => (item.subRoute ? openMoreSubRoute(item.subRoute) : switchTab(item.tab))}
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
        <PageTransition pageKey={pageKey}>{renderCurrentTab()}</PageTransition>
      </div>
      {backToast && (
        <div className="app-toast" role="status" aria-live="polite">
          {backToast}
        </div>
      )}
      {reviewToast && (
        <div className="app-toast review-toast" role="status" aria-live="polite">
          {reviewToast}
        </div>
      )}
      <nav className="bottom-nav">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.tab;
          return (
            <button
              key={item.tab}
              type="button"
              className={active ? "active" : ""}
              onClick={() => switchTab(item.tab)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
              {item.tab === "review" && app.dueRecordReviews.length > 0 && (
                <b className="bottom-nav-badge">{app.dueRecordReviews.length}</b>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
