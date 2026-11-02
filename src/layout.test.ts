import { describe, expect, it } from 'vitest';
import { spacesOf } from './filter';
import type { CircleData } from './types';

// ページが読む circles.json（Python の caimawaru data が書く。境界はこのファイルだけ）が、ページの期待する形かを確かめる。
// 島の番号の振り方などの展開そのもののテストは Python 側（tools/tests/test_layout.py）。
const generated = import.meta.glob<CircleData>('../events/*/public/data/circles.json', { eager: true, import: 'default' });

describe.each(Object.entries(generated))('%s', (_, data) => {
  it('イベント情報とサークルがある', () => {
    expect(typeof data.event.name).toBe('string');
    expect(Array.isArray(data.circles)).toBe(true);
  });

  const layout = data.layout;
  it.runIf(!!layout)('配置図は展開済みのセルで、スペース番号が重複しない', () => {
    for (const c of layout!.cells) expect(c).toEqual(expect.objectContaining({ space: expect.any(String), x: expect.any(Number), w: expect.any(Number) }));
    expect(new Set(layout!.cells.map((c) => c.space)).size).toBe(layout!.cells.length);
    expect(layout!.focus).toEqual(expect.objectContaining({ w: expect.any(Number) }));
  });

  it.runIf(!!layout)('全サークルのスペースが配置図上にある', () => {
    const spaces = new Set(layout!.cells.map((c) => c.space));
    expect(data.circles.flatMap(spacesOf).filter((s) => !spaces.has(s))).toEqual([]);
  });
});
