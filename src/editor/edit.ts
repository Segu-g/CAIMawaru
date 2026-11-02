// 編集の操作（どれも元の Doc を変えずに新しい Doc を返す）。
import type { Doc } from './doc';
import { CIRCLE_COLS, circleId, isDataRow, newRow, today, type Json, type JsonObject, type Row } from './model';

export type Dirty = { event: boolean; circles: boolean; menus: boolean };

const blank = (cols: readonly string[]) => Object.fromEntries(cols.map((c) => [c, ''])) as Record<string, string>;

function setValue(rows: Row[], key: number, col: string, value: string): Row[] {
  return rows.map((r) => (r.key === key ? { ...r, values: { ...r.values, [col]: value } } : r));
}

/** そのサークルのお品書き（menus.csv の id がサークルの id と同じ行） */
export function menusOf(doc: Doc, circle: Row): Row[] {
  const id = circleId(circle.values);
  return id ? doc.menus.filter((m) => isDataRow(m.values) && m.values.id.trim() === id) : [];
}

/** 同じ id のサークルがほかにもあるか（重複している id のお品書きは、片方を消しても消さない） */
function idShared(doc: Doc, circle: Row): boolean {
  const id = circleId(circle.values);
  return doc.circles.some((c) => c.key !== circle.key && isDataRow(c.values) && circleId(c.values) === id);
}

export function addCircle(doc: Doc, values: Partial<Record<string, string>> = {}): { doc: Doc; key: number } {
  const row = newRow({ ...blank(CIRCLE_COLS), ...values } as Record<string, string>);
  return { doc: { ...doc, circles: [...doc.circles, row] }, key: row.key };
}

export function updateCircle(doc: Doc, key: number, col: string, value: string): Doc {
  return { ...doc, circles: setValue(doc.circles, key, col, value) };
}

/**
 * サークルの id が変わるとき、お品書きの id も付け替える（お品書きを宙に浮かせない）。
 * 戻り値の moved は付け替えたお品書きの数。
 */
export function renameMenus(doc: Doc, oldId: string, newId: string): { doc: Doc; moved: number } {
  let moved = 0;
  const menus = doc.menus.map((m) => {
    if (!oldId || !isDataRow(m.values) || m.values.id.trim() !== oldId) return m;
    moved++;
    return { ...m, values: { ...m.values, id: newId } };
  });
  return { doc: moved ? { ...doc, menus } : doc, moved };
}

/** サークルを消す。そのサークルのお品書きも一緒に消す（残すと menus.csv に宙に浮いた行ができる） */
export function removeCircle(doc: Doc, key: number): { doc: Doc; removedMenus: number } {
  const circle = doc.circles.find((c) => c.key === key);
  if (!circle) return { doc, removedMenus: 0 };
  const menus = idShared(doc, circle) ? [] : menusOf(doc, circle);
  const drop = new Set(menus.map((m) => m.key));
  return {
    doc: { ...doc, circles: doc.circles.filter((c) => c.key !== key), menus: doc.menus.filter((m) => !drop.has(m.key)) },
    removedMenus: menus.length,
  };
}

/** お品書きを足す。checkedAt（確認した日）は今日 */
export function addMenu(doc: Doc, id: string, url = '', note = '', now = new Date()): { doc: Doc; key: number } {
  const row = newRow({ id, url, note, checkedAt: today(now) });
  return { doc: { ...doc, menus: [...doc.menus, row] }, key: row.key };
}

/** お品書きの値を変える。URL を変えたら、確認した日（checkedAt）を今日にする */
export function updateMenu(doc: Doc, key: number, col: string, value: string, now = new Date()): Doc {
  let menus = setValue(doc.menus, key, col, value);
  if (col === 'url') menus = setValue(menus, key, 'checkedAt', today(now));
  return { ...doc, menus };
}

export function removeMenu(doc: Doc, key: number): Doc {
  return { ...doc, menus: doc.menus.filter((m) => m.key !== key) };
}

// --- event.json ---

export function infoOf(event: JsonObject): JsonObject {
  const info = event.info;
  return info && typeof info === 'object' && !Array.isArray(info) ? info : {};
}

/** 最上位のキー（storeId・title）を変える */
export function setTop(event: JsonObject, key: string, value: Json): JsonObject {
  return { ...event, [key]: value };
}

/**
 * info のキーを変える。undefined を渡すとキーを消す。
 * 空欄にしたキーは、もとからあれば空の値で残し（雛形の形を保つ）、なければ足さない。
 */
export function setInfo(event: JsonObject, key: string, value: Json | undefined): JsonObject {
  const info = { ...infoOf(event) };
  const empty = value === '' || (Array.isArray(value) && value.length === 0);
  if (value === undefined || (empty && !(key in info))) delete info[key];
  else info[key] = value;
  return { ...event, info };
}
