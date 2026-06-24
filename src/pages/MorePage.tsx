import { BarChart3, BrainCircuit, Download, Settings, Trash2 } from "lucide-react";

import type { AppSettings } from "../types";
import { createDefaultAiPresets } from "../db/defaults";
import { getCurrentAiProvider, normalizeAiConfig } from "../lib/aiProviders";
import { formatBytes } from "../lib/format";
import { getAutoBackupSettings } from "../services/autoBackupService";
import { ListRow, PageHeader } from "../components/ui";

interface MorePageProps {
  onOpenBackup: () => void;
  onOpenAiTools: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  settings: AppSettings;
}

const formatBackupTime = (value?: string): string =>
  value ? new Date(value).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "尚未备份";

const buildBackupMeta = (settings: AppSettings): string => {
  const autoBackup = getAutoBackupSettings(settings);
  const state = autoBackup?.enabled ? "已开启" : "未开启";
  const time = formatBackupTime(autoBackup?.lastBackupAt);
  const size = autoBackup?.lastBackupSize ? ` · ${formatBytes(autoBackup.lastBackupSize)}` : "";
  return `${state} · ${time}${size}`;
};

const buildBackupDescription = (settings: AppSettings): string => {
  const autoBackup = getAutoBackupSettings(settings);
  return autoBackup?.folderName ? `备份位置：${autoBackup.folderName}` : "管理数据备份、恢复导入和自动备份设置";
};

const buildAiMeta = (settings: AppSettings): string => {
  const config = normalizeAiConfig(
    settings.ai,
    settings.ai?.presets?.length ? settings.ai.presets : createDefaultAiPresets(),
  );
  const currentProvider = getCurrentAiProvider(config);
  if (!currentProvider) {
    return "未配置供应商";
  }
  return currentProvider.model
    ? `${currentProvider.providerName} · ${currentProvider.model}`
    : currentProvider.providerName;
};

export const MorePage = ({
  onOpenBackup,
  onOpenAiTools,
  onOpenStats,
  onOpenSettings,
  onOpenTrash,
  settings,
}: MorePageProps) => (
  <main className="page more-page">
    <PageHeader
      eyebrow="More"
      title="更多"
      subtitle="备份、AI 工具和应用入口集中在这里，常用信息保持一屏可扫。"
      density="compact"
    />

    <section className="more-section more-hub-section">
      <h2>工具</h2>
      <div className="more-list">
        <ListRow
          className="more-summary-row"
          icon={<Download size={19} />}
          title="备份与恢复"
          description={buildBackupDescription(settings)}
          meta={buildBackupMeta(settings)}
          onClick={onOpenBackup}
        />
        <ListRow
          className="more-summary-row"
          icon={<BrainCircuit size={19} />}
          title="AI 工具"
          description="AI 设置、聊天记录和材料导出"
          meta={buildAiMeta(settings)}
          onClick={onOpenAiTools}
        />
      </div>
    </section>

    <section className="more-section more-hub-section">
      <h2>应用</h2>
      <div className="more-list">
        <ListRow icon={<Trash2 size={19} />} title="回收站" description="恢复或永久删除 30 天内的记录" onClick={onOpenTrash} />
        <ListRow icon={<BarChart3 size={19} />} title="统计" description="查看记录趋势和资源数量" onClick={onOpenStats} />
        <ListRow icon={<Settings size={19} />} title="设置" description="目标日期、主题、字号和行距" onClick={onOpenSettings} />
      </div>
    </section>
  </main>
);
