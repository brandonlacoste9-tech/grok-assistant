/** Max images per message */
export const MAX_IMAGES = 4;

/** Longest edge after compression */
const MAX_EDGE = 1280;

/** JPEG quality 0–1 */
const JPEG_QUALITY = 0.82;

/** Soft cap per image after compress (~1.5MB base64-ish) */
const MAX_BYTES = 1_400_000;

export function isImageFile(file: File): boolean {
  return (
    file.type === "image/jpeg" ||
    file.type === "image/jpg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    /\.(jpe?g|png|webp)$/i.test(file.name)
  );
}

/**
 * Read a File and return a compressed JPEG data URL suitable for vision APIs.
 */
export async function fileToDataUrl(file: File): Promise<string> {
  if (!isImageFile(file)) {
    throw new Error("Use JPG, PNG, or WebP images.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Image is too large (max 20MB).");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process image");
    ctx.drawImage(bitmap, 0, 0, width, height);

    let quality = JPEG_QUALITY;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);

    // Shrink quality if still huge
    while (dataUrl.length > MAX_BYTES && quality > 0.45) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }

    if (dataUrl.length > MAX_BYTES * 1.4) {
      throw new Error("Image is still too large after compression. Try a smaller photo.");
    }

    return dataUrl;
  } finally {
    bitmap.close?.();
  }
}

function fitWithin(w: number, h: number, maxEdge: number) {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}
