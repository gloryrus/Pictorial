import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useViewer } from "./useViewer";
import "./App.css";

import { DEFAULT_VIDEO_SIZE, formatTime, mediaKindOf, VIDEO_SPEEDS } from "./media";
import {
  clamp,
  distanceToRectSq,
  domRectToRect,
  HUD_HIDE_DELAY_MS,
  intersectRects,
  MAX_SCALE,
  MIN_SCALE,
  MIN_VISIBLE_EDGE,
  MONITOR_MARGIN,
  START_WINDOW_SIZE,
  unionRects,
  WHEEL_ZOOM_SPEED,
  ZOOM_EPS,
  ZOOM_SMOOTHING,
} from "./geometry";
import type { Geometry, Point, Rect, Size, View } from "./geometry";

type DragState = {
  pointerId: number;
  lastClient: Point;
  nextCenter: Point;
};

type ZoomAnchor = {
  cursor: Point;
  imagePoint: Point;
};

type ApplyMediaSizeOptions = {
  provisional?: boolean;
};

type OverlaySnapshot = {
  virtualRect: Rect;
  workAreas: Rect[];
  canvas: Size;
  view: View;
};

type VideoPreferences = {
  playbackRate: number;
  volume: number;
};

const VIDEO_PREFERENCES_STORAGE_KEY = "pictorial.videoPreferences";
const DEFAULT_VIDEO_PREFERENCES: VideoPreferences = {
  playbackRate: 1,
  volume: 1,
};

const isSupportedPlaybackRate = (rate: number): rate is typeof VIDEO_SPEEDS[number] => (
  VIDEO_SPEEDS.includes(rate as typeof VIDEO_SPEEDS[number])
);

const readVideoPreferences = (): VideoPreferences => {
  if (typeof window === "undefined") {
    return DEFAULT_VIDEO_PREFERENCES;
  }

  try {
    const storage = window.localStorage;
    const raw = storage.getItem(VIDEO_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_VIDEO_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<VideoPreferences> | null;
    const storedRate = parsed?.playbackRate;
    const storedVolume = parsed?.volume;

    return {
      playbackRate: typeof storedRate === "number" && isSupportedPlaybackRate(storedRate)
        ? storedRate
        : DEFAULT_VIDEO_PREFERENCES.playbackRate,
      volume: typeof storedVolume === "number" && Number.isFinite(storedVolume)
        ? clamp(storedVolume, 0, 1)
        : DEFAULT_VIDEO_PREFERENCES.volume,
    };
  } catch {
    return DEFAULT_VIDEO_PREFERENCES;
  }
};

const saveVideoPreferences = (preferences: VideoPreferences) => {
  if (typeof window === "undefined") return;

  try {
    const storage = window.localStorage;
    storage.setItem(
      VIDEO_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        playbackRate: preferences.playbackRate,
        volume: preferences.volume,
      }),
    );
  } catch {
    void 0;
  }
};

export default function App() {
  const v = useViewer();
  const [rotation, setRotation] = useState(0);
  const [natural, setNatural] = useState<Size | null>(null);
  const [canvas, setCanvas] = useState<Size>({ w: START_WINDOW_SIZE, h: START_WINDOW_SIZE });
  const [view, setView] = useState<View>({
    scale: 1,
    center: { x: START_WINDOW_SIZE / 2, y: START_WINDOW_SIZE / 2 },
  });
  const [isFs] = useState(false);
  const [locked, setLocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hudActive, setHudActive] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const initialVideoPreferences = useMemo(readVideoPreferences, []);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTime, setVideoTime] = useState(0);
  const [videoPaused, setVideoPaused] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(initialVideoPreferences.playbackRate);
  const [videoVolume, setVideoVolume] = useState(initialVideoPreferences.volume);
  const [videoError, setVideoError] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [layoutSource, setLayoutSource] = useState<string | null>(null);
  const [overlayReady, setOverlayReady] = useState(false);
  const [compactLock, setCompactLock] = useState(false);

  const winRef = useRef(getCurrentWindow());
  const sfRef = useRef(1);
  const virtualRectRef = useRef<Rect>({ x: 0, y: 0, w: START_WINDOW_SIZE, h: START_WINDOW_SIZE });
  const workAreasRef = useRef<Rect[]>([]);
  const canvasRef = useRef(canvas);
  const viewRef = useRef(view);
  const geometryRef = useRef<Geometry | null>(null);
  const targetScaleRef = useRef(1);
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const hudActiveRef = useRef(false);
  const hudHideTimerRef = useRef<number | null>(null);
  const overlayReadyRef = useRef(false);
  const compactLockRef = useRef(false);
  const overlaySnapshotRef = useRef<OverlaySnapshot | null>(null);
  const didPlaceFirstMediaRef = useRef(false);
  const regionRafRef = useRef<number | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaSizeCacheRef = useRef(new Map<string, Size>());
  const videoPreferencesRef = useRef(initialVideoPreferences);

  const mediaKind = useMemo(() => mediaKindOf(v.fileName), [v.fileName]);
  const isVideo = mediaKind === "video";

  const keepNativeFrameOff = useCallback((delays = [0, 80, 220]) => {
    for (const delay of delays) {
      window.setTimeout(() => {
        void invoke("disable_window_border").catch(() => undefined);
      }, delay);
    }
  }, []);

  useEffect(() => { canvasRef.current = canvas; }, [canvas]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { hudActiveRef.current = hudActive; }, [hudActive]);
  useEffect(() => { compactLockRef.current = compactLock; }, [compactLock]);

  const logicalWorkAreas = useCallback((): Rect[] => {
    const sf = sfRef.current || 1;
    const virtual = virtualRectRef.current;

    return workAreasRef.current.map((area) => ({
      x: (area.x - virtual.x) / sf + MONITOR_MARGIN,
      y: (area.y - virtual.y) / sf + MONITOR_MARGIN,
      w: Math.max(80, area.w / sf - MONITOR_MARGIN * 2),
      h: Math.max(80, area.h / sf - MONITOR_MARGIN * 2),
    }));
  }, []);

  const activeWorkArea = useCallback((logicalPoint?: Point): Rect | null => {
    const areas = logicalWorkAreas();
    if (!areas.length) return null;

    const point = logicalPoint ?? viewRef.current.center;
    let best = areas[0];
    let bestDistance = distanceToRectSq(point, best);

    for (const area of areas) {
      const d = distanceToRectSq(point, area);
      if (d < bestDistance) {
        best = area;
        bestDistance = d;
      }
    }

    return best;
  }, [logicalWorkAreas]);

  const makeGeometryFor = useCallback((size: Size, nextRotation = rotation, point?: Point): Geometry => {
    const rotated = nextRotation % 180 !== 0
      ? { w: size.h, h: size.w }
      : size;

    const area = activeWorkArea(point);
    const fitW = area ? area.w * 0.88 : window.screen.availWidth * 0.88;
    const fitH = area ? area.h * 0.88 : window.screen.availHeight * 0.88;
    const base = Math.min(fitW / rotated.w, fitH / rotated.h, 1);

    const image = {
      w: Math.max(1, size.w * base),
      h: Math.max(1, size.h * base),
    };

    const box = nextRotation % 180 !== 0
      ? { w: image.h, h: image.w }
      : { ...image };

    return { image, box };
  }, [activeWorkArea, rotation]);

  const geometry = useMemo<Geometry | null>(() => (
    natural ? makeGeometryFor(natural, rotation) : null
  ), [natural, rotation, makeGeometryFor]);

  useLayoutEffect(() => { geometryRef.current = geometry; }, [geometry]);

  const keepViewVisibleWithGeometry = useCallback((center: Point, scale: number, g: Geometry): Point => {
    const halfW = (g.box.w * scale) / 2;
    const halfH = (g.box.h * scale) / 2;
    const imageRect = {
      x: center.x - halfW,
      y: center.y - halfH,
      w: halfW * 2,
      h: halfH * 2,
    };

    const areas = logicalWorkAreas();
    const fallback = { x: 0, y: 0, ...canvasRef.current };
    let targetArea = areas[0] ?? fallback;
    let bestScore = -Infinity;

    for (const area of areas.length ? areas : [fallback]) {
      const intersection = intersectRects(imageRect, area);
      const score = intersection
        ? intersection.w * intersection.h
        : -distanceToRectSq(center, area);

      if (score > bestScore) {
        bestScore = score;
        targetArea = area;
      }
    }

    const visibleX = Math.min(MIN_VISIBLE_EDGE, Math.max(1, targetArea.w / 2));
    const visibleY = Math.min(MIN_VISIBLE_EDGE, Math.max(1, targetArea.h / 2));

    const minX = targetArea.x + visibleX - halfW;
    const maxX = targetArea.x + targetArea.w - visibleX + halfW;
    const minY = targetArea.y + visibleY - halfH;
    const maxY = targetArea.y + targetArea.h - visibleY + halfH;

    return {
      x: clamp(center.x, Math.min(minX, maxX), Math.max(minX, maxX)),
      y: clamp(center.y, Math.min(minY, maxY), Math.max(minY, maxY)),
    };
  }, [logicalWorkAreas]);

  const keepViewVisible = useCallback((center: Point, scale: number): Point => {
    const g = geometryRef.current;
    return g ? keepViewVisibleWithGeometry(center, scale, g) : center;
  }, [keepViewVisibleWithGeometry]);

  const setViewSafe = useCallback((next: View) => {
    const safe: View = geometryRef.current
      ? { ...next, center: keepViewVisible(next.center, next.scale) }
      : next;

    viewRef.current = safe;
    setView(safe);
  }, [keepViewVisible]);

  const mediaRectFor = useCallback((g = geometryRef.current, currentView = viewRef.current): Rect | null => {
    if (!g) return null;
    const w = Math.max(1, g.box.w * currentView.scale);
    const h = Math.max(1, g.box.h * currentView.scale);
    return {
      x: currentView.center.x - w / 2,
      y: currentView.center.y - h / 2,
      w,
      h,
    };
  }, []);

  const setNativeBounds = useCallback((rect: Rect, topmost: boolean) => {
    return invoke("set_window_bounds_clean", {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.w)),
      height: Math.max(1, Math.round(rect.h)),
      topmost,
    }).catch(() => undefined).finally(() => keepNativeFrameOff([0, 80, 220]));
  }, [keepNativeFrameOff]);

  const prepareStableOverlay = useCallback(async () => {
    const win = winRef.current;
    sfRef.current = await win.scaleFactor();

    const currentPosition = await win.outerPosition().catch(() => null);
    const currentSize = await win.outerSize().catch(() => null);
    const currentPhysicalCenter = currentPosition && currentSize
      ? { x: currentPosition.x + currentSize.width / 2, y: currentPosition.y + currentSize.height / 2 }
      : null;

    const monitors = await availableMonitors();
    const workAreas = monitors.map((m) => ({
      x: m.workArea.position.x,
      y: m.workArea.position.y,
      w: m.workArea.size.width,
      h: m.workArea.size.height,
    }));

    workAreasRef.current = workAreas;

    const union = unionRects(workAreas) ?? {
      x: 0,
      y: 0,
      w: Math.round(window.screen.availWidth * sfRef.current),
      h: Math.round(window.screen.availHeight * sfRef.current),
    };

    virtualRectRef.current = union;

    const logical = {
      w: Math.max(START_WINDOW_SIZE, Math.round(union.w / sfRef.current)),
      h: Math.max(START_WINDOW_SIZE, Math.round(union.h / sfRef.current)),
    };

    const startupArea = workAreas.length
      ? workAreas.reduce((best, area) => {
          const point = currentPhysicalCenter ?? {
            x: area.x + area.w / 2,
            y: area.y + area.h / 2,
          };
          return distanceToRectSq(point, area) < distanceToRectSq(point, best) ? area : best;
        }, workAreas[0])
      : union;

    const startupCenter = {
      x: (startupArea.x + startupArea.w / 2 - union.x) / sfRef.current,
      y: (startupArea.y + startupArea.h / 2 - union.y) / sfRef.current,
    };

    viewRef.current = { ...viewRef.current, center: startupCenter };
    setView((current) => ({ ...current, center: startupCenter }));

    await invoke("disable_window_border").catch(() => undefined);
    await win.setPosition(new PhysicalPosition(Math.round(union.x), Math.round(union.y)));
    await win.setSize(new LogicalSize(logical.w, logical.h));
    keepNativeFrameOff();

    canvasRef.current = logical;
    setCanvas(logical);
    overlayReadyRef.current = true;
    setOverlayReady(true);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await win.show().catch(() => undefined);
    keepNativeFrameOff();
  }, [keepNativeFrameOff]);

  const centerOnActiveMonitor = useCallback((): Point => {
    const area = activeWorkArea();
    if (area) {
      return {
        x: area.x + area.w / 2,
        y: area.y + area.h / 2,
      };
    }

    const c = canvasRef.current;
    return { x: c.w / 2, y: c.h / 2 };
  }, [activeWorkArea]);

  const fitCurrentImage = useCallback((scale = 1) => {
    if (!geometryRef.current) return;

    const nextScale = clamp(scale, MIN_SCALE, MAX_SCALE);
    targetScaleRef.current = nextScale;
    anchorRef.current = null;

    setViewSafe({
      scale: nextScale,
      center: centerOnActiveMonitor(),
    });
  }, [centerOnActiveMonitor, setViewSafe]);

  const activateHud = useCallback(() => {
    if (locked || v.files.length === 0) return;

    if (hudHideTimerRef.current !== null) {
      window.clearTimeout(hudHideTimerRef.current);
      hudHideTimerRef.current = null;
    }

    if (!hudActiveRef.current) {
      hudActiveRef.current = true;
      setHudActive(true);
    }
  }, [locked, v.files.length]);

  const hideHudSoon = useCallback(() => {
    if (hudHideTimerRef.current !== null) {
      window.clearTimeout(hudHideTimerRef.current);
    }

    hudHideTimerRef.current = window.setTimeout(() => {
      hudHideTimerRef.current = null;
      if (dragRef.current) return;
      hudActiveRef.current = false;
      setHudActive(false);
    }, HUD_HIDE_DELAY_MS);
  }, []);

  const hasCurrentLayout = Boolean(geometry && v.currentSrc && layoutSource === v.currentSrc);
  const mediaLayoutReady = hasCurrentLayout && (mediaReady || didPlaceFirstMediaRef.current);
  const showHud = v.files.length > 0 && !locked && mediaLayoutReady && (hudActive || dragging || menu !== null);

  const applyHitRegionNow = useCallback(() => {
    const sf = sfRef.current || 1;
    const c = canvasRef.current;
    const canvasRect: Rect = { x: 0, y: 0, w: c.w, h: c.h };
    const rects: Rect[] = [];
    const g = geometryRef.current;
    const currentView = viewRef.current;

    if (compactLockRef.current && g && v.currentSrc && layoutSource === v.currentSrc) {
      rects.push(canvasRect);
    } else if (g && v.currentSrc && layoutSource === v.currentSrc) {
      const mediaRect = mediaRectFor(g, currentView);
      const imageRect = mediaRect ? intersectRects(mediaRect, canvasRect) : null;
      if (imageRect) rects.push(imageRect);
    } else if (overlayReadyRef.current && openButtonRef.current) {
      const openRect = intersectRects(domRectToRect(openButtonRef.current.getBoundingClientRect()), canvasRect);
      if (openRect) rects.push(openRect);
    } else {
      rects.push(canvasRect);
    }

    if (showHud && hudRef.current) {
      const hudRect = intersectRects(domRectToRect(hudRef.current.getBoundingClientRect()), canvasRect);
      if (hudRect) rects.push(hudRect);
    }

    if (menu && menuRef.current) {
      const menuRect = intersectRects(domRectToRect(menuRef.current.getBoundingClientRect()), canvasRect);
      if (menuRect) rects.push(menuRect);
    }

    const physicalRects = rects.map((r) => ({
      x: Math.floor(r.x * sf),
      y: Math.floor(r.y * sf),
      w: Math.max(1, Math.ceil(r.w * sf)),
      h: Math.max(1, Math.ceil(r.h * sf)),
    }));

    void invoke("set_window_hit_regions", { rects: physicalRects }).catch(() => undefined);
  }, [layoutSource, mediaRectFor, menu, showHud, v.currentSrc]);

  const scheduleHitRegion = useCallback(() => {
    if (regionRafRef.current !== null) cancelAnimationFrame(regionRafRef.current);

    regionRafRef.current = requestAnimationFrame(() => {
      regionRafRef.current = null;
      applyHitRegionNow();
    });
  }, [applyHitRegionNow]);

  const refreshWindowShape = useCallback((delays = [0, 32, 120, 300]) => {
    for (const delay of delays) {
      window.setTimeout(() => {
        void invoke("disable_window_border").catch(() => undefined);
        scheduleHitRegion();
      }, delay);
    }
  }, [scheduleHitRegion]);

  useEffect(() => {
    scheduleHitRegion();
  }, [canvas, view, geometry, showHud, menu, v.currentSrc, layoutSource, overlayReady, scheduleHitRegion]);

  useEffect(() => {
    const refresh = () => refreshWindowShape();
    const onVisibilityChange = () => {
      if (!document.hidden) refresh();
    };

    window.addEventListener("focus", refresh, true);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("resize", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", refresh, true);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("resize", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshWindowShape]);

  useEffect(() => {
    void prepareStableOverlay();

    return () => {
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
      if (dragRafRef.current !== null) cancelAnimationFrame(dragRafRef.current);
      if (regionRafRef.current !== null) cancelAnimationFrame(regionRafRef.current);
      if (hudHideTimerRef.current !== null) window.clearTimeout(hudHideTimerRef.current);
      void invoke("set_window_hit_regions", { rects: [] }).catch(() => undefined);
    };
  }, [prepareStableOverlay]);

  useLayoutEffect(() => {
    if (!geometry || !overlayReadyRef.current || !v.currentSrc || layoutSource !== v.currentSrc) return;

    const current = viewRef.current;
    const nextScale = clamp(targetScaleRef.current || current.scale, MIN_SCALE, MAX_SCALE);
    const nextCenter = keepViewVisibleWithGeometry(current.center, nextScale, geometry);

    if (
      Math.abs(nextScale - current.scale) > ZOOM_EPS ||
      Math.abs(nextCenter.x - current.center.x) > 0.5 ||
      Math.abs(nextCenter.y - current.center.y) > 0.5
    ) {
      const safe = { scale: nextScale, center: nextCenter };
      viewRef.current = safe;
      setView(safe);
    }
  }, [geometry, keepViewVisibleWithGeometry, layoutSource, v.currentSrc]);

  const zoomAnimationStep = useCallback(() => {
    zoomRafRef.current = null;

    const current = viewRef.current;
    const target = clamp(targetScaleRef.current, MIN_SCALE, MAX_SCALE);
    const diff = target - current.scale;
    const nextScale = Math.abs(diff) < ZOOM_EPS ? target : current.scale + diff * ZOOM_SMOOTHING;

    let nextCenter = current.center;
    const anchor = anchorRef.current;

    if (anchor) {
      nextCenter = {
        x: anchor.cursor.x - anchor.imagePoint.x * nextScale,
        y: anchor.cursor.y - anchor.imagePoint.y * nextScale,
      };
    }

    setViewSafe({ scale: nextScale, center: nextCenter });

    if (Math.abs(target - nextScale) >= ZOOM_EPS) {
      zoomRafRef.current = requestAnimationFrame(zoomAnimationStep);
    } else {
      anchorRef.current = null;
    }
  }, [setViewSafe]);

  const startZoomAnimation = useCallback(() => {
    if (zoomRafRef.current === null) {
      zoomRafRef.current = requestAnimationFrame(zoomAnimationStep);
    }
  }, [zoomAnimationStep]);

  const zoomBy = useCallback((factor: number, cursor?: Point) => {
    if (locked || isFs || !geometryRef.current) return;

    const current = viewRef.current;
    const point = cursor ?? current.center;

    anchorRef.current = {
      cursor: point,
      imagePoint: {
        x: (point.x - current.center.x) / current.scale,
        y: (point.y - current.center.y) / current.scale,
      },
    };

    targetScaleRef.current = clamp(targetScaleRef.current * factor, MIN_SCALE, MAX_SCALE);
    startZoomAnimation();
  }, [locked, isFs, startZoomAnimation]);

  const reset = useCallback(() => {
    setRotation(0);
    fitCurrentImage(1);
  }, [fitCurrentImage]);

  const toggleLock = useCallback(async () => {
    const next = !locked;

    if (next) {
      const mediaRect = mediaRectFor();
      const g = geometryRef.current;
      const currentView = viewRef.current;

      if (mediaRect && g) {
        overlaySnapshotRef.current = {
          virtualRect: { ...virtualRectRef.current },
          workAreas: [...workAreasRef.current],
          canvas: { ...canvasRef.current },
          view: { scale: currentView.scale, center: { ...currentView.center } },
        };

        const sf = sfRef.current || 1;
        const nativeRect = {
          x: virtualRectRef.current.x + mediaRect.x * sf,
          y: virtualRectRef.current.y + mediaRect.y * sf,
          w: mediaRect.w * sf,
          h: mediaRect.h * sf,
        };
        const compactCanvas = { w: mediaRect.w, h: mediaRect.h };
        const compactView = {
          scale: currentView.scale,
          center: { x: mediaRect.w / 2, y: mediaRect.h / 2 },
        };

        compactLockRef.current = true;
        setCompactLock(true);
        virtualRectRef.current = nativeRect;
        canvasRef.current = compactCanvas;
        viewRef.current = compactView;
        setCanvas(compactCanvas);
        setView(compactView);
        await setNativeBounds(nativeRect, true);
      } else {
        await invoke("set_window_topmost_clean", { topmost: true }).catch(() => undefined);
      }

      dragRef.current = null;
      hudActiveRef.current = false;
      setDragging(false);
      setHudActive(false);
      setLocked(true);
      setMenu(null);
      scheduleHitRegion();
      keepNativeFrameOff([0, 80, 200, 420]);
      return;
    }

    const snapshot = overlaySnapshotRef.current;
    overlaySnapshotRef.current = null;
    compactLockRef.current = false;
    setCompactLock(false);
    setLocked(false);
    setMenu(null);

    if (snapshot) {
      virtualRectRef.current = { ...snapshot.virtualRect };
      workAreasRef.current = [...snapshot.workAreas];
      canvasRef.current = { ...snapshot.canvas };
      viewRef.current = { scale: snapshot.view.scale, center: { ...snapshot.view.center } };
      setCanvas(snapshot.canvas);
      setView(snapshot.view);
      await setNativeBounds(snapshot.virtualRect, false);
    } else {
      await invoke("set_window_topmost_clean", { topmost: false }).catch(() => undefined);
    }

    scheduleHitRegion();
    keepNativeFrameOff([0, 80, 200, 420]);
  }, [keepNativeFrameOff, locked, mediaRectFor, scheduleHitRegion, setNativeBounds]);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    activateHud();
    if (locked) return;

    if (!e.ctrlKey) {
      if (!dragging) e.deltaY < 0 ? v.prev() : v.next();
      return;
    }

    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED);
    zoomBy(factor, { x: e.clientX, y: e.clientY });
  };

  const scheduleDrag = useCallback(() => {
    if (dragRafRef.current !== null) return;

    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      const drag = dragRef.current;
      if (!drag) return;
      setViewSafe({ ...viewRef.current, center: drag.nextCenter });
    });
  }, [setViewSafe]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    activateHud();
    if (menu) setMenu(null);
    if (e.button !== 0 || locked) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    dragRef.current = {
      pointerId: e.pointerId,
      lastClient: { x: e.clientX, y: e.clientY },
      nextCenter: { ...viewRef.current.center },
    };

    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    activateHud();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    e.preventDefault();

    const dx = e.clientX - drag.lastClient.x;
    const dy = e.clientY - drag.lastClient.y;
    drag.lastClient = { x: e.clientX, y: e.clientY };
    drag.nextCenter = {
      x: drag.nextCenter.x + dx,
      y: drag.nextCenter.y + dy,
    };

    scheduleDrag();
  };

  const stopDrag = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e && dragRef.current?.pointerId === e.pointerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { void 0; }
    }

    dragRef.current = null;
    setDragging(false);
    hideHudSoon();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    activateHud();
    stopDrag();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const applyNewMediaSize = useCallback((size: Size, options: ApplyMediaSizeOptions = {}) => {
    const firstMedia = !didPlaceFirstMediaRef.current;
    const scale = 1;
    const rawCenter = firstMedia ? centerOnActiveMonitor() : viewRef.current.center;
    const nextGeometry = makeGeometryFor(size, 0, rawCenter);
    const nextView = {
      scale,
      center: keepViewVisibleWithGeometry(rawCenter, scale, nextGeometry),
    };

    didPlaceFirstMediaRef.current = true;
    targetScaleRef.current = scale;
    anchorRef.current = null;
    geometryRef.current = nextGeometry;
    viewRef.current = nextView;

    setRotation(0);
    setView(nextView);
    setNatural(size);
    setLayoutSource(v.currentSrc ?? null);
    setMediaReady(!options.provisional);
  }, [centerOnActiveMonitor, keepViewVisibleWithGeometry, makeGeometryFor, v.currentSrc]);

  useEffect(() => {
    setVideoDuration(0);
    setVideoTime(0);
    setVideoPaused(true);
    setVideoError(false);
    setMediaReady(false);
    setLayoutSource(null);

    if (!v.currentSrc) {
      setNatural(null);
      didPlaceFirstMediaRef.current = false;
      return;
    }

    const cachedSize = v.currentPath ? mediaSizeCacheRef.current.get(v.currentPath) : undefined;

    if (cachedSize) {
      applyNewMediaSize(cachedSize, { provisional: true });
      return;
    }

    if (isVideo) {
      applyNewMediaSize(DEFAULT_VIDEO_SIZE, { provisional: true });
    }
  }, [applyNewMediaSize, isVideo, v.currentPath, v.currentSrc]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = { w: img.naturalWidth, h: img.naturalHeight };
    if (v.currentPath) mediaSizeCacheRef.current.set(v.currentPath, size);
    applyNewMediaSize(size);
  };

  const onVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    video.playbackRate = playbackRate;
    video.volume = videoVolume;
    const size = {
      w: video.videoWidth || DEFAULT_VIDEO_SIZE.w,
      h: video.videoHeight || DEFAULT_VIDEO_SIZE.h,
    };
    if (v.currentPath) mediaSizeCacheRef.current.set(v.currentPath, size);
    setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setVideoTime(video.currentTime || 0);
    setVideoPaused(video.paused);
    applyNewMediaSize(size);
  };

  const onVideoTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setVideoTime(e.currentTarget.currentTime || 0);
  };

  const toggleVideoPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || locked) return;

    if (video.paused) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [locked]);

  const seekVideo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(time)) return;

    video.currentTime = clamp(time, 0, Number.isFinite(video.duration) ? video.duration : time);
    setVideoTime(video.currentTime);
  }, []);

  const changePlaybackRate = useCallback((rate: number) => {
    const nextRate = isSupportedPlaybackRate(rate) ? rate : DEFAULT_VIDEO_PREFERENCES.playbackRate;
    const nextPreferences = { ...videoPreferencesRef.current, playbackRate: nextRate };
    videoPreferencesRef.current = nextPreferences;
    setPlaybackRate(nextRate);
    saveVideoPreferences(nextPreferences);

    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
  }, []);

  const changeVideoVolume = useCallback((volume: number) => {
    const nextVolume = clamp(volume, 0, 1);
    const nextPreferences = { ...videoPreferencesRef.current, volume: nextVolume };
    videoPreferencesRef.current = nextPreferences;
    setVideoVolume(nextVolume);
    saveVideoPreferences(nextPreferences);

    if (videoRef.current) {
      videoRef.current.volume = nextVolume;
    }
  }, []);

  useEffect(() => {
    const zoomInKeys = ["Equal", "NumpadAdd"];
    const zoomOutKeys = ["Minus", "NumpadSubtract"];
    const resetKeys = ["Digit0", "Numpad0"];
    const zoomKeys = [...zoomInKeys, ...zoomOutKeys, ...resetKeys];

    const blockKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const onKey = (e: KeyboardEvent) => {
      const isFunctionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(e.code);
      const hasModifier = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
      const isAllowedCtrlZoom = e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && zoomKeys.includes(e.code);

      if (isFunctionKey || (hasModifier && !isAllowedCtrlZoom)) {
        blockKey(e);
        return;
      }

      if (locked) {
        if (e.code === "Escape") setMenu(null);
        blockKey(e);
        return;
      }

      switch (e.code) {
        case "ArrowRight":
          e.preventDefault();
          v.next();
          break;

        case "ArrowLeft":
          e.preventDefault();
          v.prev();
          break;

        case "Home":
          e.preventDefault();
          v.first();
          break;

        case "End":
          e.preventDefault();
          v.last();
          break;

        case "KeyR":
          e.preventDefault();
          setRotation((r) => (r + 90) % 360);
          break;

        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          zoomBy(1.14);
          break;

        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          zoomBy(1 / 1.14);
          break;

        case "Digit0":
        case "Numpad0":
          e.preventDefault();
          reset();
          break;

        case "Space":
          if (isVideo) {
            e.preventDefault();
            toggleVideoPlay();
          }
          break;

        case "Escape":
          e.preventDefault();
          setMenu(null);
          stopDrag();
          break;
      }
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [v, locked, reset, zoomBy, isVideo, toggleVideoPlay]);

  const stageStyle: React.CSSProperties | undefined = geometry ? {
    width: `${geometry.box.w}px`,
    height: `${geometry.box.h}px`,
    left: `${view.center.x}px`,
    top: `${view.center.y}px`,
    transform: `translate(-50%, -50%) scale(${view.scale})`,
  } : undefined;

  const imageStyle: React.CSSProperties | undefined = geometry ? {
    width: `${geometry.image.w}px`,
    height: `${geometry.image.h}px`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  } : undefined;

  const hiddenStageStyle: React.CSSProperties = {
    width: "1px",
    height: "1px",
    left: `${view.center.x}px`,
    top: `${view.center.y}px`,
    transform: "translate(-50%, -50%)",
    visibility: "hidden",
  };

  const hiddenMediaStyle: React.CSSProperties = {
    width: "1px",
    height: "1px",
    transform: "translate(-50%, -50%)",
    visibility: "hidden",
  };

  const openArea = activeWorkArea(view.center);
  const openButtonStyle: React.CSSProperties = {
    left: `${openArea ? openArea.x + openArea.w / 2 : canvas.w / 2}px`,
    top: `${openArea ? openArea.y + openArea.h / 2 : canvas.h / 2}px`,
    visibility: overlayReady ? "visible" : "hidden",
  };

  const hudHeightGuess = isVideo ? 108 : 52;

  const hudStyle: React.CSSProperties | undefined = geometry ? {
    left: `${clamp(view.center.x, 12, Math.max(12, canvas.w - 12))}px`,
    top: `${clamp(
      view.center.y + (geometry.box.h * view.scale) / 2 + 12,
      12,
      Math.max(12, canvas.h - hudHeightGuess),
    )}px`,
    bottom: "auto",
    transform: "translateX(-50%)",
  } : undefined;

  const menuStyle = menu ? { left: menu.x, top: menu.y } : undefined;
  const viewerClass = ["viewer", dragging ? "dragging" : "", locked ? "locked" : "", compactLock ? "compact-lock" : ""].filter(Boolean).join(" ");

  return (
    <div
      className={viewerClass}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onPointerEnter={activateHud}
      onPointerLeave={() => {
        if (!dragRef.current) hideHudSoon();
      }}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseLeave={() => setMenu(null)}
    >
      {v.currentSrc ? (
        <div className={`image-stage ${hasCurrentLayout ? "" : "media-loading"}`} style={hasCurrentLayout ? stageStyle : hiddenStageStyle}>
          {isVideo ? (
            <video
              ref={videoRef}
              className="image media-video"
              src={v.currentSrc}
              draggable={false}
              style={hasCurrentLayout ? imageStyle : hiddenMediaStyle}
              playsInline
              autoPlay
              loop
              preload="auto"
              onLoadedMetadata={onVideoLoadedMetadata}
              onDurationChange={(e) => setVideoDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
              onTimeUpdate={onVideoTimeUpdate}
              onPlay={() => setVideoPaused(false)}
              onPause={() => setVideoPaused(true)}
              onError={() => setVideoError(true)}
              onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            />
          ) : (
            <img
              className="image"
              src={v.currentSrc}
              alt={v.fileName}
              draggable={false}
              style={hasCurrentLayout ? imageStyle : hiddenMediaStyle}
              onLoad={onImgLoad}
            />
          )}
          {isVideo && videoError && (
            <div className="video-error">Формат не поддерживается WebView2 или системой</div>
          )}
        </div>
      ) : (
        <button
          ref={openButtonRef}
          className="open-btn"
          style={openButtonStyle}
          onClick={v.openDialog}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          Открыть изображение
        </button>
      )}

      {v.files.length > 0 && mediaLayoutReady && (
        <div
          ref={hudRef}
          className={`hud ${showHud ? "visible" : ""}`}
          style={hudStyle}
          onPointerEnter={activateHud}
          onPointerMove={activateHud}
          onPointerLeave={hideHudSoon}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="hud-main">
            <button disabled={locked} onClick={() => { if (!locked) v.prev(); }}>‹</button>
            <span>{v.index + 1}/{v.files.length} · {v.fileName}</span>
            <button disabled={locked} onClick={() => { if (!locked) v.next(); }}>›</button>
          </div>

          {isVideo && (
            <div className="video-controls">
              <button
                className="play-btn"
                disabled={locked}
                onClick={toggleVideoPlay}
                title={videoPaused ? "Воспроизвести" : "Пауза"}
              >
                {videoPaused ? "▶" : "⏸"}
              </button>
              <span className="video-time">{formatTime(videoTime)}</span>
              <input
                className="video-seek"
                type="range"
                min={0}
                max={videoDuration || 0}
                step={0.05}
                value={Math.min(videoTime, videoDuration || 0)}
                disabled={locked || !videoDuration}
                onChange={(e) => seekVideo(Number(e.currentTarget.value))}
              />
              <span className="video-time">{formatTime(videoDuration)}</span>
              <select
                className="speed-select"
                value={playbackRate}
                disabled={locked}
                onChange={(e) => changePlaybackRate(Number(e.currentTarget.value))}
                title="Скорость"
              >
                {VIDEO_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>{speed}x</option>
                ))}
              </select>
              <span className="volume-label">Громкость</span>
              <input
                className="volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={videoVolume}
                disabled={locked}
                onChange={(e) => changeVideoVolume(Number(e.currentTarget.value))}
                title="Громкость"
              />
            </div>
          )}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="ctx-menu"
          style={menuStyle}
          onPointerEnter={activateHud}
          onPointerMove={activateHud}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={toggleLock}>
            {locked ? "Открепить окно" : "Закрепить поверх окон"}
          </button>
          <button onClick={() => winRef.current.close()}>
            Закрыть
          </button>
        </div>
      )}
    </div>
  );
}
