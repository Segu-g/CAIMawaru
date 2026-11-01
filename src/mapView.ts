// 配置図の表示範囲（拡大縮小・移動）の計算。
// 表示範囲は中心 (cx, cy) と幅 w で持ち、高さは表示領域の縦横比から決める。

export type View = { cx: number; cy: number; w: number };
export type Size = { w: number; h: number };
export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; w: number; h: number };

export const MIN_W = 200;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 全体が収まる幅（これ以上は縮小しない）
export function fitWidth(bounds: Bounds, size: Size): number {
  return Math.max(bounds.w, (bounds.h * size.w) / size.h);
}

export function fitView(bounds: Bounds, size: Size): View {
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, w: fitWidth(bounds, size) };
}

// 中心が描画範囲の外へ出ないようにし、幅を上下限に収める
export function clampView(v: View, bounds: Bounds, size: Size): View {
  const w = clamp(v.w, MIN_W, fitWidth(bounds, size));
  return {
    w,
    cx: clamp(v.cx, bounds.x, bounds.x + bounds.w),
    cy: clamp(v.cy, bounds.y, bounds.y + bounds.h),
  };
}

export function viewBox(v: View, size: Size): string {
  const h = size.w > 0 ? (v.w * size.h) / size.w : v.w;
  return `${v.cx - v.w / 2} ${v.cy - h / 2} ${v.w} ${h}`;
}

// 表示領域内のピクセル座標 → 配置図座標
export function toMap(v: View, size: Size, px: Point): Point {
  const k = v.w / size.w;
  return { x: v.cx + (px.x - size.w / 2) * k, y: v.cy + (px.y - size.h / 2) * k };
}

// 配置図上の点 anchor がピクセル座標 px に来るような表示範囲（ドラッグ・ピンチ用）
export function anchorView(anchor: Point, px: Point, w: number, size: Size): View {
  const k = w / size.w;
  return { w, cx: anchor.x - (px.x - size.w / 2) * k, cy: anchor.y - (px.y - size.h / 2) * k };
}

// ピクセル座標 px を固定したまま factor 倍に拡大
export function zoomAt(v: View, size: Size, factor: number, px: Point): View {
  return anchorView(toMap(v, size, px), px, v.w / factor, size);
}
