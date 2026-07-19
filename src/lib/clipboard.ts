import { Clipboard } from "@capacitor/clipboard";

import { isNativePlatform } from "./platform";

export const normalizeClipboardText = (value: string): string =>
  value
    .replace(/\0/g, "")
    .replace(/\r\n?|\u2028|\u2029/g, "\n");

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Android WebView can expose navigator.clipboard but reject writes without a user gesture.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  textArea.style.width = "1px";
  textArea.style.height = "1px";
  textArea.style.opacity = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
};

const extensionForMime = (mimeType: string): string => {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
};

const fileFromDataUrl = (value: string, fileName = "clipboard-image"): File | undefined => {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(value);
  if (!match) {
    return undefined;
  }
  const mimeType = match[1] || "image/png";
  try {
    const decoded = atob(match[2]);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return new File([bytes], `${fileName}.${extensionForMime(mimeType)}`, { type: mimeType });
  } catch {
    return undefined;
  }
};

export const clipboardImageFiles = (clipboardData: DataTransfer | null | undefined): File[] => {
  if (!clipboardData) {
    return [];
  }
  return Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
};

export const readClipboardImageFallback = async (): Promise<File | undefined> => {
  try {
    if (isNativePlatform()) {
      const result = await Clipboard.read();
      if (result.type.startsWith("image/") && result.value.startsWith("data:")) {
        return fileFromDataUrl(result.value);
      }
    }
  } catch {
    // Native clipboard support is optional. The DOM paste event remains the primary path.
  }

  try {
    const items = await navigator.clipboard?.read?.();
    for (const item of items ?? []) {
      const type = item.types.find((candidate) => candidate.startsWith("image/"));
      if (!type) {
        continue;
      }
      const blob = await item.getType(type);
      return new File([blob], `clipboard-image.${extensionForMime(type)}`, { type });
    }
  } catch {
    // Browser clipboard reads require permission and may fail outside the paste gesture.
  }

  return undefined;
};

/** Read only the Capacitor clipboard. Browser permissions are handled separately. */
export const readNativeClipboardText = async (): Promise<string | undefined> => {
  if (!isNativePlatform()) {
    return undefined;
  }

  try {
    const result = await Clipboard.read();
    const type = (result.type ?? "").toLowerCase();
    if ((type.startsWith("text/") || !type) && typeof result.value === "string" && result.value) {
      return normalizeClipboardText(result.value);
    }
  } catch {
    // Native clipboard support is optional. The DOM paste event remains the fallback.
  }

  return undefined;
};

export const readClipboardTextFallback = async (): Promise<string | undefined> => {
  const nativeText = await readNativeClipboardText();
  if (nativeText) {
    return nativeText;
  }

  try {
    if (typeof navigator === "undefined") {
      return undefined;
    }
    const text = await navigator.clipboard?.readText?.();
    return text ? normalizeClipboardText(text) : undefined;
  } catch {
    // Browser clipboard reads require permission and may fail outside the paste gesture.
  }

  return undefined;
};
