import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { basename, IMAGE_EXTENSIONS, isImage, isVideo, MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from "./media";

type FolderListing = {
  files: string[];
  index: number;
};

type Move = "current" | "next" | "prev" | "first" | "last";

function samePath(a: string, b: string) {
  return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
}

function clampIndex(index: number, length: number) {
  return length <= 0 ? 0 : Math.min(Math.max(index, 0), length - 1);
}

function moveIndex(move: Move, index: number, length: number) {
  if (length <= 0) return 0;

  switch (move) {
    case "next": return (index + 1) % length;
    case "prev": return (index - 1 + length) % length;
    case "first": return 0;
    case "last": return length - 1;
    case "current": return index;
  }
}

export function useViewer() {
  const [files, setFiles] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  const filesRef = useRef(files);
  const indexRef = useRef(index);
  const refreshingRef = useRef(false);
  const preloadRef = useRef<Array<HTMLImageElement | HTMLVideoElement>>([]);

  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { indexRef.current = index; }, [index]);

  const currentPath = files[index] ?? null;

  const readFolder = useCallback((path: string) => {
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
        { name: "Media", extensions: MEDIA_EXTENSIONS },
        { name: "Images", extensions: IMAGE_EXTENSIONS },
        { name: "Videos", extensions: VIDEO_EXTENSIONS },
      ],
    });

    if (typeof selected === "string") await openPath(selected);
  }, [openPath]);

  const refreshAndMove = useCallback(async (move: Move) => {
    if (refreshingRef.current) return;

    const oldFiles = filesRef.current;
    const oldIndex = indexRef.current;
    const oldPath = oldFiles[oldIndex];
    if (!oldPath) return;

    refreshingRef.current = true;

    try {
      const listing = await readFolder(oldPath);
      const nextFiles = listing.files;

      if (!nextFiles.length) {
        setFiles([]);
        setIndex(0);
        return;
      }

      const foundIndex = nextFiles.findIndex((file) => samePath(file, oldPath));
      const baseIndex = foundIndex >= 0 ? foundIndex : clampIndex(oldIndex, nextFiles.length);

      setFiles(nextFiles);
      setIndex(moveIndex(move, baseIndex, nextFiles.length));
    } catch {
      setIndex((currentIndex) => moveIndex(move, currentIndex, filesRef.current.length));
    } finally {
      refreshingRef.current = false;
    }
  }, [readFolder]);

  useEffect(() => {
    void invoke<string | null>("startup_file")
      .then((path) => (path ? openPath(path) : undefined))
      .catch(() => undefined);
  }, [openPath]);

  useEffect(() => {
    if (!files.length) return;

    preloadRef.current = [index + 1, index - 1]
      .map((itemIndex) => files[(itemIndex + files.length) % files.length])
      .filter(Boolean)
      .map((path) => {
        const src = convertFileSrc(path);

        if (isImage(path)) {
          const img = new Image();
          img.src = src;
          return img;
        }

        if (isVideo(path)) {
          const video = document.createElement("video");
          video.preload = "metadata";
          video.muted = true;
          video.src = src;
          video.load();
          return video;
        }

        return null;
      })
      .filter((item): item is HTMLImageElement | HTMLVideoElement => item !== null);
  }, [files, index]);

  const currentSrc = useMemo(
    () => (currentPath ? convertFileSrc(currentPath) : null),
    [currentPath],
  );

  return {
    files,
    index,
    currentPath,
    currentSrc,
    fileName: currentPath ? basename(currentPath) : "",
    openDialog,
    refresh: () => void refreshAndMove("current"),
    first: () => void refreshAndMove("first"),
    last: () => void refreshAndMove("last"),
    prev: () => void refreshAndMove("prev"),
    next: () => void refreshAndMove("next"),
  };
}
