import type { AppSettings, StreamableBackupSnapshot } from "../types";

const PRIVATE_EXPORT_KEYS = new Set([
  "apikey",
  "authorization",
  "prompt",
  "providerresponse",
  "rawresponse",
  "responsebody",
  "secret",
  "systemprompt",
]);

/** Removes provider secrets and full prompt/response bodies at every export boundary. */
export const stripPrivateExportFields = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(stripPrivateExportFields) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !PRIVATE_EXPORT_KEYS.has(key.toLowerCase()))
    .map(([key, item]) => [key, stripPrivateExportFields(item)])) as T;
};

/**
 * Prompts and device-local backup paths do not belong in cloud sync or ordinary exports.
 * Empty prompt collections keep the serialized settings structurally valid for older importers.
 */
export const sanitizeSettingsForExport = (settings: AppSettings): AppSettings => {
  const {
    lastBackupAt: _lastBackupAt,
    syncFolderName: _syncFolderName,
    knowledgePodcastModeTemplates: _knowledgePodcastModeTemplates,
    ...portable
  } = settings;
  return stripPrivateExportFields({
    ...portable,
    ...(portable.ai ? { ai: { ...portable.ai, presets: [] } } : {}),
    knowledgePodcastModeTemplates: [],
  } as AppSettings);
};

/** Restores fields deliberately omitted from cloud payloads from this device's current settings. */
export const preserveLocalSettings = (incoming: AppSettings, current: AppSettings): AppSettings => ({
  ...incoming,
  ...(current.lastBackupAt !== undefined ? { lastBackupAt: current.lastBackupAt } : {}),
  ...(current.syncFolderName !== undefined ? { syncFolderName: current.syncFolderName } : {}),
  ai: incoming.ai
    ? { ...incoming.ai, presets: current.ai?.presets ?? [] }
    : current.ai,
  knowledgePodcastModeTemplates: current.knowledgePodcastModeTemplates ?? [],
});

/** Defense-in-depth for native writers that can be called with a hand-built snapshot. */
export const sanitizeStreamableSnapshotForExport = (snapshot: StreamableBackupSnapshot): StreamableBackupSnapshot => {
  const assets = snapshot.assets.filter((asset) => asset.generatedBy !== "knowledge-podcast");
  return {
    ...snapshot,
    payload: {
      ...snapshot.payload,
      manifest: {
        ...snapshot.payload.manifest,
        counts: { ...snapshot.payload.manifest.counts, assets: assets.length },
      },
      settings: sanitizeSettingsForExport(snapshot.payload.settings),
      reviewCoach: stripPrivateExportFields(snapshot.payload.reviewCoach),
    },
    assets,
  };
};
