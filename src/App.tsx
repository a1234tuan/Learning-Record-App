import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  BarChart3,
  ArrowLeft,
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
import { buildDayLogAiContextAsync } from "./services/dayLogAiContextService";
import { createAiSessionForDate } from "./services/aiSessionService";
import { exportRecordTransferPackage } from "./services/recordTransferService";
import { storage } from "./services/storageAdapter";
import { getFavoriteRecords } from "./lib/journalSelectors";
import { todayISO } from "./lib/date";
import { isDesktopPlatform } from "./lib/platform";
import { onAppBackgroundAutoBackup } from "./services/autoBackupService";
import { flushDesktopPendingChanges } from "./services/desktopLifecycleService";
import {
  buildTabPageKey,
  createInitialTabMemory,
  getRecordState,
  getTabDepth,
  MAX_RECORD_REFERENCE_DEPTH,
  popTabDepth,
  recordReferenceOpenError,
  reviewQueueReferenceOpenError,
  type MoreSubRoute,
  type TabKey,
  type TabMemory,
} from "./lib/tabNavigation";
import {
  createWebNavigationSessionId,
  createWebNavigationSnapshot,
  isCurrentWebNavigationSession,
  restoreWebNavigationSnapshot,
} from "./lib/webNavigationHistory";

const sameIds = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const DESKTOP_MIGRATION_SEEN_KEY = "study-journal-desktop-migration-seen";

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

type NavigationState = {
  activeTab: TabKey;
  tabMemory: TabMemory;
  activeAiSessionId: string | null;
};

type NavigationCommitOptions = {
  history?: "push" | "replace" | "none";
  scrollToTop?: boolean;
};

export const App = () => {
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [tabMemory, setTabMemory] = useState<TabMemory>(() => createInitialTabMemory());
  const [activeAiSessionId, setActiveAiSessionId] = useState<string | null>(null);
  const [backToast, setBackToast] = useState("");
  const [reviewToast, setReviewToast] = useState("");
  const [desktopMigrationOpen, setDesktopMigrationOpen] = useState(false);
  const lastBackPressRef = useRef(0);
  const backToastTimerRef = useRef<number | null>(null);
  const navigationStateRef = useRef<NavigationState>({ activeTab, tabMemory, activeAiSessionId });
  const webNavigationSessionRef = useRef<string | null>(null);
  const historyScrollRestoreRef = useRef(0);
  const app = useAppData();
  const keyboardVisible = useKeyboardVisible();

  navigationStateRef.current = { activeTab, tabMemory, activeAiSessionId };

  const clearBackHint = useCallback(() => {
    lastBackPressRef.current = 0;
    if (backToastTimerRef.current) {
      window.clearTimeout(backToastTimerRef.current);
      backToastTimerRef.current = null;
    }
    setBackToast("");
  }, []);

  const commitNavigation = useCallback((next: NavigationState, options: NavigationCommitOptions = {}) => {
    const current = navigationStateRef.current;
    const historyMode = options.history ?? "push";
    const sessionId = webNavigationSessionRef.current;
    const webNavigationEnabled = !Capacitor.isNativePlatform() && !isDesktopPlatform() && Boolean(sessionId);
    const nextScrollY = options.scrollToTop ? 0 : window.scrollY;

    if (webNavigationEnabled && sessionId && historyMode !== "none") {
      const currentSnapshot = createWebNavigationSnapshot(
        sessionId,
        current.activeTab,
        current.tabMemory,
        current.activeAiSessionId,
        window.scrollY,
      );
      const nextSnapshot = createWebNavigationSnapshot(
        sessionId,
        next.activeTab,
        next.tabMemory,
        next.activeAiSessionId,
        nextScrollY,
      );
      if (historyMode === "push") {
        window.history.replaceState(currentSnapshot, "");
        window.history.pushState(nextSnapshot, "");
      } else {
        window.history.replaceState(nextSnapshot, "");
      }
    }

    navigationStateRef.current = next;
    setActiveTab(next.activeTab);
    setTabMemory(next.tabMemory);
    setActiveAiSessionId(next.activeAiSessionId);
    if (options.scrollToTop) {
      window.scrollTo(0, 0);
    }
  }, []);

  const updateNavigationState = useCallback((update: (current: NavigationState) => NavigationState, history: "replace" | "none" = "replace") => {
    const current = navigationStateRef.current;
    commitNavigation(update(current), { history });
  }, [commitNavigation]);

  const switchTab = useCallback(
    (tab: TabKey) => {
      clearBackHint();
      const current = navigationStateRef.current;
      if (current.activeTab === tab) {
        return;
      }
      commitNavigation({ ...current, activeTab: tab });
    },
    [clearBackHint, commitNavigation],
  );

  const openMoreSubRoute = useCallback(
    (subRoute: MoreSubRoute) => {
      clearBackHint();
      const current = navigationStateRef.current;
      if (current.activeTab === "more" && current.tabMemory.more.subRoute === subRoute && !current.tabMemory.more.recordId) {
        return;
      }
      const nextMemory: TabMemory = {
        ...current.tabMemory,
        more: {
          ...current.tabMemory.more,
          subRoute,
          recordId: undefined,
          highlightAssetId: undefined,
          recordEditing: undefined,
          referenceStack: [],
          restoreScrollY: undefined,
        },
      };
      commitNavigation({ ...current, activeTab: "more", tabMemory: nextMemory });
    },
    [clearBackHint, commitNavigation],
  );

  const dismissDesktopMigration = useCallback(() => {
    localStorage.setItem(DESKTOP_MIGRATION_SEEN_KEY, "1");
    setDesktopMigrationOpen(false);
  }, []);

  const openDesktopMigration = useCallback(() => {
    dismissDesktopMigration();
    openMoreSubRoute("backup");
  }, [dismissDesktopMigration, openMoreSubRoute]);

  const openRecordInTab = useCallback(
    (record: RecordBlock, tab: TabKey, assetId?: string, editing = false) => {
      clearBackHint();
      const current = navigationStateRef.current;
      const nextMemory: TabMemory = {
        ...current.tabMemory,
        [tab]: {
          ...current.tabMemory[tab],
          recordId: record.id,
          highlightAssetId: assetId,
          recordEditing: editing,
          referenceStack: [],
          restoreScrollY: undefined,
        },
      };
      commitNavigation({ ...current, activeTab: tab, tabMemory: nextMemory });
    },
    [clearBackHint, commitNavigation],
  );

  const popCurrentTabDepth = useCallback(() => {
    const current = navigationStateRef.current;
    const sessionId = webNavigationSessionRef.current;
    if (!Capacitor.isNativePlatform() && !isDesktopPlatform() && sessionId && isCurrentWebNavigationSession(window.history.state, sessionId)) {
      window.history.back();
      return;
    }
    const nextMemory = popTabDepth(current.tabMemory, current.activeTab);
    if (nextMemory !== current.tabMemory) {
      commitNavigation({ ...current, tabMemory: nextMemory }, { history: "none" });
    }
  }, [commitNavigation]);

  const closeRecordInCurrentTab = popCurrentTabDepth;

  const setCurrentRecordEditing = useCallback((recordEditing: boolean) => {
    updateNavigationState((current) => ({
      ...current,
      tabMemory: {
        ...current.tabMemory,
        [current.activeTab]: {
          ...current.tabMemory[current.activeTab],
        recordEditing,
      },
      },
    }));
  }, [updateNavigationState]);

  useEffect(() => {
    if (!app.settings) {
      return;
    }
    document.documentElement.style.setProperty("--font-scale", String(app.settings.fontScale));
    document.documentElement.style.setProperty("--reading-line-height", String(app.settings.lineHeight));
    document.documentElement.dataset.theme = app.settings.theme;
  }, [app.settings]);

  useEffect(() => {
    if (!app.initialized || !isDesktopPlatform() || localStorage.getItem(DESKTOP_MIGRATION_SEEN_KEY)) {
      return;
    }
    const hasActiveRecord = app.blocks.some((block) => block.type === "record" && !block.deletedAt);
    if (!hasActiveRecord) {
      setDesktopMigrationOpen(true);
    }
  }, [app.blocks, app.initialized]);

  useEffect(() => {
    if (!app.initialized || Capacitor.isNativePlatform() || isDesktopPlatform()) {
      return undefined;
    }

    const sessionId = createWebNavigationSessionId();
    webNavigationSessionRef.current = sessionId;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const initial = navigationStateRef.current;
    window.history.replaceState(
      createWebNavigationSnapshot(sessionId, initial.activeTab, initial.tabMemory, initial.activeAiSessionId, window.scrollY),
      "",
    );

    const onPopState = (event: PopStateEvent) => {
      const snapshot = restoreWebNavigationSnapshot(event.state);
      if (!snapshot || snapshot.sessionId !== sessionId) {
        return;
      }

      clearBackHint();
      navigationStateRef.current = {
        activeTab: snapshot.activeTab,
        tabMemory: snapshot.tabMemory,
        activeAiSessionId: snapshot.activeAiSessionId,
      };
      setActiveTab(snapshot.activeTab);
      setTabMemory(snapshot.tabMemory);
      setActiveAiSessionId(snapshot.activeAiSessionId);

      if (historyScrollRestoreRef.current) {
        window.cancelAnimationFrame(historyScrollRestoreRef.current);
      }
      historyScrollRestoreRef.current = window.requestAnimationFrame(() => {
        historyScrollRestoreRef.current = window.requestAnimationFrame(() => {
          window.scrollTo(0, snapshot.scrollY);
          historyScrollRestoreRef.current = 0;
        });
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (historyScrollRestoreRef.current) {
        window.cancelAnimationFrame(historyScrollRestoreRef.current);
        historyScrollRestoreRef.current = 0;
      }
      window.history.scrollRestoration = previousScrollRestoration;
      webNavigationSessionRef.current = null;
    };
  }, [app.initialized, clearBackHint]);

  useEffect(() => {
    if (!app.initialized || !isDesktopPlatform()) {
      return undefined;
    }
    return window.studyJournalDesktop?.onBackupFlushRequested(async () => {
      await flushDesktopPendingChanges();
      await onAppBackgroundAutoBackup();
      await app.refresh();
    });
  }, [app.initialized, app.refresh]);

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
  const referenceRecords = useMemo(
    () => app.blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt),
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

  const openRecordReference = (recordId: string) => {
    const target = referenceRecords.find((record) => record.id === recordId);
    if (!target) {
      setBackToast("该日志已删除，无法打开预览");
      return;
    }

    const current = navigationStateRef.current;
    const state = getRecordState(current.activeTab, current.tabMemory);
    const openError = recordReferenceOpenError(state, recordId);
    if (openError === "cycle") {
      setBackToast("检测到循环引用，已停止打开");
      return;
    }
    if (openError === "depth") {
      setBackToast(`引用层级最多 ${MAX_RECORD_REFERENCE_DEPTH} 层`);
      return;
    }
    if (openError) {
      return;
    }

    clearBackHint();
    const scrollY = window.scrollY;
    const currentStack = state.referenceStack ?? [];
    const nextMemory: TabMemory = {
      ...current.tabMemory,
      [current.activeTab]: {
        ...state,
        recordId,
        highlightAssetId: undefined,
        recordEditing: false,
        referenceStack: [
          ...currentStack,
          {
            kind: "record",
            recordId: state.recordId,
            highlightAssetId: state.highlightAssetId,
            recordEditing: state.recordEditing,
            scrollY,
          },
        ],
        restoreScrollY: undefined,
      },
    };
    commitNavigation({ ...current, tabMemory: nextMemory }, { scrollToTop: true });
  };

  const openReviewQueueRecordReference = (sourceRecordId: string, recordId: string) => {
    const target = referenceRecords.find((record) => record.id === recordId);
    if (!target) {
      setBackToast("该日志已删除，无法打开预览");
      return;
    }

    const current = navigationStateRef.current;
    const openError = reviewQueueReferenceOpenError(current.tabMemory.review, sourceRecordId, recordId);
    if (openError === "cycle") {
      setBackToast("检测到循环引用，已停止打开");
      return;
    }
    if (openError === "depth") {
      setBackToast(`引用层级最多 ${MAX_RECORD_REFERENCE_DEPTH} 层`);
      return;
    }
    if (openError) {
      return;
    }

    clearBackHint();
    const scrollY = window.scrollY;
    const currentReview = current.tabMemory.review;
    const nextMemory: TabMemory = {
      ...current.tabMemory,
      review: {
        ...currentReview,
        recordId,
        highlightAssetId: undefined,
        recordEditing: false,
        referenceStack: [
          ...(currentReview.referenceStack ?? []),
          { kind: "review-queue", sourceRecordId, scrollY },
        ],
        restoreScrollY: undefined,
      },
    };
    commitNavigation({ ...current, tabMemory: nextMemory }, { scrollToTop: true });
  };

  const openAiForDate = async (date: string) => {
    const attachment = await buildDayLogAiContextAsync(date, app.blocks, app.assets);
    const session = await createAiSessionForDate(date, attachment);
    if (session) {
      updateNavigationState((current) => ({ ...current, activeAiSessionId: session.id }));
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
      referenceRecords={referenceRecords}
      onOpenRecordReference={openRecordReference}
      restoreScrollY={currentRecordState.restoreScrollY}
      onGetDraft={app.getRecordDraft}
      onSaveDraft={app.saveRecordDraft}
      onDeleteDraft={app.deleteRecordDraft}
      reviewState={recordReviewsByRecord[record.id]}
      reviewLogs={reviewLogsByRecord[record.id] ?? []}
      onAddToReview={async (recordId) => {
        await app.addRecordToReview(recordId);
      }}
      onSetReviewKind={async (recordId, kind) => {
        await app.setRecordReviewKind(recordId, kind);
      }}
      onResetReview={async (recordId) => {
        await app.resetRecordReview(recordId);
      }}
      onRemoveReview={async (recordId) => {
        await app.removeRecordFromReview(recordId);
      }}
      onExportRecord={(recordId) => exportRecordTransferPackage(storage, [recordId])}
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
            onSelectedSubjectChange={(selectedSubject) => {
              const current = navigationStateRef.current;
              if (!selectedSubject && current.tabMemory.more.recordingsState.selectedSubject) {
                popCurrentTabDepth();
                return;
              }
              if (current.tabMemory.more.recordingsState.selectedSubject === selectedSubject) {
                return;
              }
              commitNavigation({
                ...current,
                tabMemory: {
                  ...current.tabMemory,
                  more: {
                    ...current.tabMemory.more,
                    recordingsState: { ...current.tabMemory.more.recordingsState, selectedSubject },
                  },
                },
              });
            }}
            onPlayerChange={(playerAssetId) => {
              const current = navigationStateRef.current;
              if (!playerAssetId && current.tabMemory.more.recordingsState.playerAssetId) {
                popCurrentTabDepth();
                return;
              }
              if (current.tabMemory.more.recordingsState.playerAssetId === playerAssetId) {
                return;
              }
              commitNavigation({
                ...current,
                tabMemory: {
                  ...current.tabMemory,
                  more: {
                    ...current.tabMemory.more,
                    recordingsState: { ...current.tabMemory.more.recordingsState, playerAssetId },
                  },
                },
              });
            }}
            onQueryChange={(query) =>
              updateNavigationState((current) => ({
                ...current,
                tabMemory: {
                  ...current.tabMemory,
                  more: {
                    ...current.tabMemory.more,
                    recordingsState: { ...current.tabMemory.more.recordingsState, query },
                  },
                },
              }))
            }
            onSearchOpenChange={(searchOpen) => {
              const current = navigationStateRef.current;
              if (!searchOpen && current.tabMemory.more.recordingsState.searchOpen) {
                popCurrentTabDepth();
                return;
              }
              if (current.tabMemory.more.recordingsState.searchOpen === searchOpen) {
                return;
              }
              commitNavigation({
                ...current,
                tabMemory: {
                  ...current.tabMemory,
                  more: {
                    ...current.tabMemory.more,
                    recordingsState: { ...current.tabMemory.more.recordingsState, searchOpen },
                  },
                },
              });
            }}
            onBack={popCurrentTabDepth}
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
            onOpenBackup={() => openMoreSubRoute("backup")}
            onOpenAiTools={() => openMoreSubRoute("aiTools")}
            onOpenOcrSettings={() => openMoreSubRoute("ocrSettings")}
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
            reviewLogsByRecord={reviewLogsByRecord}
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
              updateNavigationState((current) => ({ ...current, activeAiSessionId: sessionId }));
              openMoreSubRoute("ai");
            }}
            onDeletedSession={() => {
              updateNavigationState((current) => ({ ...current, activeAiSessionId: null }));
              openMoreSubRoute("ai");
            }}
            onOpenSettings={() => openMoreSubRoute("aiTools")}
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
            reviewLogsByRecord={reviewLogsByRecord}
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
              updateNavigationState((current) => ({
                ...current,
                tabMemory: { ...current.tabMemory, journal: { ...current.tabMemory.journal, searchQuery } },
              }))
            }
            onBack={popCurrentTabDepth}
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
              updateNavigationState((current) => ({
                ...current,
                tabMemory: { ...current.tabMemory, journal: { ...current.tabMemory.journal, month } },
              }))
            }
            onSelectedDateChange={(selectedDate) => {
              const current = navigationStateRef.current;
              if (!selectedDate && current.tabMemory.journal.selectedDate) {
                popCurrentTabDepth();
                return;
              }
              if (current.tabMemory.journal.selectedDate === selectedDate) {
                return;
              }
              commitNavigation({
                ...current,
                tabMemory: {
                  ...current.tabMemory,
                  journal: { ...current.tabMemory.journal, selectedDate, selectedSubject: undefined },
                },
              });
            }}
            onSelectedSubjectChange={(selectedSubject) => {
              const current = navigationStateRef.current;
              if (!selectedSubject && current.tabMemory.journal.selectedSubject) {
                popCurrentTabDepth();
                return;
              }
              if (current.tabMemory.journal.selectedSubject === selectedSubject) {
                return;
              }
              commitNavigation({
                ...current,
                tabMemory: {
                  ...current.tabMemory,
                  journal: { ...current.tabMemory.journal, selectedSubject },
                },
              });
            }}
            onOpenRecord={(record) => openRecordInTab(record, "journal")}
            onOpenSearch={() => {
              const current = navigationStateRef.current;
              if (!current.tabMemory.journal.searchOpen) {
                commitNavigation({
                  ...current,
                  tabMemory: { ...current.tabMemory, journal: { ...current.tabMemory.journal, searchOpen: true } },
                });
              }
            }}
            onAskAi={(date) => void openAiForDate(date)}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
            reviewStatesByRecord={recordReviewsByRecord}
            reviewLogsByRecord={reviewLogsByRecord}
            onAddToReview={(recordId) => void app.addRecordToReview(recordId)}
            onAddManyToReview={async (recordIds) => {
              const result = await app.addRecordsToReview(recordIds);
              return `成功加入 ${result.added} 条，重置 ${result.reset} 条，跳过 ${result.skippedActive} 条已在复习中的记录。`;
            }}
            onExportRecords={(recordIds) => exportRecordTransferPackage(storage, recordIds)}
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
            onActiveSubjectChange={(activeSubject) => {
              const current = navigationStateRef.current;
              if (!activeSubject && current.tabMemory.categories.activeSubject) {
                popCurrentTabDepth();
                return;
              }
              if (current.tabMemory.categories.activeSubject === activeSubject) {
                return;
              }
              commitNavigation({
                ...current,
                tabMemory: { ...current.tabMemory, categories: { ...current.tabMemory.categories, activeSubject } },
              });
            }}
            onManagingChange={(managing) => {
              const current = navigationStateRef.current;
              if (!managing && current.tabMemory.categories.managing) {
                popCurrentTabDepth();
                return;
              }
              if (current.tabMemory.categories.managing === managing) {
                return;
              }
              commitNavigation({
                ...current,
                tabMemory: { ...current.tabMemory, categories: { ...current.tabMemory.categories, managing } },
              });
            }}
            onOpenRecord={(record) => openRecordInTab(record, "categories")}
            onAskAi={(date) => void openAiForDate(date)}
            onAddSubject={app.addSubject}
            onRenameSubject={app.renameSubject}
            onSaveSubjects={app.saveSubjects}
            onToggleFavorite={(record, favorite) => void app.toggleRecordFavorite(record.id, favorite)}
            reviewStatesByRecord={recordReviewsByRecord}
            reviewLogsByRecord={reviewLogsByRecord}
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
            reviewLogsByRecord={reviewLogsByRecord}
            stats={app.recordReviewStats}
            mode={tabMemory.review.mode}
            queueIds={tabMemory.review.queueIds}
            currentRecordId={tabMemory.review.currentRecordId}
            onModeChange={(mode) =>
              updateNavigationState((current) =>
                current.tabMemory.review.mode === mode
                  ? current
                  : {
                    ...current,
                    tabMemory: { ...current.tabMemory, review: { ...current.tabMemory.review, mode } },
                  },
              )
            }
            onQueueChange={(queueIds) =>
              updateNavigationState((current) =>
                sameIds(current.tabMemory.review.queueIds, queueIds)
                  ? current
                  : {
                    ...current,
                    tabMemory: { ...current.tabMemory, review: { ...current.tabMemory.review, queueIds } },
                  },
              )
            }
            onCurrentRecordChange={(currentRecordId) =>
              updateNavigationState((current) =>
                current.tabMemory.review.currentRecordId === currentRecordId
                  ? current
                  : {
                    ...current,
                    tabMemory: { ...current.tabMemory, review: { ...current.tabMemory.review, currentRecordId } },
                  },
              )
            }
            onEnsureDay={app.ensureRecordReviewDay}
            referenceRecords={referenceRecords}
            referenceSubjects={app.subjects}
            onOpenRecordReference={openReviewQueueRecordReference}
            restoreScrollY={tabMemory.review.restoreScrollY}
            onRate={async (recordId, rating, evaluationText) => {
              const result = await app.rateRecordReview(recordId, rating, evaluationText);
              return result?.undoToken;
            }}
            onUndo={async (token) => {
              await app.undoRecordReview(token);
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

  const pageKey = buildTabPageKey(activeTab, tabMemory, activeAiSessionId);

  const shellClassName = [
    "app-shell",
    isDesktopPlatform() ? "desktop-app" : "",
    keyboardVisible ? "keyboard-open" : "",
    activeTab === "more" && tabMemory.more.subRoute === "ai" ? "ai-chat-active" : "",
  ].filter(Boolean).join(" ");
  const showWebNavigationBack = !Capacitor.isNativePlatform()
    && getTabDepth(activeTab, tabMemory) > 0
    && !currentRecord
    && !(activeTab === "journal" && tabMemory.journal.searchOpen)
    && !(activeTab === "journal" && tabMemory.journal.selectedSubject)
    && !(activeTab === "categories" && (tabMemory.categories.activeSubject || tabMemory.categories.managing))
    && !(activeTab === "more" && tabMemory.more.subRoute === "recordings");

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
        {showWebNavigationBack && (
          <div className="web-navigation-back-row">
            <button type="button" className="secondary-button web-navigation-back" onClick={popCurrentTabDepth}>
              <ArrowLeft size={18} />
              返回
            </button>
          </div>
        )}
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
      {desktopMigrationOpen && (
        <div className="desktop-migration-backdrop" role="presentation">
          <section className="desktop-migration-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-migration-title">
            <p className="eyebrow">Desktop Migration</p>
            <h2 id="desktop-migration-title">从 Web 端迁移日志</h2>
            <p>桌面版拥有独立本地数据库。请先在原 Web 地址导出完整备份或日志互通包，再在这里导入。</p>
            <div className="desktop-migration-actions">
              <button type="button" className="primary-button" onClick={openDesktopMigration}>打开导入页面</button>
              <button type="button" className="secondary-button" onClick={dismissDesktopMigration}>稍后处理</button>
            </div>
          </section>
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
