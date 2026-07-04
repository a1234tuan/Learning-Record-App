import { storage } from "./storageAdapter";

export const PADDLE_OCR_SECRET_ID = "paddle-ocr";

export const getPaddleOcrToken = async (): Promise<string> =>
  (await storage.getAiSecret?.(PADDLE_OCR_SECRET_ID))?.apiKey.trim() ?? "";

export const savePaddleOcrToken = async (token: string): Promise<void> => {
  const trimmed = token.trim();
  if (trimmed) {
    await storage.saveAiSecret?.(trimmed, PADDLE_OCR_SECRET_ID);
    return;
  }
  await storage.clearAiSecret?.(PADDLE_OCR_SECRET_ID);
};
