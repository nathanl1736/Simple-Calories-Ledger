/** Keeps small print (labels, menus) legible for Gemini; ~300-600 KB per photo. */
export const SHARP_PHOTO_OPTIONS = { maxWidth: Infinity, maxSide: 1800, quality: 0.82 };

/**
 * Re-encodes a photo as JPEG. Food photos only need to be ~1000px wide; a menu
 * needs its small print legible, so callers can cap the longer side instead.
 */
export async function compressImage(
  file?: File | null,
  { maxWidth = 1000, maxSide = Infinity, quality = 0.72 }: { maxWidth?: number; maxSide?: number; quality?: number } = {}
) {
  if (!file) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image'));
    image.src = dataUrl;
  });
  const scale = Math.min(1, maxWidth / img.width, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
}
