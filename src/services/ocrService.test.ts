import { describe, expect, it } from "vitest";

import { extractOcrTextFromJson, extractOcrTextFromJsonl, extractPaddleOcrText } from "./ocrService";

describe("extractOcrTextFromJsonl", () => {
  it("extracts markdown text from PaddleOCR jsonl", () => {
    const jsonl = [
      JSON.stringify({
        result: {
          layoutParsingResults: [
            { markdown: { text: "第一段 OCR 文本" } },
            { markdown: { text: "第二段 OCR 文本" } },
          ],
        },
      }),
    ].join("\n");

    expect(extractOcrTextFromJsonl(jsonl)).toBe("第一段 OCR 文本\n\n第二段 OCR 文本");
  });

  it("extracts markdown text from nested PaddleOCR json", () => {
    expect(
      extractOcrTextFromJson({
        data: {
          result: {
            layoutParsingResults: [
              { markdown: { text: "嵌套 OCR 文本" } },
            ],
          },
        },
      }),
    ).toBe("嵌套 OCR 文本");
  });

  it("returns empty text when OCR json contains no markdown text", () => {
    expect(extractOcrTextFromJson({ result: { layoutParsingResults: [] } })).toBe("");
  });

  it("extracts text from common PaddleOCR fallback fields", () => {
    expect(
      extractPaddleOcrText({
        data: {
          result: {
            recTexts: ["倒置手写第一行", "倒置手写第二行"],
            blocks: [
              { recText: "单行识别文本" },
            ],
          },
        },
      }),
    ).toBe("倒置手写第一行\n\n倒置手写第二行\n\n单行识别文本");
  });
});
