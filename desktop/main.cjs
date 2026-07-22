const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const { cpSync, existsSync, mkdirSync, renameSync } = require("node:fs");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_SCHEME = "study-journal";
const APP_HOST = "app";
const DIST_ROOT = path.resolve(__dirname, "..", "dist");
const APP_ID = "com.noteproject.study408.desktop";
const DESKTOP_ROOT = path.resolve("D:\\StudyJournal");
const DESKTOP_DATA_ROOT = path.join(DESKTOP_ROOT, "Data");
const LEGACY_COPY_EXCLUDED_NAMES = new Set([
  "DevToolsActivePort",
  "LOCK",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
]);
const PROFILE_DATA_ENTRIES = ["IndexedDB", "Local Storage", "WebStorage"];

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setName("学习日志");

let mainWindow;
const desktopBackupWriteSessions = new Map();
const desktopBackupFlushRequests = new Map();
let closeAfterDesktopBackup = false;

const isSamePath = (left, right) => path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();

const hasProfileData = (dataPath) => PROFILE_DATA_ENTRIES.some((entry) => existsSync(path.join(dataPath, entry)));

const findLegacyDesktopDataPath = () => {
  const candidates = [
    DESKTOP_ROOT,
    path.join(app.getPath("appData"), app.getName()),
  ];
  return candidates.find((candidate) => !isSamePath(candidate, DESKTOP_DATA_ROOT) && hasProfileData(candidate));
};

const migrateLegacyDesktopData = () => {
  const legacyDataPath = findLegacyDesktopDataPath();
  if (!legacyDataPath || existsSync(DESKTOP_DATA_ROOT)) {
    return { status: "not-needed" };
  }

  // Electron may already hold its profile lock when this script starts. Locks contain no user data
  // and copying them would make a cross-drive migration fail before the IndexedDB is copied.
  const stagingPath = path.join(
    path.dirname(DESKTOP_ROOT),
    `${path.basename(DESKTOP_ROOT)}.data-migration-${process.pid}`,
  );

  try {
    cpSync(legacyDataPath, stagingPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
      filter: (source) => {
        if (LEGACY_COPY_EXCLUDED_NAMES.has(path.basename(source))) {
          return false;
        }
        const isLegacyDesktopRoot = isSamePath(legacyDataPath, DESKTOP_ROOT);
        return !isLegacyDesktopRoot || path.relative(legacyDataPath, source).split(path.sep)[0] !== "App";
      },
    });
    renameSync(stagingPath, DESKTOP_DATA_ROOT);
    return { status: "migrated", legacyDataPath };
  } catch (error) {
    console.error("Failed to migrate desktop data to D drive", error);
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const configureDesktopDataPaths = () => {
  const migration = migrateLegacyDesktopData();
  if (migration.status === "failed") {
    return { ...migration, usingLegacyDataPath: true };
  }

  try {
    mkdirSync(DESKTOP_DATA_ROOT, { recursive: true });
    app.setPath("userData", DESKTOP_DATA_ROOT);
    app.setPath("sessionData", DESKTOP_DATA_ROOT);
    app.setPath("temp", path.join(DESKTOP_DATA_ROOT, "temp"));
    app.setPath("crashDumps", path.join(DESKTOP_DATA_ROOT, "crash-dumps"));
    app.setAppLogsPath(path.join(DESKTOP_DATA_ROOT, "logs"));
    return migration;
  } catch (error) {
    console.error("Failed to configure D drive desktop data paths", error);
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      usingLegacyDataPath: true,
    };
  }
};

const dataPathSetup = configureDesktopDataPaths();

const DESKTOP_BACKUP_REPOSITORY_NAME = "study-journal-backup";
const DESKTOP_BACKUP_BINDING_FILE = "desktop-auto-backup.json";

const desktopBackupBindingPath = () => path.join(app.getPath("userData"), DESKTOP_BACKUP_BINDING_FILE);

const readDesktopBackupBinding = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(desktopBackupBindingPath(), "utf8"));
    if (!parsed || typeof parsed.folderPath !== "string" || !path.isAbsolute(parsed.folderPath)) {
      return undefined;
    }
    return { folderPath: path.normalize(parsed.folderPath) };
  } catch {
    return undefined;
  }
};

const writeDesktopBackupBinding = async (folderPath) => {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const temporaryPath = `${desktopBackupBindingPath()}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify({ folderPath, updatedAt: new Date().toISOString() }), "utf8");
  await fs.rename(temporaryPath, desktopBackupBindingPath());
};

const safeRepositoryRelativePath = (value) => {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) {
    throw new Error("备份仓库文件路径无效。");
  }
  const normalized = path.normalize(value).replace(/\\/g, "/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("备份仓库文件路径超出绑定目录。");
  }
  return normalized;
};

const isInsideDirectory = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

const resolveDesktopBackupRepositoryRoot = async (create = false) => {
  const binding = await readDesktopBackupBinding();
  if (!binding || !existsSync(binding.folderPath)) {
    throw new Error("尚未绑定有效的自动备份文件夹。");
  }
  const repositoryRoot = path.resolve(binding.folderPath, DESKTOP_BACKUP_REPOSITORY_NAME);
  if (!isInsideDirectory(path.resolve(binding.folderPath), repositoryRoot)) {
    throw new Error("备份仓库路径无效。");
  }
  if (create) {
    await fs.mkdir(repositoryRoot, { recursive: true });
  }
  return { repositoryRoot, folderName: path.basename(binding.folderPath) || binding.folderPath };
};

const resolveDesktopBackupFilePath = async (relativePath, createRepository = false) => {
  const { repositoryRoot, folderName } = await resolveDesktopBackupRepositoryRoot(createRepository);
  const targetPath = path.resolve(repositoryRoot, safeRepositoryRelativePath(relativePath));
  if (!isInsideDirectory(repositoryRoot, targetPath)) {
    throw new Error("备份仓库文件路径超出绑定目录。");
  }
  return { repositoryRoot, targetPath, folderName };
};

const desktopBackupStatus = async () => {
  const binding = await readDesktopBackupBinding();
  if (!binding || !existsSync(binding.folderPath)) {
    return { bound: false };
  }
  return { bound: true, folderName: path.basename(binding.folderPath) || binding.folderPath };
};

const bindDesktopBackupFolder = async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "选择自动备份文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) {
    throw new Error("已取消绑定自动备份文件夹。");
  }
  const selectedPath = path.resolve(selection.filePaths[0]);
  const folderPath = path.basename(selectedPath).toLowerCase() === DESKTOP_BACKUP_REPOSITORY_NAME
    ? path.dirname(selectedPath)
    : selectedPath;
  await fs.mkdir(folderPath, { recursive: true });
  await writeDesktopBackupBinding(folderPath);
  return { folderName: path.basename(folderPath) || folderPath };
};

const listDesktopBackupRepositoryFiles = async (directory) => {
  const relativeDirectory = directory ? safeRepositoryRelativePath(directory) : "";
  const { repositoryRoot } = await resolveDesktopBackupRepositoryRoot(false);
  const directoryPath = path.resolve(repositoryRoot, relativeDirectory);
  if (!isInsideDirectory(repositoryRoot, directoryPath)) {
    throw new Error("备份仓库目录超出绑定文件夹。");
  }
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const filePath = path.join(directoryPath, entry.name);
      const stat = await fs.stat(filePath);
      return {
        path: relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
        displayName: entry.name,
        size: stat.size,
        lastModified: stat.mtimeMs,
      };
    }));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const beginDesktopBackupRepositoryFileWrite = async (relativePath) => {
  const { targetPath } = await resolveDesktopBackupFilePath(relativePath, true);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const sessionId = randomUUID();
  const temporaryPath = `${targetPath}.${sessionId}.partial`;
  const handle = await fs.open(temporaryPath, "w");
  desktopBackupWriteSessions.set(sessionId, { targetPath, temporaryPath, handle, size: 0 });
  return { sessionId, path: safeRepositoryRelativePath(relativePath) };
};

const appendDesktopBackupRepositoryFileWrite = async (sessionId, data) => {
  const session = desktopBackupWriteSessions.get(sessionId);
  if (!session || typeof data !== "string") {
    throw new Error("备份写入会话不存在或已结束。");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength === 0 && data) {
    throw new Error("备份写入数据格式无效。");
  }
  await session.handle.write(bytes);
  session.size += bytes.byteLength;
  return { size: session.size };
};

const finishDesktopBackupRepositoryFileWrite = async (sessionId) => {
  const session = desktopBackupWriteSessions.get(sessionId);
  if (!session) {
    throw new Error("备份写入会话不存在或已结束。");
  }
  desktopBackupWriteSessions.delete(sessionId);
  try {
    await session.handle.close();
    await fs.rename(session.temporaryPath, session.targetPath);
    const stat = await fs.stat(session.targetPath);
    return {
      path: path.basename(session.targetPath),
      displayName: path.basename(session.targetPath),
      size: stat.size,
      lastModified: stat.mtimeMs,
    };
  } catch (error) {
    await fs.rm(session.temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const cancelDesktopBackupRepositoryFileWrite = async (sessionId) => {
  const session = desktopBackupWriteSessions.get(sessionId);
  if (!session) {
    return;
  }
  desktopBackupWriteSessions.delete(sessionId);
  await session.handle.close().catch(() => undefined);
  await fs.rm(session.temporaryPath, { force: true }).catch(() => undefined);
};

const requestDesktopBackupFlush = (reason) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve();
  }
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      desktopBackupFlushRequests.delete(requestId);
      resolve();
    }, 30_000);
    desktopBackupFlushRequests.set(requestId, () => {
      clearTimeout(timeout);
      resolve();
    });
    mainWindow.webContents.send("study-journal:backup-flush-request", { requestId, reason });
  });
};

ipcMain.handle("study-journal:desktop-backup-bind", bindDesktopBackupFolder);
ipcMain.handle("study-journal:desktop-backup-status", desktopBackupStatus);
ipcMain.handle("study-journal:desktop-backup-ensure", async () => {
  const { folderName } = await resolveDesktopBackupRepositoryRoot(true);
  return { folderName, repositoryName: DESKTOP_BACKUP_REPOSITORY_NAME };
});
ipcMain.handle("study-journal:desktop-backup-list", (_event, directory) => listDesktopBackupRepositoryFiles(directory));
ipcMain.handle("study-journal:desktop-backup-begin-write", (_event, pathValue) => beginDesktopBackupRepositoryFileWrite(pathValue));
ipcMain.handle("study-journal:desktop-backup-append-write", (_event, sessionId, data) => appendDesktopBackupRepositoryFileWrite(sessionId, data));
ipcMain.handle("study-journal:desktop-backup-finish-write", (_event, sessionId) => finishDesktopBackupRepositoryFileWrite(sessionId));
ipcMain.handle("study-journal:desktop-backup-cancel-write", (_event, sessionId) => cancelDesktopBackupRepositoryFileWrite(sessionId));
ipcMain.handle("study-journal:desktop-backup-read-text", async (_event, pathValue) => {
  const { targetPath } = await resolveDesktopBackupFilePath(pathValue, false);
  const text = await fs.readFile(targetPath, "utf8");
  return { text, size: Buffer.byteLength(text, "utf8") };
});
ipcMain.handle("study-journal:desktop-backup-read-chunk", async (_event, pathValue, offset, length) => {
  const { targetPath } = await resolveDesktopBackupFilePath(pathValue, false);
  const stat = await fs.stat(targetPath);
  const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const safeLength = Number.isSafeInteger(length) && length > 0 ? Math.min(length, 2 * 1024 * 1024) : 768 * 1024;
  if (safeOffset >= stat.size) {
    return { data: "", bytesRead: 0, done: true };
  }
  const bytesToRead = Math.min(safeLength, stat.size - safeOffset);
  const handle = await fs.open(targetPath, "r");
  try {
    const bytes = Buffer.allocUnsafe(bytesToRead);
    const result = await handle.read(bytes, 0, bytesToRead, safeOffset);
    return {
      data: bytes.subarray(0, result.bytesRead).toString("base64"),
      bytesRead: result.bytesRead,
      done: safeOffset + result.bytesRead >= stat.size,
    };
  } finally {
    await handle.close();
  }
});
ipcMain.handle("study-journal:desktop-backup-delete", async (_event, pathValue) => {
  const { targetPath } = await resolveDesktopBackupFilePath(pathValue, false);
  await fs.rm(targetPath, { force: true });
});
ipcMain.on("study-journal:backup-flush-complete", (_event, requestId) => {
  const complete = desktopBackupFlushRequests.get(requestId);
  desktopBackupFlushRequests.delete(requestId);
  complete?.();
});

const isInsideDist = (filePath) => filePath === DIST_ROOT || filePath.startsWith(`${DIST_ROOT}${path.sep}`);

const resolveAppFile = (requestUrl) => {
  const url = new URL(requestUrl);
  if (url.host !== APP_HOST) {
    return null;
  }
  const requestedPath = decodeURIComponent(url.pathname || "/");
  const relativePath = requestedPath === "/" ? "index.html" : `.${requestedPath}`;
  const resolvedPath = path.resolve(DIST_ROOT, relativePath);
  return isInsideDist(resolvedPath) && existsSync(resolvedPath) ? resolvedPath : null;
};

const registerAppProtocol = () => {
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppFile(request.url);
    if (!filePath) {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
};

const openExternalUrl = (url) => {
  if (/^https?:\/\//i.test(url)) {
    void shell.openExternal(url);
  }
};

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#f7f3ec",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("minimize", () => {
    void requestDesktopBackupFlush("minimize");
  });
  mainWindow.on("close", (event) => {
    if (closeAfterDesktopBackup) {
      return;
    }
    event.preventDefault();
    closeAfterDesktopBackup = true;
    void requestDesktopBackupFlush("close").finally(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://${APP_HOST}/`)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
  void mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    registerAppProtocol();
    createMainWindow();

    if (dataPathSetup.status === "migrated") {
      const migrationDetail = isSamePath(dataPathSetup.legacyDataPath, DESKTOP_ROOT)
        ? "早期版本的根目录副本仍被保留。请确认日志和资源正常后，再按需清理根目录中的旧缓存文件；不要删除 Data 或 App 目录。"
        : `旧数据仍保留在 ${dataPathSetup.legacyDataPath}，请确认日志和资源正常后再手动删除该目录。`;
      void dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "数据已迁移到 D 盘",
        message: "旧桌面版数据已经复制到 D:\\StudyJournal\\Data。",
        detail: migrationDetail,
      });
    } else if (dataPathSetup.status === "failed") {
      void dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "D 盘数据迁移未完成",
        message: "为了保护你的日志，本次继续使用旧的 C 盘数据目录。",
        detail: `请检查 D:\\StudyJournal\\Data 的可用空间和权限后重新打开应用。错误信息：${dataPathSetup.error}`,
      });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
