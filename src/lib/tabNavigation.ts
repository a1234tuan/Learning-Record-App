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

export type RecordTabState = {
  recordId?: string;
  highlightAssetId?: string;
  recordEditing?: boolean;
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

export const getTabDepth = (tab: TabKey, memory: TabMemory): number => {
  switch (tab) {
    case "today":
      return memory.today.recordId ? 1 : 0;
    case "journal":
      return memory.journal.recordId ? 2 : memory.journal.searchOpen || memory.journal.selectedDate ? 1 : 0;
    case "categories":
      return memory.categories.recordId ? 2 : memory.categories.activeSubject || memory.categories.managing ? 1 : 0;
    case "review":
      return memory.review.recordId ? 1 : 0;
    case "more":
      return memory.more.recordId ? 2 : memory.more.subRoute ? 1 : 0;
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
      return {
        ...memory,
        today: { ...memory.today, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined },
      };
    case "journal":
      if (memory.journal.recordId) {
        return {
          ...memory,
          journal: { ...memory.journal, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined },
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
        return {
          ...memory,
          categories: { ...memory.categories, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined },
        };
      }
      return {
        ...memory,
        categories: { ...memory.categories, activeSubject: null, managing: false },
      };
    case "review":
      return {
        ...memory,
        review: { ...memory.review, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined },
      };
    case "more":
      if (memory.more.recordId) {
        return {
          ...memory,
          more: { ...memory.more, recordId: undefined, highlightAssetId: undefined, recordEditing: undefined },
        };
      }
      return {
        ...memory,
        more: { ...memory.more, subRoute: null },
      };
  }
};
