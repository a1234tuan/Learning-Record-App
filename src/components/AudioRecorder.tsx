import { Mic, Square } from "lucide-react";
import { useRef, useState } from "react";
import {
  canUseNativeAudioRecorder,
  startNativeAudioRecording,
  stopNativeAudioRecording,
} from "../services/nativeAudioRecorder";

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
}

export const AudioRecorder = ({ onRecorded }: AudioRecorderProps) => {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const supported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices) && typeof MediaRecorder !== "undefined";

  const start = async () => {
    try {
      setError("");
      setStatus("正在请求麦克风权限...");
      if (canUseNativeAudioRecorder()) {
        await startNativeAudioRecording();
        setRecording(true);
        setStatus("录音中");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => setError("录音过程出错，请重新授权麦克风或改用上传音频。");
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) {
          onRecorded(new File([blob], `recording-${Date.now()}.webm`, { type: blob.type }));
        } else {
          setError("没有录到声音，请检查麦克风权限。");
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setStatus("录音中");
    } catch (reason) {
      const message = reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "麦克风权限被拒绝，请在系统或浏览器设置中允许录音。"
        : reason instanceof Error
          ? reason.message
          : "当前环境无法启动录音，可先上传音频文件。";
      setError(message);
      setStatus("");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRecording(false);
    }
  };

  const stop = async () => {
    setStatus("正在保存录音...");
    if (canUseNativeAudioRecorder()) {
      try {
        onRecorded(await stopNativeAudioRecording());
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "停止录音失败。");
      } finally {
        setStatus("");
        setRecording(false);
      }
      return;
    }
    recorderRef.current?.stop();
    setStatus("");
    setRecording(false);
  };

  if (!supported && !canUseNativeAudioRecorder()) {
    return <span className="helper-text">当前环境不支持直接录音，可上传音频文件。</span>;
  }

  return (
    <span className="audio-recorder-control">
      <button type="button" className="secondary-button" onClick={recording ? () => void stop() : () => void start()}>
        {recording ? <Square size={17} /> : <Mic size={17} />}
        {recording ? "停止录音" : "开始录音"}
      </button>
      {status && <small className="status-message">{status}</small>}
      {error && <small className="status-message">{error}</small>}
    </span>
  );
};
