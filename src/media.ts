export type MediaKind = "image" | "video";

export const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "avif", "tif", "tiff", "svg",
];

export const VIDEO_EXTENSIONS = [
  "mp4", "m4v", "webm", "mov", "mkv", "avi", "mpg", "mpeg", "ogv", "3gp", "ts", "m2ts",
];

export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
export const VIDEO_SPEEDS = [0.5, 1, 1.5, 2, 3] as const;
export const DEFAULT_VIDEO_SIZE = { w: 1280, h: 720 };

const VIDEO_EXTENSION_SET = new Set(VIDEO_EXTENSIONS);
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS);

export function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function extensionOf(path: string) {
  const clean = basename(path).split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

export function isImage(path: string) {
  return IMAGE_EXTENSION_SET.has(extensionOf(path));
}

export function isVideo(path: string) {
  return VIDEO_EXTENSION_SET.has(extensionOf(path));
}

export function mediaKindOf(path: string): MediaKind {
  return isVideo(path) ? "video" : "image";
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
