import { Mic, Square } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  canUseNativeAudioRecorder,
  getNativeAudioRecordingStatus,
  startNativeAudioRecording,
  stopNativeAudioRecording,
} from "../services/nativeAudioRecorder";

export interface AudioRecorderHandle {
  stopAndGetFile: () => Promise<File | null>;
  isRecording: () => boolean;
}

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
}

export const AudioRecorder = forwardRef<AudioRecorderHandle, AudioRecorderProps>(({ onRecorded }, ref) => {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const pendingStopResolverRef = useRef<((file: File | null) => void) | null>(null);
  const onRecordedRef = useRef(onRecorded);
  const recordingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const supported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices) && typeof MediaRecorder !== "undefined";

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const setRecordingState = useCallback((nextRecording: boolean) => {
    recordingRef.current = nextRecording;
    setRecording(nextRecording);
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!canUseNativeAudioRecorder()) {
      return undefined;
    }
    void getNativeAudioRecordingStatus().then((nativeStatus) => {
      if (!mounted) {
        return;
      }
      setRecordingState(nativeStatus.recording);
      setStatus(nativeStatus.recording ? "录音中" : "");
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [setRecordingState]);

  const stopWebRecording = useCallback(async (): Promise<File | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecordingState(false);
      setStatus("");
      return null;
    }

    setStatus("正在保存录音...");
    return new Promise((resolve) => {
      pendingStopResolverRef.current = resolve;
      try {
        recorder.stop();
      } catch (reason) {
        pendingStopResolverRef.current = null;
        setError(reason instanceof Error ? reason.message : "停止录音失败。");
        setStatus("");
        setRecordingState(false);
        resolve(null);
      }
    });
  }, [setRecordingState]);

  const stopAndGetFile = useCallback(async (): Promise<File | null> => {
    if (canUseNativeAudioRecorder()) {
      try {
        const nativeStatus = await getNativeAudioRecordingStatus();
        if (!nativeStatus.recording) {
          setRecordingState(false);
          setStatus("");
          return null;
        }
        setStatus("正在保存录音...");
        const file = await stopNativeAudioRecording();
        setError("");
        setStatus("");
        setRecordingState(false);
        return file;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "停止录音失败。");
        setStatus("");
        setRecordingState(false);
        return null;
      }
    }
    return stopWebRecording();
  }, [setRecordingState, stopWebRecording]);

  useImperativeHandle(ref, () => ({
    stopAndGetFile,
    isRecording: () => recordingRef.current,
  }), [stopAndGetFile]);

  const start = async () => {
    try {
      setError("");
      setStatus("正在请求麦克风权限...");
      if (canUseNativeAudioRecorder()) {
        await startNativeAudioRecording();
        setRecordingState(true);
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
        const file = blob.size > 0
          ? new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })
          : null;
        if (!file) {
          setError("没有录到声音，请检查麦克风权限。");
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        setStatus("");
        setRecordingState(false);
        const resolver = pendingStopResolverRef.current;
        pendingStopResolverRef.current = null;
        if (resolver) {
          resolver(file);
        } else if (file) {
          onRecordedRef.current(file);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecordingState(true);
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
      setRecordingState(false);
    }
  };

  const stop = async () => {
    const file = await stopAndGetFile();
    if (file) {
      onRecorded(file);
    }
  };

  useEffect(() => () => {
    if (!canUseNativeAudioRecorder()) {
      void stopWebRecording();
    }
  }, [stopWebRecording]);

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
});

AudioRecorder.displayName = "AudioRecorder";
