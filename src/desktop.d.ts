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
      auth: Readonly<{
        signInWithGoogle: () => Promise<{ idToken: string }>;
      }>;
      ocr: Readonly<{
        recognize: (options: {
          data: string;
          fileName: string;
          mimeType: string;
          token: string;
        }) => Promise<{ jobId?: string; text: string }>;
      }>;
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
      tts: Readonly<{
        synthesize: (options: {
          providerId: string;
          apiKey: string;
          apiKeySecondary?: string;
          model: string;
          voiceId: string;
          text: string;
          format: "mp3";
          region?: string;
          languageCode?: string;
        }) => Promise<{ data: string; mimeType?: string }>;
      }>;
      proxy: Readonly<{
        getProxy: () => Promise<{ proxyUrl: string }>;
        setProxy: (proxyUrl: string) => Promise<{ proxyUrl: string }>;
      }>;
      onBackupFlushRequested: (listener: (reason: "minimize" | "close") => Promise<void> | void) => () => void;
    }>;
  }
}
