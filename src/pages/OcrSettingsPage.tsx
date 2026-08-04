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
        <p className="helper-text">Token 只存本机，不进入完整备份。配置后可用于图片 OCR 检索和 AI 图片问答。</p>
        <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
          <Save size={18} />
          {saving ? "保存中..." : "保存 OCR 设置"}
        </button>
        {message && <p className="status-message">{message}</p>}
      </section>
    </main>
  );
};
