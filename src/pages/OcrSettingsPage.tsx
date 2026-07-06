import { Eye, EyeOff, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { getPaddleOcrToken, savePaddleOcrToken } from "../services/ocrSettings";
import { PageHeader } from "../components/ui";

interface OcrSettingsPageProps {
  onChanged: () => Promise<void> | void;
}

export const OcrSettingsPage = ({ onChanged }: OcrSettingsPageProps) => {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPaddleOcrToken()
      .then((value) => {
        if (!cancelled) {
          setToken(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setToken("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await savePaddleOcrToken(token);
      await onChanged();
      setMessage("OCR 设置已保存。Token 只保存在本机，不进入完整备份。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OCR 设置保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page ocr-settings-page">
      <PageHeader
        eyebrow="OCR"
        title="OCR 设置"
        subtitle="配置 PaddleOCR，用于图片文字识别、本地全文检索和 AI 图片问答。"
        density="compact"
      />

      <section className="settings-panel ocr-settings-panel">
        <header className="inline-section-header">
          <div>
            <h2>PaddleOCR</h2>
            <p>请填写你自己的 PaddleOCR / AI Studio Token。应用不会内置公共 Token，也不会把它打包进 APK。</p>
          </div>
        </header>

        <label>
          PaddleOCR Token
          <span className="secret-input">
            <input
              value={token}
              type={showToken ? "text" : "password"}
              onChange={(event) => setToken(event.target.value)}
              placeholder="在 PaddleOCR / AI Studio 控制台获取后填写"
            />
            <button type="button" onClick={() => setShowToken((value) => !value)} aria-label="切换 PaddleOCR Token 显示">
              {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>

        <p className="helper-text">
          配置后，图片资源的 OCR 文本会进入本地全文检索；AI 图片问答选择“本地 OCR 后转文字”时也会复用这里的配置。
          未配置时，新图片 OCR 会提示先配置 Token，已识别出的历史 OCR 文本仍可继续搜索。
        </p>

        <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
          <Save size={18} />
          {saving ? "保存中..." : "保存 OCR 设置"}
        </button>
        {message && <p className="status-message">{message}</p>}
      </section>
    </main>
  );
};
