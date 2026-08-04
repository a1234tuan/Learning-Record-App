import { ArrowLeft } from "lucide-react";

import type { AppSettings } from "../types";
import { AiSettingsPanel } from "../components/AiSettingsPanel";
import { PageHeader } from "../components/ui";

interface AiToolsPageProps {
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
  onBack: () => void;
}

export const AiToolsPage = ({ settings, onChanged, onBack }: AiToolsPageProps) => (
  <main className="page ai-tools-page">
    <div className="web-navigation-back-row">
      <button type="button" className="secondary-button web-navigation-back" onClick={onBack}>
        <ArrowLeft size={18} />
        返回
      </button>
    </div>
    <PageHeader
      eyebrow="AI Settings"
      title="AI 设置"
      subtitle="配置 AI 供应商、模型和预设。"
      density="compact"
    />
    <AiSettingsPanel settings={settings} onChanged={onChanged} />
  </main>
);
