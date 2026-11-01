import { describe, expect, it } from 'vitest';
import { buildLayout, type LayoutSpec } from './layout';
import { spacesOf } from './filter';
import type { CircleData } from './types';

const hall = { x: 0, y: 0, w: 1000, h: 600 };
const at = (spec: LayoutSpec) => {
  const cells = buildLayout(spec).cells;
  return (space: string) => cells.find((c) => c.space === space)!;
};

describe('buildLayout: 島の番号の振り方', () => {
  it('2列（既定 up-down）: 左列は下から、右列は上から', () => {
    const cell = at({ hall, islands: [{ name: 'A', x: 0, y: 0, rows: 3, columns: 2 }] });
    expect(cell('A-01').y).toBeGreaterThan(cell('A-03').y);
    expect(cell('A-03').y).toBe(cell('A-04').y);
    expect(cell('A-04').x).toBeGreaterThan(cell('A-03').x);
    expect(cell('A-06').y).toBe(cell('A-01').y);
  });

  it('2列 down-up: 左列は上から、右列は下から', () => {
    const cell = at({ hall, islands: [{ name: 'A', x: 0, y: 0, rows: 3, columns: 2, order: 'down-up' }] });
    expect(cell('A-01').y).toBeLessThan(cell('A-03').y);
    expect(cell('A-04').y).toBe(cell('A-03').y);
  });

  it('2列 right-left（横向きの島）: 上の行を左から、下の行を右から', () => {
    const cell = at({ hall, islands: [{ name: 'A', x: 0, y: 0, rows: 3, columns: 2, order: 'right-left' }] });
    expect(cell('A-01').x).toBeLessThan(cell('A-03').x);
    expect(cell('A-04').x).toBe(cell('A-03').x);
    expect(cell('A-04').y).toBeGreaterThan(cell('A-03').y);
  });

  it('1列: start・区切り・桁数', () => {
    const cell = at({ hall, cell: { w: 10, h: 5 }, islands: [{ name: 'Z', x: 0, y: 0, rows: 3, columns: 1, start: 7, separator: '', digits: 3 }] });
    expect(cell('Z008').y - cell('Z007').y).toBe(5);
    expect(cell('Z009').x).toBe(cell('Z007').x);
  });

  it('cells で直接置いたスペースも数える', () => {
    const layout = buildLayout({ hall, cells: [{ space: '壁-01', x: 5, y: 5 }] });
    expect(layout.cells[0]).toMatchObject({ space: '壁-01', island: '壁', number: '01', w: 45, h: 26 });
  });

  it('focus を省略すると全セルを囲む範囲になる', () => {
    const layout = buildLayout({ hall, cells: [{ space: 'X-01', x: 100, y: 100, w: 10, h: 10 }] });
    expect(layout.focus).toEqual({ x: 60, y: 60, w: 90, h: 90 });
  });
});

// 各イベントの生成済みデータ（tools/build.py が作る）を確かめる
const generated = import.meta.glob<CircleData>('../events/*/public/data/circles.json', { eager: true, import: 'default' });

describe.each(Object.entries(generated).filter(([, d]) => d.layout))('%s の配置図', (_, data) => {
  const layout = buildLayout(data.layout!);

  it('スペース番号が重複しない', () => {
    expect(new Set(layout.cells.map((c) => c.space)).size).toBe(layout.cells.length);
  });

  it('全サークルのスペースが配置図上に存在する', () => {
    const spaces = new Set(layout.cells.map((c) => c.space));
    expect(data.circles.flatMap(spacesOf).filter((s) => !spaces.has(s))).toEqual([]);
  });
});
