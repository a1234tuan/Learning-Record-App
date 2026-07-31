import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { recognizePaddleOcr } = require("./ocr.cjs") as {
  recognizePaddleOcr: (options: {
    data: string;
    fileName: string;
    mimeType: string;
    token: string;
  }, runtime?: Record<string, unknown>) => Promise<{ jobId: string; text: string }>;
};

const response = (body: string, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: vi.fn(async () => body),
});

const request = () => ({
  data: Buffer.from("image bytes").toString("base64"),
  fileName: "笔记截图.png",
  mimeType: "image/png",
  token: "token-1",
});

const immediate = async () => undefined;

describe("desktop PaddleOCR bridge", () => {
  it("submits, polls, downloads, and extracts OCR text", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({ data: { jobId: "job-1" } })))
      .mockResolvedValueOnce(response(JSON.stringify({ data: { state: "running" } })))
      .mockResolvedValueOnce(response(JSON.stringify({
        data: { state: "done", resultUrl: { jsonUrl: "https://example.test/result.jsonl" } },
      })))
      .mockResolvedValueOnce(response(JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "识别文本" } }] } })));

    await expect(recognizePaddleOcr(request(), { fetch, sleep: immediate, now: () => 0 })).resolves.toEqual({
      jobId: "job-1",
      text: "识别文本",
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
      "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/job-1",
      "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/job-1",
      "https://example.test/result.jsonl",
    ]);
    expect(fetch.mock.calls[0][1].body.get("model")).toBe("PaddleOCR-VL-1.6");
  });

  it("preserves the queue-full error marker used by the OCR retry queue", async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ code: 10010, traceId: "trace-1" }), 503));

    await expect(recognizePaddleOcr(request(), { fetch })).rejects.toThrow("OCR_QUEUE_FULL: 百度 OCR 服务端任务队列已满");
    await expect(recognizePaddleOcr(request(), { fetch })).rejects.toThrow("traceId=trace-1");
  });

  it("rejects invalid image data and does not send a request", async () => {
    const fetch = vi.fn();

    await expect(recognizePaddleOcr({ ...request(), data: "not-base64" }, { fetch })).rejects.toThrow("OCR 图片数据格式无效");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS OCR result URLs", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({ data: { jobId: "job-1" } })))
      .mockResolvedValueOnce(response(JSON.stringify({
        data: { state: "done", resultUrl: { jsonUrl: "http://example.test/result.jsonl" } },
      })));

    await expect(recognizePaddleOcr(request(), { fetch, sleep: immediate, now: () => 0 })).rejects.toThrow("OCR 结果地址必须使用 HTTPS");
  });

  it("times out without polling after the deadline has elapsed", async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ data: { jobId: "job-1" } })));
    let calls = 0;
    const now = () => calls++ === 0 ? 0 : 300_000;

    await expect(recognizePaddleOcr(request(), { fetch, now })).rejects.toThrow("OCR 识别超时");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
