// 会場配置図。イベントごとの events/<slug>/layout.json（tools/build.py が circles.json の layout に入れる）
// から、描画に使うセル・ラベルを組み立てる。座標はホール左上を原点とした任意単位。

export type Rect = { x: number; y: number; w: number; h: number };

export type Cell = Rect & {
  space: string; // 例: "A-01"
  island: string;
  number: string;
};

export type Landmark = {
  label: string;
  // rect か多角形（points）のどちらか
  rect?: Rect;
  points?: [number, number][];
  kind: 'queue' | 'facility' | 'company' | 'area' | 'other-event';
};

// 島（机の列）。番号の振り方は order で指定する
//   1列: 'down'（上から。既定）/ 'up'（下から）/ 'right'（左から横並び）/ 'left'（右から横並び）
//   2列: 'up-down'（左列を下から、続けて右列を上から。既定）/ 'down-up'（左列を上から、右列を下から）
//        2列の島を横向きに置くときは 'right-left'（上の行を左から、下の行を右から）/ 'left-right'
export type Island = {
  name: string;
  x: number;
  y: number;
  rows: number; // 1列あたりのスペース数
  columns: 1 | 2;
  start?: number; // 最初の番号（既定 1）
  order?: string;
  separator?: string; // 島名と番号の区切り（既定 "-"）。「A01」なら ""
  digits?: number; // 番号の桁数（既定 2）
  label?: 'auto' | 'none' | { x: number; y: number; anchor?: 'start' | 'middle' | 'end' };
};

export type LayoutSpec = {
  cell?: { w: number; h: number };
  hall: Rect;
  bounds?: Rect; // 描画・移動できる範囲（既定はホールの周り少し）
  focus?: Rect; // 初期表示と「島」ボタンで収める範囲（既定は全セルの外接矩形）
  islands?: Island[];
  // 島の形に収まらないスペースを直接置く
  cells?: (Partial<Rect> & { space: string; island?: string; number?: string; x: number; y: number })[];
  entrances?: { label: string; rect: Rect }[];
  landmarks?: Landmark[];
};

export type IslandLabel = { name: string; x: number; y: number; anchor: 'start' | 'middle' | 'end' };

export type Layout = {
  cells: Cell[];
  islandLabels: IslandLabel[];
  hall: Rect;
  bounds: Rect;
  focus: Rect;
  entrances: { label: string; rect: Rect }[];
  landmarks: Landmark[];
};

export const DEFAULT_CELL = { w: 45, h: 26 };

export const svgRect = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });

function islandCells(isl: Island, cw: number, ch: number): Cell[] {
  const start = isl.start ?? 1;
  const sep = isl.separator ?? '-';
  const digits = isl.digits ?? 2;
  const make = (i: number, col: number, row: number): Cell => {
    const number = String(start + i).padStart(digits, '0');
    return { space: `${isl.name}${sep}${number}`, island: isl.name, number, x: isl.x + col * cw, y: isl.y + row * ch, w: cw, h: ch };
  };
  const n = isl.rows;
  const cells: Cell[] = [];
  if (isl.columns === 1) {
    const order = isl.order ?? 'down';
    for (let i = 0; i < n; i++) {
      if (order === 'down') cells.push(make(i, 0, i));
      else if (order === 'up') cells.push(make(i, 0, n - 1 - i));
      else if (order === 'right') cells.push(make(i, i, 0));
      else if (order === 'left') cells.push(make(i, n - 1 - i, 0));
      else throw new Error(`島 ${isl.name}: 1列の order '${order}' は不明です`);
    }
    return cells;
  }
  const order = isl.order ?? 'up-down';
  for (let i = 0; i < n; i++) {
    if (order === 'up-down') { cells.push(make(i, 0, n - 1 - i)); }
    else if (order === 'down-up') { cells.push(make(i, 0, i)); }
    else if (order === 'right-left') { cells.push(make(i, i, 0)); }
    else if (order === 'left-right') { cells.push(make(i, n - 1 - i, 0)); }
    else throw new Error(`島 ${isl.name}: 2列の order '${order}' は不明です`);
  }
  for (let i = 0; i < n; i++) {
    if (order === 'up-down') cells.push(make(n + i, 1, i));
    else if (order === 'down-up') cells.push(make(n + i, 1, n - 1 - i));
    else if (order === 'right-left') cells.push(make(n + i, n - 1 - i, 1));
    else cells.push(make(n + i, i, 1));
  }
  return cells;
}

function islandLabel(isl: Island, cw: number, ch: number): IslandLabel | undefined {
  const l = isl.label ?? 'auto';
  if (l === 'none') return undefined;
  if (l !== 'auto') return { name: isl.name, x: l.x, y: l.y, anchor: l.anchor ?? 'middle' };
  const horizontal = ['right', 'left', 'right-left', 'left-right'].includes(isl.order ?? '');
  // スペース番号に重ならないよう、縦の2列の島は上、それ以外は左にラベルを置く
  if (isl.columns === 2 && !horizontal) return { name: isl.name, x: isl.x + cw, y: isl.y - 20, anchor: 'middle' };
  return { name: isl.name, x: isl.x - 22, y: isl.y + ch * (horizontal ? 0.7 : 1), anchor: 'start' };
}

export function boundsOf(rects: Rect[], pad = 0): Rect {
  const x = Math.min(...rects.map((r) => r.x)) - pad;
  const y = Math.min(...rects.map((r) => r.y)) - pad;
  const x2 = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const y2 = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return { x, y, w: x2 - x, h: y2 - y };
}

export function buildLayout(spec: LayoutSpec): Layout {
  const { w: cw, h: ch } = spec.cell ?? DEFAULT_CELL;
  const islands = spec.islands ?? [];
  const cells = [
    ...islands.flatMap((isl) => islandCells(isl, cw, ch)),
    ...(spec.cells ?? []).map((c) => {
      const m = c.space.match(/^(.*?)[-‐]?(\d+)$/);
      return { w: cw, h: ch, island: c.island ?? m?.[1] ?? '', number: c.number ?? m?.[2] ?? c.space, ...c } as Cell;
    }),
  ];
  const islandLabels = islands.map((isl) => islandLabel(isl, cw, ch)).filter((l): l is IslandLabel => !!l);
  const focus = spec.focus ?? (cells.length ? boundsOf(cells, 40) : spec.hall);
  return {
    cells,
    islandLabels,
    hall: spec.hall,
    bounds: spec.bounds ?? boundsOf([spec.hall, ...(spec.entrances ?? []).map((e) => e.rect)], 30),
    focus,
    entrances: spec.entrances ?? [],
    landmarks: spec.landmarks ?? [],
  };
}
