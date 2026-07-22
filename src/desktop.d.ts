export {};

declare global {
  interface StudyJournalDesktopBackupFile {
    path: string;
    displayName: string;
    size: number;
    lastModified?: number;
  }

  interface Window {
    studyJournalDesktop?: Readonly<{
      isDesktop: true;
      backup: Readonly<{
        bindFolder: () => Promise<{ folderName: string }>;
        getStatus: () => Promise<{ bound: boolean; folderName?: string }>;
        ensureRepository: () => Promise<{ folderName?: string; repositoryName: string }>;
        listFiles: (directory: string) => Promise<StudyJournalDesktopBackupFile[]>;
        beginWrite: (path: string) => Promise<{ sessionId: string; path: string }>;
        appendWrite: (sessionId: string, data: string) => Promise<{ size: number }>;
        finishWrite: (sessionId: string) => Promise<{ path: string; displayName: string; size: number; lastModified?: number }>;
        cancelWrite: (sessionId: string) => Promise<void>;
        readText: (path: string) => Promise<{ text: string; size: number }>;
        readChunk: (path: string, offset: number, length: number) => Promise<{ data: string; bytesRead: number; done: boolean }>;
        deleteFile: (path: string) => Promise<void>;
      }>;
      onBackupFlushRequested: (listener: (reason: "minimize" | "close") => Promise<void> | void) => () => void;
    }>;
  }
}
