const { contextBridge, ipcRenderer } = require("electron");

const backupFlushListeners = new Set();

ipcRenderer.on("study-journal:backup-flush-request", async (_event, payload) => {
  await Promise.allSettled(Array.from(backupFlushListeners).map((listener) => listener(payload.reason)));
  ipcRenderer.send("study-journal:backup-flush-complete", payload.requestId);
});

contextBridge.exposeInMainWorld("studyJournalDesktop", Object.freeze({
  isDesktop: true,
  backup: Object.freeze({
    bindFolder: () => ipcRenderer.invoke("study-journal:desktop-backup-bind"),
    getStatus: () => ipcRenderer.invoke("study-journal:desktop-backup-status"),
    ensureRepository: () => ipcRenderer.invoke("study-journal:desktop-backup-ensure"),
    listFiles: (directory) => ipcRenderer.invoke("study-journal:desktop-backup-list", directory),
    beginWrite: (path) => ipcRenderer.invoke("study-journal:desktop-backup-begin-write", path),
    appendWrite: (sessionId, data) => ipcRenderer.invoke("study-journal:desktop-backup-append-write", sessionId, data),
    finishWrite: (sessionId) => ipcRenderer.invoke("study-journal:desktop-backup-finish-write", sessionId),
    cancelWrite: (sessionId) => ipcRenderer.invoke("study-journal:desktop-backup-cancel-write", sessionId),
    readText: (path) => ipcRenderer.invoke("study-journal:desktop-backup-read-text", path),
    readChunk: (path, offset, length) => ipcRenderer.invoke("study-journal:desktop-backup-read-chunk", path, offset, length),
    deleteFile: (path) => ipcRenderer.invoke("study-journal:desktop-backup-delete", path),
  }),
  onBackupFlushRequested: (listener) => {
    backupFlushListeners.add(listener);
    return () => backupFlushListeners.delete(listener);
  },
}));
