const OCR_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
const OCR_MODEL = "PaddleOCR-VL-1.6";
const OCR_POLL_INTERVAL_MS = 5_000;
const OCR_MAX_WAIT_MS = 5 * 60 * 1_000;

const optionalPayload = {
  useDocOrientationClassify: true,
  useDocUnwarping: true,
  useChartRecognition: false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const errorBody = (body) => body || "响应体为空。";

const parseJson = (body, message) => {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(message);
  }
};

const sanitizeFileName = (value) => {
  const cleaned = typeof value === "string"
    ? value.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 180)
    : "";
  return cleaned || "image.png";
};

const sanitizeMimeType = (value) =>
  typeof value === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value)
    ? value
    : "application/octet-stream";

const decodeImage = (data) => {
  if (typeof data !== "string" || !data.trim()) {
    throw new Error("OCR 图片数据为空。");
  }
  const normalized = data.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error("OCR 图片数据格式无效。");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("OCR 图片数据为空。");
  }
  return bytes;
};

const collectTextChunks = (value, chunks, key) => {
  if (typeof value === "string") {
    if (["text", "recText", "rec_text", "markdownText", "markdown_text"].includes(key)) {
      chunks.push(value);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && ["recTexts", "texts", "rec_texts"].includes(key)) {
        chunks.push(item);
      } else {
        collectTextChunks(item, chunks, key);
      }
    }
    return;
  }
  for (const [childKey, child] of Object.entries(value)) {
    collectTextChunks(child, chunks, childKey);
  }
};

const extractText = (jsonl) => {
  const chunks = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      collectTextChunks(parseJson(trimmed, "OCR 结果格式无效。"), chunks);
    }
  }
  return Array.from(new Set(chunks.map((chunk) => chunk.trim()).filter(Boolean))).join("\n\n").trim();
};

const queueFullError = (traceId) => new Error(
  "OCR_QUEUE_FULL: 百度 OCR 服务端任务队列已满，请稍后重试" + (traceId ? `。traceId=${traceId}` : "。"),
);

const requestJson = async (fetchImpl, url, options, errorPrefix) => {
  const response = await fetchImpl(url, options);
  const body = await response.text();
  if (!response.ok) {
    if (errorPrefix === "OCR 提交失败") {
      const parsed = (() => {
        try {
          return JSON.parse(body);
        } catch {
          return undefined;
        }
      })();
      if (parsed?.code === 10010) {
        throw queueFullError(typeof parsed.traceId === "string" ? parsed.traceId : "");
      }
    }
    throw new Error(`${errorPrefix}：${response.status} ${errorBody(body)}`);
  }
  return parseJson(body, `${errorPrefix}：返回数据无效。`);
};

const recognizePaddleOcr = async (options, runtime = {}) => {
  const token = typeof options?.token === "string" ? options.token.trim() : "";
  if (!token) {
    throw new Error("请先在 OCR 设置中配置 PaddleOCR Token。");
  }

  const fetchImpl = runtime.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("桌面 OCR 网络服务尚未就绪，请重新打开应用后重试。");
  }
  const FormDataImpl = runtime.FormData ?? globalThis.FormData;
  const BlobImpl = runtime.Blob ?? globalThis.Blob;
  if (!FormDataImpl || !BlobImpl) {
    throw new Error("桌面 OCR 文件服务尚未就绪，请重新打开应用后重试。");
  }

  const imageBytes = decodeImage(options?.data);
  const formData = new FormDataImpl();
  formData.append("model", OCR_MODEL);
  formData.append("optionalPayload", JSON.stringify(optionalPayload));
  formData.append(
    "file",
    new BlobImpl([imageBytes], { type: sanitizeMimeType(options?.mimeType) }),
    sanitizeFileName(options?.fileName),
  );
  const submitted = await requestJson(fetchImpl, OCR_JOB_URL, {
    method: "POST",
    headers: { Authorization: `bearer ${token}` },
    body: formData,
  }, "OCR 提交失败");
  const jobId = submitted?.data?.jobId;
  if (typeof jobId !== "string" || !jobId) {
    throw new Error("OCR 提交失败：没有返回 jobId。");
  }

  const now = runtime.now ?? Date.now;
  const wait = runtime.sleep ?? sleep;
  const pollIntervalMs = runtime.pollIntervalMs ?? OCR_POLL_INTERVAL_MS;
  const maxWaitMs = runtime.maxWaitMs ?? OCR_MAX_WAIT_MS;
  const startedAt = now();
  while (now() - startedAt < maxWaitMs) {
    await wait(pollIntervalMs);
    const result = await requestJson(fetchImpl, `${OCR_JOB_URL}/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `bearer ${token}` },
    }, "OCR 查询失败");
    const state = result?.data?.state;
    if (state === "failed") {
      throw new Error(typeof result?.data?.errorMsg === "string" && result.data.errorMsg.trim()
        ? result.data.errorMsg.trim()
        : "OCR 识别失败。");
    }
    if (state !== "done") {
      continue;
    }
    const jsonUrl = result?.data?.resultUrl?.jsonUrl;
    let parsedUrl;
    try {
      parsedUrl = new URL(jsonUrl);
    } catch {
      throw new Error("OCR 已完成，但没有返回有效的结果地址。");
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error("OCR 结果地址必须使用 HTTPS。");
    }
    const resultResponse = await fetchImpl(parsedUrl.href);
    const jsonl = await resultResponse.text();
    if (!resultResponse.ok) {
      throw new Error(`OCR 结果下载失败：${resultResponse.status}`);
    }
    const text = extractText(jsonl);
    if (!text) {
      throw new Error("上游返回空 OCR 文本。");
    }
    return { jobId, text };
  }

  throw new Error("OCR 识别超时，请稍后重试。");
};

module.exports = {
  OCR_CONFIG: {
    jobUrl: OCR_JOB_URL,
    model: OCR_MODEL,
    pollIntervalMs: OCR_POLL_INTERVAL_MS,
    maxWaitMs: OCR_MAX_WAIT_MS,
  },
  recognizePaddleOcr,
};
