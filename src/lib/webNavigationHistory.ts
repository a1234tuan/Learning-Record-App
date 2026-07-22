import { createInitialTabMemory, type MoreSubRoute, type RecordReferenceNavigationEntry, type TabKey, type TabMemory } from "./tabNavigation";

const HISTORY_KIND = "study-journal-web-navigation";
const HISTORY_VERSION = 1;

type SerializedTabMemory = Omit<TabMemory, "journal"> & {
  journal: Omit<TabMemory["journal"], "month"> & { month: string };
};

export type WebNavigationSnapshot = {
  kind: typeof HISTORY_KIND;
  version: typeof HISTORY_VERSION;
  sessionId: string;
  activeTab: TabKey;
  tabMemory: SerializedTabMemory;
  activeAiSessionId: string | null;
  scrollY: number;
};

export type RestoredWebNavigationSnapshot = Omit<WebNavigationSnapshot, "tabMemory"> & {
  tabMemory: TabMemory;
};

const TAB_KEYS: readonly TabKey[] = ["today", "journal", "categories", "review", "more"];
const MORE_SUB_ROUTES: readonly MoreSubRoute[] = [
  "stats",
  "settings",
  "ai",
  "favorites",
  "trash",
  "backup",
  "aiTools",
  "ocrSettings",
  "recordings",
  "guide",
  null,
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const optionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const optionalScrollY = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const cloneReferenceStack = (value: unknown): RecordReferenceNavigationEntry[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries: RecordReferenceNavigationEntry[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.scrollY !== "number" || !Number.isFinite(item.scrollY) || item.scrollY < 0) {
      return undefined;
    }
    if (item.kind === "record" && typeof item.recordId === "string") {
      entries.push({
        kind: "record",
        recordId: item.recordId,
        highlightAssetId: optionalString(item.highlightAssetId),
        recordEditing: optionalBoolean(item.recordEditing),
        scrollY: item.scrollY,
      });
      continue;
    }
    if (item.kind === "review-queue" && typeof item.sourceRecordId === "string") {
      entries.push({ kind: "review-queue", sourceRecordId: item.sourceRecordId, scrollY: item.scrollY });
      continue;
    }
    return undefined;
  }
  return entries;
};

const restoreRecordState = <T extends TabMemory[TabKey]>(value: unknown, fallback: T): T | null => {
  if (!isObject(value)) {
    return null;
  }
  const referenceStack = cloneReferenceStack(value.referenceStack);
  if (value.referenceStack !== undefined && !referenceStack) {
    return null;
  }
  return {
    ...fallback,
    recordId: optionalString(value.recordId),
    highlightAssetId: optionalString(value.highlightAssetId),
    recordEditing: optionalBoolean(value.recordEditing),
    referenceStack,
    restoreScrollY: optionalScrollY(value.restoreScrollY),
  };
};

const serialiseTabMemory = (memory: TabMemory): SerializedTabMemory => ({
  ...memory,
  journal: {
    ...memory.journal,
    month: memory.journal.month.toISOString(),
  },
});

const restoreTabMemory = (value: unknown): TabMemory | null => {
  if (!isObject(value) || !isObject(value.journal) || !isObject(value.categories) || !isObject(value.review) || !isObject(value.more)) {
    return null;
  }

  const defaults = createInitialTabMemory();
  const today = restoreRecordState(value.today ?? {}, defaults.today);
  const journalBase = restoreRecordState(value.journal, defaults.journal);
  const categoriesBase = restoreRecordState(value.categories, defaults.categories);
  const reviewBase = restoreRecordState(value.review, defaults.review);
  const moreBase = restoreRecordState(value.more, defaults.more);
  if (!today || !journalBase || !categoriesBase || !reviewBase || !moreBase || typeof value.journal.month !== "string") {
    return null;
  }

  const month = new Date(value.journal.month);
  if (Number.isNaN(month.getTime())) {
    return null;
  }
  const reviewMode = value.review.mode === "manage" ? "manage" : value.review.mode === "queue" ? "queue" : null;
  const subRoute = MORE_SUB_ROUTES.includes(value.more.subRoute as MoreSubRoute) ? value.more.subRoute as MoreSubRoute : undefined;
  const recordings = value.more.recordingsState;
  if (!reviewMode || subRoute === undefined || !isObject(recordings)) {
    return null;
  }

  const queueIds = Array.isArray(value.review.queueIds) && value.review.queueIds.every((id) => typeof id === "string")
    ? [...value.review.queueIds]
    : null;
  if (!queueIds) {
    return null;
  }

  return {
    today,
    journal: {
      ...journalBase,
      month,
      selectedDate: optionalString(value.journal.selectedDate),
      selectedSubject: optionalString(value.journal.selectedSubject),
      searchOpen: optionalBoolean(value.journal.searchOpen) ?? false,
      searchQuery: optionalString(value.journal.searchQuery) ?? "",
    },
    categories: {
      ...categoriesBase,
      activeSubject: optionalString(value.categories.activeSubject) ?? null,
      managing: optionalBoolean(value.categories.managing) ?? false,
    },
    review: {
      ...reviewBase,
      mode: reviewMode,
      queueIds,
      currentRecordId: optionalString(value.review.currentRecordId),
    },
    more: {
      ...moreBase,
      subRoute,
      recordingsState: {
        selectedSubject: optionalString(recordings.selectedSubject),
        playerAssetId: optionalString(recordings.playerAssetId),
        query: optionalString(recordings.query) ?? "",
        searchOpen: optionalBoolean(recordings.searchOpen) ?? false,
      },
    },
  };
};

export const createWebNavigationSessionId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `web-navigation-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const createWebNavigationSnapshot = (
  sessionId: string,
  activeTab: TabKey,
  tabMemory: TabMemory,
  activeAiSessionId: string | null,
  scrollY: number,
): WebNavigationSnapshot => ({
  kind: HISTORY_KIND,
  version: HISTORY_VERSION,
  sessionId,
  activeTab,
  tabMemory: serialiseTabMemory(tabMemory),
  activeAiSessionId,
  scrollY: Number.isFinite(scrollY) && scrollY >= 0 ? scrollY : 0,
});

export const restoreWebNavigationSnapshot = (value: unknown): RestoredWebNavigationSnapshot | null => {
  if (!isObject(value) || value.kind !== HISTORY_KIND || value.version !== HISTORY_VERSION || typeof value.sessionId !== "string") {
    return null;
  }
  if (!TAB_KEYS.includes(value.activeTab as TabKey) || (value.activeAiSessionId !== null && typeof value.activeAiSessionId !== "string")) {
    return null;
  }
  const tabMemory = restoreTabMemory(value.tabMemory);
  const scrollY = optionalScrollY(value.scrollY);
  if (!tabMemory || scrollY === undefined) {
    return null;
  }
  return {
    kind: HISTORY_KIND,
    version: HISTORY_VERSION,
    sessionId: value.sessionId,
    activeTab: value.activeTab as TabKey,
    tabMemory,
    activeAiSessionId: value.activeAiSessionId,
    scrollY,
  };
};

export const isCurrentWebNavigationSession = (value: unknown, sessionId: string): boolean =>
  restoreWebNavigationSnapshot(value)?.sessionId === sessionId;
