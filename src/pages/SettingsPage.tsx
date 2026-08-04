import type { AppSettings } from "../types";
import { PageHeader } from "../components/ui";

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
}

export const SettingsPage = ({ settings, onSaveSettings }: SettingsPageProps) => (
  <main className="page settings-page">
    <PageHeader eyebrow="Settings" title="设置" density="compact" />
    <section className="settings-panel">
      <label>
        目标日期
        <input
          type="date"
          value={settings.examDate}
          onChange={(event) => onSaveSettings({ ...settings, examDate: event.target.value })}
        />
      </label>
      <label>
        主题
        <select
          value={settings.theme}
          onChange={(event) => onSaveSettings({ ...settings, theme: event.target.value as AppSettings["theme"] })}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <label>
        字号
        <input
          type="range"
          min={0.9}
          max={1.25}
          step={0.05}
          value={settings.fontScale}
          onChange={(event) => onSaveSettings({ ...settings, fontScale: Number(event.target.value) })}
        />
      </label>
      <label>
        行距
        <input
          type="range"
          min={1.4}
          max={2}
          step={0.05}
          value={settings.lineHeight}
          onChange={(event) => onSaveSettings({ ...settings, lineHeight: Number(event.target.value) })}
        />
      </label>
    </section>
  </main>
);
