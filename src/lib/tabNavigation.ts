import type { EntityId, Subject } from "../types";

export type TabKey = "today" | "journal" | "categories" | "recordings" | "more";
export type MoreSubRoute = "stats" | "settings" | "ai" | "favorites" | "trash" | "backup" | "aiTools" | null;

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
  recordings: RecordTabState & {
    selectedSubject?: Subject;
    playerAssetId?: EntityId;
    query: string;
    searchOpen: boolean;
  };
  more: RecordTabState & {
    subRoute: MoreSubRoute;
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
  recordings: {
    query: "",
    searchOpen: false,
  },
  more: {
    subRoute: null,
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
    case "recordings":
      return memory.recordings.playerAssetId ? 2 : memory.recordings.searchOpen || memory.recordings.selectedSubject ? 1 : 0;
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
    case "recordings":
      return memory.recordings;
    case "more":
      return memory.more;
  }
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
    case "recordings":
      if (memory.recordings.playerAssetId) {
        return {
          ...memory,
          recordings: { ...memory.recordings, playerAssetId: undefined },
        };
      }
      if (memory.recordings.searchOpen) {
        return {
          ...memory,
          recordings: { ...memory.recordings, searchOpen: false },
        };
      }
      return {
        ...memory,
        recordings: {
          ...memory.recordings,
          selectedSubject: undefined,
          recordId: undefined,
          highlightAssetId: undefined,
          recordEditing: undefined,
        },
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
