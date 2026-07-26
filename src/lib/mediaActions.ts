/** Fetch an image src (http or data URL) as a Blob. */
export async function srcToBlob(src: string): Promise<Blob> {
  if (src.startsWith("data:")) {
    const [header, b64] = src.split(",");
    const mime = /data:([^;]+)/.exec(header)?.[1] || "image/jpeg";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  const res = await fetch(src, { mode: "cors" });
  if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
  return await res.blob();
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

/** Trigger a file download for an image src. */
export async function downloadImage(
  src: string,
  filenameBase = "grok-imagine"
): Promise<void> {
  const blob = await srcToBlob(src);
  const ext = extFromMime(blob.type || "image/jpeg");
  const name = `${filenameBase}-${Date.now()}.${ext}`;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

/** Copy image to clipboard (PNG preferred). Falls back to copying the URL/text. */
export async function copyImage(src: string): Promise<"image" | "url"> {
  const blob = await srcToBlob(src);

  // Clipboard image API needs a PNG blob in most browsers
  let pngBlob = blob;
  if (!blob.type.includes("png")) {
    pngBlob = await blobToPng(blob);
  }

  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          [pngBlob.type || "image/png"]: pngBlob,
        }),
      ]);
      return "image";
    } catch {
      // fall through — some browsers only allow text in insecure contexts
    }
  }

  // Fallback: copy URL or data-URL prefix note
  const text = src.startsWith("data:")
    ? "Grok Imagine image (use Download — clipboard image not supported here)"
    : src;
  await navigator.clipboard.writeText(text);
  return "url";
}

async function blobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
        "image/png"
      );
    });
  } finally {
    bitmap.close?.();
  }
}

/** Open image in a new tab when possible. */
export function openImage(src: string) {
  if (src.startsWith("data:")) {
    // data URLs as window location can be huge; open blob URL instead
    void srcToBlob(src).then((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
    return;
  }
  window.open(src, "_blank", "noopener,noreferrer");
}
