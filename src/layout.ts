// 会場配置図の型。島の展開（番号の振り方・記号の位置・初期表示の範囲）は Python 側（tools/caimawaru/layout.py）が行い、
// circles.json の layout に展開済みのセルとして書き出す。ページはそれを描くだけ。座標はホール左上を原点とした任意単位。

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

export type IslandLabel = { name: string; x: number; y: number; anchor: 'start' | 'middle' | 'end' };

export type Layout = {
  cells: Cell[];
  islandLabels: IslandLabel[];
  hall: Rect;
  bounds: Rect; // 描画・移動できる範囲
  focus: Rect; // 初期表示と「島」ボタンで収める範囲
  entrances: { label: string; rect: Rect }[];
  landmarks: Landmark[];
};

export const svgRect = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
