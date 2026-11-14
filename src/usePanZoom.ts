import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { anchorView, clampView, fitView, toMap, zoomAt, type Bounds, type Point, type Size, type View } from './mapView';

const TAP_SLOP = 8; // これ以上動いたらタップではなくドラッグ
const DOUBLE_TAP_MS = 300;

type Gesture = {
  anchor: Point; // 配置図上で掴んでいる点
  startW: number;
  startDist: number;
  startPx: Point;
  moved: boolean;
};

/**
 * 配置図（描き起こし・画像）の拡大縮小と移動。2本指で拡大縮小・1本指で移動・ダブルタップで拡大、PC はホイール。
 * bounds は移動できる範囲、initial は最初に収める範囲。1回のタップ（ダブルタップでないもの）は onTap に渡す。
 * 返す handlers を wrapRef の要素に付ける。.map-tools・.map-chip・.map-switch の中の操作は拾わない。
 */
export function usePanZoom(bounds: Bounds, initial: Bounds, onTap?: (e: PointerEvent<HTMLDivElement>) => void) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>();
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>(undefined);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });

  // タブ切り替えで非表示→表示になったときもサイズを取り直す
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ready = size.w > 0 && size.h > 0;
  useEffect(() => {
    if (ready && !view) setView(fitView(initial, size));
  }, [ready, view, size]);

  const apply = useCallback((v: View) => setView(clampView(v, bounds, size)), [size, bounds]);

  // PC: ホイールで拡大縮小（ページのスクロールを止めるため passive: false で登録）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !view) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      apply(zoomAt(view, size, Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, size, apply]);

  const local = (e: PointerEvent): Point => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // 指の本数が変わるたびに掴み直す
  const regrip = (moved: boolean) => {
    if (!view) return;
    const pts = [...pointers.current.values()];
    if (!pts.length) { gesture.current = undefined; return; }
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 1;
    gesture.current = { anchor: toMap(view, size, mid), startW: view.w, startDist: dist, startPx: mid, moved };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.map-tools, .map-chip, .map-switch')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    regrip(pointers.current.size > 1 || !!gesture.current?.moved);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    if (!g.moved && Math.hypot(mid.x - g.startPx.x, mid.y - g.startPx.y) < TAP_SLOP && pts.length === 1) return;
    g.moved = true;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : g.startDist;
    apply(anchorView(g.anchor, mid, (g.startW * g.startDist) / dist, size));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const wasTap = !gesture.current?.moved && pointers.current.size === 1;
    const px = local(e);
    pointers.current.delete(e.pointerId);
    regrip(true);
    if (!wasTap || !view) return;

    const now = e.timeStamp;
    const last = lastTap.current;
    if (now - last.t < DOUBLE_TAP_MS && Math.hypot(px.x - last.x, px.y - last.y) < 30) {
      apply(zoomAt(view, size, 2, px));
      lastTap.current = { t: 0, x: 0, y: 0 };
      return;
    }
    lastTap.current = { t: now, x: px.x, y: px.y };
    onTap?.(e);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    regrip(true);
  };

  const zoomCenter = (factor: number) => view && apply(zoomAt(view, size, factor, { x: size.w / 2, y: size.h / 2 }));

  return {
    wrapRef, size, view, ready, apply, zoomCenter,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
