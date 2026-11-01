import { describe, expect, it } from 'vitest';
import { MIN_W, anchorView, clampView, fitView, toMap, viewBox, zoomAt } from './mapView';

const size = { w: 400, h: 800 };
const bounds = { x: 0, y: 0, w: 1000, h: 500 };

describe('mapView', () => {
  it('全体表示は横長の配置図を幅いっぱいに収める', () => {
    expect(fitView(bounds, size)).toEqual({ cx: 500, cy: 250, w: 1000 });
    // 横長の画面では高さ基準
    expect(fitView(bounds, { w: 1600, h: 400 }).w).toBe(2000);
  });

  it('viewBox の縦横比は表示領域に合わせる', () => {
    expect(viewBox({ cx: 500, cy: 250, w: 1000 }, size)).toBe('0 -750 1000 2000');
  });

  it('拡大しても指の下の点は動かない', () => {
    const v = { cx: 500, cy: 250, w: 1000 };
    const px = { x: 100, y: 300 };
    const before = toMap(v, size, px);
    const z = zoomAt(v, size, 2, px);
    expect(z.w).toBe(500);
    const after = toMap(z, size, px);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('ドラッグで掴んだ点が指に追従する', () => {
    const v = anchorView({ x: 300, y: 200 }, { x: 50, y: 60 }, 800, size);
    const p = toMap(v, size, { x: 50, y: 60 });
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(200);
  });

  it('拡大縮小と移動の範囲を制限する', () => {
    expect(clampView({ cx: 500, cy: 250, w: 10 }, bounds, size).w).toBe(MIN_W);
    expect(clampView({ cx: 500, cy: 250, w: 99999 }, bounds, size).w).toBe(1000);
    const far = clampView({ cx: -500, cy: 9999, w: 400 }, bounds, size);
    expect([far.cx, far.cy]).toEqual([0, 500]);
  });
});
