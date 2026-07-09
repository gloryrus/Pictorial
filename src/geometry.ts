import type React from "react";

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = Point & Size;
export type Geometry = { image: Size; box: Size };
export type View = { scale: number; center: Point };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 48;
export const START_WINDOW_SIZE = 360;
export const WHEEL_ZOOM_SPEED = 0.0012;
export const ZOOM_SMOOTHING = 0.32;
export const ZOOM_EPS = 0.0015;
export const MONITOR_MARGIN = 8;
export const MIN_VISIBLE_EDGE = 48;
export const HUD_HIDE_DELAY_MS = 450;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function distanceToRectSq(point: Point, rect: Rect) {
  const x = clamp(point.x, rect.x, rect.x + rect.w);
  const y = clamp(point.y, rect.y, rect.y + rect.h);
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;

  const bounds = rects.reduce(
    (acc, rect) => ({
      minX: Math.min(acc.minX, rect.x),
      minY: Math.min(acc.minY, rect.y),
      maxX: Math.max(acc.maxX, rect.x + rect.w),
      maxY: Math.max(acc.maxY, rect.y + rect.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  return {
    x: bounds.minX,
    y: bounds.minY,
    w: bounds.maxX - bounds.minX,
    h: bounds.maxY - bounds.minY,
  };
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);

  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

export function domRectToRect(rect: DOMRect): Rect {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

export function pixelStyle(value: number) {
  return `${value}px`;
}

export function stopReactEvent(e: Pick<React.SyntheticEvent, "preventDefault" | "stopPropagation">) {
  e.preventDefault();
  e.stopPropagation();
}
