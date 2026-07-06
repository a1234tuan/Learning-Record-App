import {
  Camera as CapacitorCamera,
  CameraResultType,
  CameraSource,
  MediaTypeSelection,
  type MediaResult,
} from "@capacitor/camera";

type PickedNativeImage = {
  webPath?: string;
  format?: string;
  metadata?: { format?: string };
  thumbnail?: string;
};

const isCancelled = (error: unknown): boolean => {
  const value = error as { code?: string; message?: string } | undefined;
  const text = `${value?.code ?? ""} ${value?.message ?? ""} ${String(error)}`.toLowerCase();
  return text.includes("cancel");
};

const imageFormat = (media: PickedNativeImage): string => {
  const format = media.format ?? media.metadata?.format ?? "jpg";
  return format === "jpeg" ? "jpg" : format;
};

const thumbnailToBlob = (thumbnail: string, format: string): Blob => {
  const base64 = thumbnail.includes(",") ? thumbnail.slice(thumbnail.indexOf(",") + 1) : thumbnail;
  const mime = thumbnail.startsWith("data:")
    ? thumbnail.slice(5, thumbnail.indexOf(";"))
    : `image/${format === "jpg" ? "jpeg" : format}`;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
};

export const nativeImageResultToFile = async (media: PickedNativeImage, prefix: string): Promise<File | undefined> => {
  const format = imageFormat(media);
  let blob: Blob | undefined;
  if (media.webPath) {
    const response = await fetch(media.webPath);
    blob = await response.blob();
  } else if (media.thumbnail) {
    blob = thumbnailToBlob(media.thumbnail, format);
  }
  if (!blob) {
    return undefined;
  }
  return new File([blob], `${prefix}-${Date.now()}.${format}`, {
    type: blob.type || `image/${format === "jpg" ? "jpeg" : format}`,
  });
};

export const pickNativeCameraImageFile = async (prefix = "study-image"): Promise<File | undefined> => {
  try {
    const photo = await CapacitorCamera.getPhoto({
      quality: 88,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
    });
    return nativeImageResultToFile(photo, prefix);
  } catch (error) {
    if (isCancelled(error)) {
      return undefined;
    }
    throw error;
  }
};

export const pickNativeGalleryImageFile = async (prefix = "study-image"): Promise<File | undefined> => {
  try {
    const result = await CapacitorCamera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: false,
      quality: 88,
      correctOrientation: true,
    });
    const media = result.results?.[0] as MediaResult | undefined;
    return media ? nativeImageResultToFile(media, prefix) : undefined;
  } catch (error) {
    if (isCancelled(error)) {
      return undefined;
    }
    try {
      const photo = await CapacitorCamera.getPhoto({
        quality: 88,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
      });
      return nativeImageResultToFile(photo, prefix);
    } catch (fallbackError) {
      if (isCancelled(fallbackError)) {
        return undefined;
      }
      throw fallbackError;
    }
  }
};
