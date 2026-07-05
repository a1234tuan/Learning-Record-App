import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AppSettings } from "../types";
import { flushAutoBackupNow } from "../services/autoBackupService";
import { AutoBackupPanel } from "./AutoBackupPanel";

vi.mock("../services/autoBackupService", () => ({
  bindAutoBackupFolder: vi.fn(),
  flushAutoBackupNow: vi.fn(),
  getAutoBackupSettings: (settings: AppSettings) => ({
    enabled: settings.autoBackup?.enabled ?? false,
    debounceMs: settings.autoBackup?.debounceMs ?? 45_000,
    folderName: settings.autoBackup?.folderName,
    lastBackupAt: settings.autoBackup?.lastBackupAt,
    lastBackupSize: settings.autoBackup?.lastBackupSize,
    lastBackupFileName: settings.autoBackup?.lastBackupFileName,
    lastBackupWarning: settings.autoBackup?.lastBackupWarning,
    lastError: settings.autoBackup?.lastError,
  }),
  setAutoBackupEnabled: vi.fn(),
}));

const settings = (
  lastError?: string,
  autoBackup: Partial<NonNullable<AppSettings["autoBackup"]>> = {},
): AppSettings => ({
  id: "settings",
  examDate: "2026-12-27",
  theme: "system",
  accentColor: "#2f6f5e",
  backupReminderDays: 7,
  fontScale: 1,
  lineHeight: 1.7,
  subjects: [],
  autoBackup: {
    enabled: true,
    folderName: "backup",
    debounceMs: 45_000,
    lastError,
    ...autoBackup,
  },
  schemaVersion: 4,
});

describe("AutoBackupPanel", () => {
  it("shows the sync error instead of a success message when flush reports a backup error", async () => {
    vi.mocked(flushAutoBackupNow).mockResolvedValueOnce(settings("自动备份写入结果为空。"));

    render(<AutoBackupPanel settings={settings()} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /立即同步/ }));

    await waitFor(() => {
      expect(screen.getByText("自动备份写入结果为空。")).toBeInTheDocument();
    });
    expect(screen.queryByText("已立即同步到 study-journal-latest.zip。")).not.toBeInTheDocument();
  });

  it("shows the verified backup file name from the latest successful sync", () => {
    render(
      <AutoBackupPanel
        settings={settings(undefined, {
          lastBackupAt: "2026-06-21T01:00:00.000Z",
          lastBackupSize: 1234,
          lastBackupFileName: "study-journal-latest (1).zip",
          lastBackupWarning: "请在备份文件夹中查找：study-journal-latest (1).zip",
        })}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText("study-journal-latest (1).zip")).toBeInTheDocument();
    expect(screen.getByText("请在备份文件夹中查找：study-journal-latest (1).zip")).toBeInTheDocument();
  });
});
