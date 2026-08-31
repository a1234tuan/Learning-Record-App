import { useEffect, useRef, useState } from "react";
import type { AppSettings, LearningCoachSettings, PostgraduateExamStage } from "../types";
import { PageHeader } from "../components/ui";
import { isDesktopPlatform } from "../lib/platform";

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  learningCoachSettings?: LearningCoachSettings;
  onSaveLearningCoachSettings?: (settings: LearningCoachSettings) => void;
}

export const SettingsPage = ({ settings, onSaveSettings, learningCoachSettings, onSaveLearningCoachSettings }: SettingsPageProps) => {
  const isDesktop = isDesktopPlatform();
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyStatus, setProxyStatus] = useState("");
  const statusTimer = useRef<ReturnType<typeof setTimeout>>();
  const coach = learningCoachSettings;
  const saveCoach = (patch: Partial<LearningCoachSettings>) => {
    if (!coach || !onSaveLearningCoachSettings) return;
    onSaveLearningCoachSettings({ ...coach, ...patch });
  };
  const saveProfile = (patch: Partial<NonNullable<LearningCoachSettings["postgraduateExamProfile"]>>) => {
    if (!coach || !onSaveLearningCoachSettings) return;
    onSaveLearningCoachSettings({
      ...coach,
      postgraduateExamProfile: {
        examDate: coach.postgraduateExamProfile?.examDate ?? settings.examDate,
        weeklyAvailableMinutes: coach.postgraduateExamProfile?.weeklyAvailableMinutes ?? 0,
        stages: coach.postgraduateExamProfile?.stages ?? {},
        ...patch,
      },
    });
  };

  useEffect(() => {
    if (!isDesktop) return;
    void window.studyJournalDesktop!.proxy.getProxy().then(({ proxyUrl: url }) => setProxyUrl(url));
  }, [isDesktop]);

  const saveProxy = async () => {
    try {
      await window.studyJournalDesktop!.proxy.setProxy(proxyUrl);
      setProxyStatus("已保存。");
    } catch {
      setProxyStatus("保存失败，请检查地址格式（如 http://127.0.0.1:7890）。");
    }
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setProxyStatus(""), 3000);
  };

  const testFirebaseStorage = async () => {
    try {
      const { proxy, status } = await window.studyJournalDesktop!.proxy.testFirebaseStorage();
      setProxyStatus(`Firebase Storage 可连接（HTTP ${status}，${proxy}）。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProxyStatus(`Firebase Storage 不可连接：${message}`);
    }
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setProxyStatus(""), 10_000);
  };

  return (
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
      {coach && (
        <section className="settings-panel">
          <h3>学习驾驶舱</h3>
          <label>
            学习场景
            <select value={coach.scenario} onChange={(event) => saveCoach({ scenario: event.target.value as LearningCoachSettings["scenario"] })}>
              <option value="general">通用学习</option>
              <option value="postgraduate-exam">备考考研</option>
            </select>
          </label>
          <label className="settings-check-row">
            <input type="checkbox" checked={coach.dashboardEnabled} onChange={(event) => saveCoach({ dashboardEnabled: event.target.checked })} />
            开启 AI 学习驾驶舱
          </label>
          {coach.scenario === "postgraduate-exam" && <>
            <label>
              考试日期
              <input type="date" value={coach.postgraduateExamProfile?.examDate ?? settings.examDate} onChange={(event) => saveProfile({ examDate: event.target.value })} />
            </label>
            <label>
              每周可用时间（分钟）
              <input type="number" min={0} value={coach.postgraduateExamProfile?.weeklyAvailableMinutes ?? 0} onChange={(event) => saveProfile({ weeklyAvailableMinutes: Number(event.target.value) })} />
            </label>
            {(["数学", "政治", "英语", "408"] as const).map((subject) => (
              <label key={subject}>
                {subject}阶段
                <select
                  value={coach.postgraduateExamProfile?.stages[subject] ?? ""}
                  onChange={(event) => saveProfile({ stages: { ...coach.postgraduateExamProfile?.stages, [subject]: event.target.value as PostgraduateExamStage } })}
                >
                  <option value="">未设置</option>
                  <option value="基础">基础</option><option value="强化">强化</option><option value="刷题">刷题</option><option value="冲刺">冲刺</option>
                </select>
              </label>
            ))}
          </>}
          <p className="settings-hint">驾驶舱数据仅保存在本机完整备份中，不参与云同步。</p>
        </section>
      )}
      {isDesktop && (
        <section className="settings-panel">
          <h3>网络代理</h3>
          <p className="settings-hint">
            填写本地代理地址（如 Clash、V2Ray 的 HTTP 代理端口），让软件的云同步流量走该代理。留空则使用系统代理设置。
          </p>
          <label>
            代理地址
            <input
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void saveProxy(); }}
            />
          </label>
          <div className="settings-row">
            <button onClick={() => void saveProxy()}>保存代理</button>
            <button className="secondary-button" onClick={() => void testFirebaseStorage()}>测试 Firebase 连接</button>
            {proxyStatus && <span className="settings-status">{proxyStatus}</span>}
          </div>
        </section>
      )}
    </main>
  );
};
