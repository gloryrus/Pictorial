import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type FolderListing = {
  files: string[];
  index: number;
};

const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "avif", "tif", "tiff", "svg",
];

const VIDEO_EXTENSIONS = [
  "mp4", "m4v", "webm", "mov", "mkv", "avi", "mpg", "mpeg", "ogv", "3gp", "ts", "m2ts",
];

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function extensionOf(path: string) {
  return basename(path).split(".").pop()?.toLowerCase() || "";
}

function isImage(path: string) {
  return IMAGE_EXTENSIONS.includes(extensionOf(path));
}

function isVideo(path: string) {
  return VIDEO_EXTENSIONS.includes(extensionOf(path));
}

function samePath(a: string, b: string) {
  return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

export function useViewer() {
  const [files, setFiles] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  const filesRef = useRef(files);
  const indexRef = useRef(index);
  const refreshingRef = useRef(false);
  const preloadRef = useRef<Array<HTMLImageElement | HTMLVideoElement>>([]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const currentPath = files[index] ?? null;

  const readFolder = useCallback(async (path: string) => {
    return invoke<FolderListing>("list_folder_media", { path });
  }, []);

  const openPath = useCallback(async (path: string) => {
    const listing = await readFolder(path);
    setFiles(listing.files);
    setIndex(clampIndex(listing.index, listing.files.length));
  }, [readFolder]);

  const openDialog = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Media", extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] },
        { name: "Images", extensions: IMAGE_EXTENSIONS },
        { name: "Videos", extensions: VIDEO_EXTENSIONS },
      ],
    });

    if (typeof selected === "string") {
      await openPath(selected);
    }
  }, [openPath]);

  const refreshAndMove = useCallback(async (move: "current" | "next" | "prev" | "first" | "last") => {
    if (refreshingRef.current) return;

    const oldFiles = filesRef.current;
    const oldIndex = indexRef.current;
    const oldPath = oldFiles[oldIndex];

    if (!oldPath) {
      return;
    }

    refreshingRef.current = true;

    try {
      const listing = await readFolder(oldPath);
      const nextFiles = listing.files;

      if (nextFiles.length === 0) {
        setFiles([]);
        setIndex(0);
        return;
      }

      const foundIndex = nextFiles.findIndex((file) => samePath(file, oldPath));
      const baseIndex = foundIndex >= 0
        ? foundIndex
        : clampIndex(oldIndex, nextFiles.length);

      let nextIndex = baseIndex;

      switch (move) {
        case "next":
          nextIndex = (baseIndex + 1) % nextFiles.length;
          break;
        case "prev":
          nextIndex = (baseIndex - 1 + nextFiles.length) % nextFiles.length;
          break;
        case "first":
          nextIndex = 0;
          break;
        case "last":
          nextIndex = nextFiles.length - 1;
          break;
        case "current":
          nextIndex = baseIndex;
          break;
      }

      setFiles(nextFiles);
      setIndex(nextIndex);
    } catch {
      setIndex((currentIndex) => {
        const length = filesRef.current.length;
        if (length === 0) return 0;

        switch (move) {
          case "next": return (currentIndex + 1) % length;
          case "prev": return (currentIndex - 1 + length) % length;
          case "first": return 0;
          case "last": return length - 1;
          case "current": return currentIndex;
        }
      });
    } finally {
      refreshingRef.current = false;
    }
  }, [readFolder]);

  useEffect(() => {
    void invoke<string | null>("startup_file")
      .then((path) => {
        if (path) return openPath(path);
        return undefined;
      })
      .catch(() => undefined);
  }, [openPath]);

  const currentSrc = useMemo(
    () => (currentPath ? convertFileSrc(currentPath) : null),
    [currentPath],
  );

  const first = useCallback(() => {
    void refreshAndMove("first");
  }, [refreshAndMove]);

  const last = useCallback(() => {
    void refreshAndMove("last");
  }, [refreshAndMove]);

  const prev = useCallback(() => {
    void refreshAndMove("prev");
  }, [refreshAndMove]);

  const next = useCallback(() => {
    void refreshAndMove("next");
  }, [refreshAndMove]);

  const refresh = useCallback(() => {
    void refreshAndMove("current");
  }, [refreshAndMove]);

  useEffect(() => {
    if (!files.length) return;

    const preloaded: Array<HTMLImageElement | HTMLVideoElement> = [];

    [index + 1, index - 1].forEach((itemIndex) => {
      const path = files[(itemIndex + files.length) % files.length];
      if (!path) return;

      const src = convertFileSrc(path);

      if (isImage(path)) {
        const img = new Image();
        img.src = src;
        preloaded.push(img);
        return;
      }

      if (isVideo(path)) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.src = src;
        video.load();
        preloaded.push(video);
      }
    });

    preloadRef.current = preloaded;
  }, [files, index]);

  return {
    files,
    index,
    currentPath,
    currentSrc,
    fileName: currentPath ? basename(currentPath) : "",
    openDialog,
    refresh,
    first,
    last,
    prev,
    next,
  };
}
