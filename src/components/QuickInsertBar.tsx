import {
  Camera,
  CheckSquare,
  Code2,
  FilePlus,
  ImagePlus,
  MessageSquareQuote,
  NotebookPen,
  Pi,
  Plus,
  Timer,
} from "lucide-react";
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from "@capacitor/camera";

import type { Subject } from "../types";
import { isNativePlatform } from "../lib/platform";

interface QuickInsertBarProps {
  onText: () => void;
  onTemplate: () => void;
  onTodo: () => void;
  onStudySession: (subject?: Subject, minutes?: number) => void;
  onFormula: () => void;
  onCode: () => void;
  onQuote: () => void;
  onImage: (file: File) => void;
  onAttachment: (file: File) => void;
}

export const QuickInsertBar = ({
  onText,
  onTemplate,
  onTodo,
  onStudySession,
  onFormula,
  onCode,
  onQuote,
  onImage,
  onAttachment,
}: QuickInsertBarProps) => {
  const native = isNativePlatform();
  const pickNativeImage = async (source: CameraSource) => {
    const photo = await CapacitorCamera.getPhoto({
      quality: 88,
      resultType: CameraResultType.Uri,
      source,
    });
    if (!photo.webPath) {
      return;
    }
    const response = await fetch(photo.webPath);
    const blob = await response.blob();
    const extension = photo.format ? `.${photo.format}` : ".jpg";
    const file = new File([blob], `study-image-${Date.now()}${extension}`, {
      type: blob.type || `image/${photo.format ?? "jpeg"}`,
    });
    onImage(file);
  };

  return (
  <div className="quick-insert" aria-label="快速插入">
    <button type="button" title="文字" onClick={onText}>
      <Plus size={18} />
      <span>文字</span>
    </button>
    <button type="button" title="模板" onClick={onTemplate}>
      <NotebookPen size={18} />
      <span>模板</span>
    </button>
    <button type="button" title="待办" onClick={onTodo}>
      <CheckSquare size={18} />
      <span>待办</span>
    </button>
    <button type="button" title="时长" onClick={() => onStudySession()}>
      <Timer size={18} />
      <span>时长</span>
    </button>
    <button type="button" title="公式" onClick={onFormula}>
      <Pi size={18} />
      <span>公式</span>
    </button>
    <button type="button" title="代码" onClick={onCode}>
      <Code2 size={18} />
      <span>代码</span>
    </button>
    <button type="button" title="引用" onClick={onQuote}>
      <MessageSquareQuote size={18} />
      <span>引用</span>
    </button>
    {native ? (
      <>
        <button type="button" title="拍照" onClick={() => void pickNativeImage(CameraSource.Camera)}>
          <Camera size={18} />
          <span>拍照</span>
        </button>
        <button type="button" title="相册" onClick={() => void pickNativeImage(CameraSource.Photos)}>
          <ImagePlus size={18} />
          <span>相册</span>
        </button>
      </>
    ) : (
      <label title="图片">
        <ImagePlus size={18} />
        <span>图片</span>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onImage(file);
            }
            event.target.value = "";
          }}
        />
      </label>
    )}
    <label title="附件">
      <FilePlus size={18} />
      <span>附件</span>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onAttachment(file);
          }
          event.target.value = "";
        }}
      />
    </label>
  </div>
  );
};
