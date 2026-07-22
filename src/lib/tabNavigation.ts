import type { EntityId, Subject } from "../types";

export type TabKey = "today" | "journal" | "categories" | "review" | "more";
export type MoreSubRoute =
  | "stats"
  | "settings"
  | "ai"
  | "favorites"
  | "trash"
  | "backup"
  | "aiTools"
  | "ocrSettings"
  | "recordings"
  | "guide"
  | null;
export type ReviewMode = "queue" | "manage";

export const MAX_RECORD_REFERENCE_DEPTH = 8;

export type RecordReferenceNavigationEntry =
  | {
    kind: "record";
    recordId: string;
    highlightAssetId?: string;
    recordEditing?: boolean;
    scrollY: number;
  }
  | {
    kind: "review-queue";
    sourceRecordId: string;
    scrollY: number;
  };

export type RecordTabState = {
  recordId?: string;
  highlightAssetId?: string;
  recordEditing?: boolean;
  referenceStack?: RecordReferenceNavigationEntry[];
  restoreScrollY?: number;
};

export type TabMemory = {
  today: RecordTabState;
  journal: RecordTabState & {
    month: Date;
    selectedDate?: string;
    selectedSubject?: Subject;
    searchOpen: boolean;
    searchQuery: string;
  };
  categories: RecordTabState & {
    activeSubject: Subject | null;
    managing: boolean;
  };
  review: RecordTabState & {
    mode: ReviewMode;
    queueIds: EntityId[];
    currentRecordId?: EntityId;
  };
  more: RecordTabState & {
    subRoute: MoreSubRoute;
    recordingsState: {
      selectedSubject?: Subject;
      playerAssetId?: EntityId;
      query: string;
      searchOpen: boolean;
    };
  };
};

export const createInitialTabMemory = (): TabMemory => ({
  today: {},
  journal: {
    month: new Date(),
    searchOpen: false,
    searchQuery: "",
  },
  categories: {
    activeSubject: null,
    managing: false,
  },
  review: {
    mode: "queue",
    queueIds: [],
  },
  more: {
    subRoute: null,
    recordingsState: {
      query: "",
      searchOpen: false,
    },
  },
});

const referenceDepth = (state: RecordTabState): number => state.referenceStack?.length ?? 0;

const referenceEntryRecordId = (entry: RecordReferenceNavigationEntry): string =>
  entry.kind === "record" ? entry.recordId : entry.sourceRecordId;

const referenceOpenError = (
  sourceRecordId: string | undefined,
  stack: readonly RecordReferenceNavigationEntry[],
  targetRecordId: string,
  maxDepth: number,
): "missing-source" | "cycle" | "depth" | undefined => {
  if (!sourceRecordId) {
    return "missing-source";
  }
  if ([sourceRecordId, ...stack.map(referenceEntryRecordId)].includes(targetRecordId)) {
    return "cycle";
  }
  return stack.length >= maxDepth ? "depth" : undefined;
};

export const recordReferenceOpenError = (
  state: RecordTabState,
  targetRecordId: string,
  maxDepth = MAX_RECORD_REFERENCE_DEPTH,
): "missing-source" | "cycle" | "depth" | undefined => {
  return referenceOpenError(state.recordId, state.referenceStack ?? [], targetRecordId, maxDepth);
};

export const reviewQueueReferenceOpenError = (
  state: RecordTabState,
  sourceRecordId: string,
  targetRecordId: string,
  maxDepth = MAX_RECORD_REFERENCE_DEPTH,
): "missing-source" | "cycle" | "depth" | undefined =>
  referenceOpenError(sourceRecordId, state.referenceStack ?? [], targetRecordId, maxDepth);

const popRecordReference = <T extends RecordTabState>(state: T): T | undefined => {
  const stack = state.referenceStack ?? [];
  const previous = stack.at(-1);
  if (!previous) {
    return undefined;
  }
  if (previous.kind === "review-queue") {
    return {
      ...state,
      recordId: undefined,
      highlightAssetId: undefined,
      recordEditing: undefined,
      referenceStack: stack.slice(0, -1),
      restoreScrollY: previous.scrollY,
    };
  }
  return {
    ...state,
    recordId: previous.recordId,
    highlightAssetId: previous.highlightAssetId,
    recordEditing: previous.recordEditing,
    referenceStack: stack.slice(0, -1),
    restoreScrollY: previous.scrollY,
  };
};

export const getTabDepth = (tab: TabKey, memory: TabMemory): number => {
  switch (tab) {
    case "today":
      return memory.today.recordId ? 1 + referenceDepth(memory.today) : 0;
    case "journal":
      return memory.journal.recordId ? 2 + referenceDepth(memory.journal) : memory.journal.searchOpen || memory.journal.selectedDate ? 1 : 0;
    case "categories":
      return memory.categories.recordId ? 2 + referenceDepth(memory.categories) : memory.categories.activeSubject || memory.categories.managing ? 1 : 0;
    case "review":
      return memory.review.recordId ? 1 + referenceDepth(memory.review) : 0;
    case "more":
      if (memory.more.recordId) {
        return 2 + referenceDepth(memory.more);
      }
      if (memory.more.subRoute !== "recordings") {
        return memory.more.subRoute ? 1 : 0;
      }
      if (memory.more.recordingsState.playerAssetId) {
        return 3;
      }
      if (memory.more.recordingsState.selectedSubject || memory.more.recordingsState.searchOpen) {
        return 2;
      }
      return 1;
  }
};

export const getRecordState = (tab: TabKey, memory: TabMemory): RecordTabState => {
  switch (tab) {
    case "today":
      return memory.today;
    case "journal":
      return memory.journal;
    case "categories":
      return memory.categories;
    case "review":
      return memory.review;
    case "more":
      return memory.more;
  }
};

export const buildTabPageKey = (tab: TabKey, memory: TabMemory, activeAiSessionId: string | null = null): string => {
  const depth = getTabDepth(tab, memory);
  const recordPart = getRecordState(tab, memory).recordId ?? "root";
  if (tab === "journal") {
    return `${tab}-${depth}-${recordPart}-${memory.journal.searchOpen ? "search" : "browse"}`;
  }
  if (tab === "categories") {
    return `${tab}-${depth}-${recordPart}-${memory.categories.managing ? "manage" : memory.categories.activeSubject ?? "all"}`;
  }
  if (tab === "review") {
    return `${tab}-${depth}-${recordPart}-${memory.review.mode}`;
  }
  if (tab === "more") {
    return `${tab}-${depth}-${recordPart}-${memory.more.subRoute ?? "root"}-${activeAiSessionId ?? "none"}`;
  }
  return `${tab}-${depth}-${recordPart}`;
};

export const popTabDepth = (memory: TabMemory, tab: TabKey): TabMemory => {
  switch (tab) {
    case "today":
      {
        const previous = popRecordReference(memory.today);
        if (previous) {
          return { ...memory, today: previous };
        }
      }
      return {
        ...memory,
        today: { ...memory.today, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined, referenceStack: [], restoreScrollY: undefined },
      };
    case "journal":
      if (memory.journal.recordId) {
        const previous = popRecordReference(memory.journal);
        if (previous) {
          return { ...memory, journal: previous };
        }
        return {
          ...memory,
          journal: { ...memory.journal, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined, referenceStack: [], restoreScrollY: undefined },
        };
      }
      if (memory.journal.searchOpen) {
        return {
          ...memory,
          journal: { ...memory.journal, searchOpen: false },
        };
      }
      if (memory.journal.selectedSubject) {
        return {
          ...memory,
          journal: { ...memory.journal, selectedSubject: undefined },
        };
      }
      return {
        ...memory,
        journal: { ...memory.journal, selectedDate: undefined, selectedSubject: undefined },
      };
    case "categories":
      if (memory.categories.recordId) {
        const previous = popRecordReference(memory.categories);
        if (previous) {
          return { ...memory, categories: previous };
        }
        return {
          ...memory,
          categories: { ...memory.categories, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined, referenceStack: [], restoreScrollY: undefined },
        };
      }
      return {
        ...memory,
        categories: { ...memory.categories, activeSubject: null, managing: false },
      };
    case "review":
      {
        const previous = popRecordReference(memory.review);
        if (previous) {
          return { ...memory, review: previous };
        }
      }
      return {
        ...memory,
        review: { ...memory.review, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined, referenceStack: [], restoreScrollY: undefined },
      };
    case "more":
      if (memory.more.recordId) {
        const previous = popRecordReference(memory.more);
        if (previous) {
          return { ...memory, more: previous };
        }
        return {
          ...memory,
          more: { ...memory.more, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined, referenceStack: [], restoreScrollY: undefined },
        };
      }
      if (memory.more.subRoute === "recordings") {
        if (memory.more.recordingsState.playerAssetId) {
          return {
            ...memory,
            more: {
              ...memory.more,
              recordingsState: { ...memory.more.recordingsState, playerAssetId: undefined },
            },
          };
        }
        if (memory.more.recordingsState.selectedSubject) {
          return {
            ...memory,
            more: {
              ...memory.more,
              recordingsState: { ...memory.more.recordingsState, selectedSubject: undefined },
            },
          };
        }
        if (memory.more.recordingsState.searchOpen) {
          return {
            ...memory,
            more: {
              ...memory.more,
              recordingsState: { ...memory.more.recordingsState, searchOpen: false },
            },
          };
        }
      }
      return {
        ...memory,
        more: { ...memory.more, subRoute: null },
      };
  }
};
