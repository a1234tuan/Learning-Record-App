import type { AppSettings } from "../types";
import { TtsSettingsPanel } from "../components/TtsSettingsPanel";
import { PageHeader } from "../components/ui";

interface TtsSettingsPageProps {
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
}

export const TtsSettingsPage = ({ settings, onChanged }: TtsSettingsPageProps) => (
  <main className="page tts-settings-page">
    <PageHeader eyebrow="TTS" title="TTS 设置" density="compact" />
    <TtsSettingsPanel settings={settings} onChanged={onChanged} />
  </main>
);
