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
  return id ? doc.menus.filter((m) => isDataRow(m.values, m.extra) && m.values.id.trim() === id) : [];
}

/** 同じ id を使っているほかのサークル（id の重複。お品書きはどちらのものか決まらない） */
export function sameIdCircles(doc: Doc, circle: Row): Row[] {
  const id = circleId(circle.values);
  return id ? doc.circles.filter((c) => c.key !== circle.key && isDataRow(c.values, c.extra) && circleId(c.values) === id) : [];
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
    if (!oldId || !isDataRow(m.values, m.extra) || m.values.id.trim() !== oldId) return m;
    moved++;
    return { ...m, values: { ...m.values, id: newId } };
  });
  return { doc: moved ? { ...doc, menus } : doc, moved };
}

/**
 * サークルの id かスペース番号を変える（col は 'id' か 'space'）。id が変わるときは、お品書きの id も付け替える。
 * ただし id がほかのサークルと重複しているときは、お品書きはそのサークルのものかもしれないので付け替えない。
 * dirty は書き換わるファイル（お品書きを付け替えなければ circles だけ）。
 */
export function changeCircleId(doc: Doc, key: number, col: 'id' | 'space', value: string): { doc: Doc; moved: number; dirty: ('circles' | 'menus')[] } {
  const circle = doc.circles.find((c) => c.key === key);
  if (!circle) return { doc, moved: 0, dirty: [] };
  const before = circleId(circle.values);
  const shared = sameIdCircles(doc, circle).length > 0;
  const next = updateCircle(doc, key, col, value);
  const after = circleId({ ...circle.values, [col]: value });
  if (shared || !after || after === before) return { doc: next, moved: 0, dirty: ['circles'] };
  const res = renameMenus(next, before, after);
  return { doc: res.doc, moved: res.moved, dirty: res.moved ? ['circles', 'menus'] : ['circles'] };
}

/** サークルを消す。そのサークルのお品書きも一緒に消す（残すと menus.csv に宙に浮いた行ができる） */
export function removeCircle(doc: Doc, key: number): { doc: Doc; removedMenus: number } {
  const circle = doc.circles.find((c) => c.key === key);
  if (!circle) return { doc, removedMenus: 0 };
  // id が重複しているときは、お品書きは同じ id のほかのサークルのものとして残す
  const menus = sameIdCircles(doc, circle).length ? [] : menusOf(doc, circle);
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

/** お品書きを差し替える（URL を変え、確認した日を今日にする）。note を渡せば説明も変える */
export function replaceMenu(doc: Doc, key: number, url: string, note?: string, now = new Date()): Doc {
  let next = updateMenu(doc, key, 'url', url, now);
  if (note !== undefined) next = { ...next, menus: setValue(next.menus, key, 'note', note) };
  return next;
}

const spacesOf = (space: string) => space.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** スペース番号（複数ならどれか）が重なるほかのサークル */
export function spaceUsers(doc: Doc, key: number, space: string): Row[] {
  const want = new Set(spacesOf(space));
  if (!want.size) return [];
  return doc.circles.filter((c) => c.key !== key && c.comment === undefined && isDataRow(c.values, c.extra)
    && spacesOf(c.values.space).some((s) => want.has(s)));
}

/**
 * スペース番号を変える。id 列が空なら、今の id（スペース番号から作ったもの）を id 列に書いてから変える。
 * id が変わらないので、お品書きと閲覧者の ★ はそのまま（公開後の配置換え向け）
 */
export function moveKeepingId(doc: Doc, key: number, space: string): Doc {
  const circle = doc.circles.find((c) => c.key === key);
  if (!circle) return doc;
  const id = circleId(circle.values);
  let next = doc;
  if (!circle.values.id.trim() && id) next = updateCircle(next, key, 'id', id);
  return updateCircle(next, key, 'space', space);
}

/** id を使っているほかのサークル（その id に変えると重複する） */
export function idUsers(doc: Doc, key: number, id: string): Row[] {
  const want = id.trim();
  return want ? doc.circles.filter((c) => c.key !== key && c.comment === undefined && isDataRow(c.values, c.extra) && circleId(c.values) === want) : [];
}

/**
 * 入れ替え: スペースが重なったほかのサークル（otherKey）を、空いたスペース（space）へ移す。id は変えない（moveKeepingId）。
 * 相手の id がほかのサークルと重複しているときは、お品書きがどちらのものか決まらず、id を書くと重複のまま固まるので移さない。
 */
export function moveAside(doc: Doc, otherKey: number, space: string): { doc: Doc; ok: true } | { doc: Doc; ok: false; reason: string } {
  const other = doc.circles.find((c) => c.key === otherKey);
  if (!other) return { doc, ok: false, reason: 'サークルが見つかりません' };
  const dup = sameIdCircles(doc, other);
  if (dup.length) {
    const names = [other, ...dup].map((c) => `${c.values.space} ${c.values.name}`.trim()).join('・');
    return { doc, ok: false, reason: `id「${circleId(other.values)}」が重複しているため入れ替えられません（${names}）。先に id を直してください` };
  }
  return { doc: moveKeepingId(doc, otherKey, space), ok: true };
}

/**
 * 足したまま何も入れていない行に、最初の入力と一緒に既定値（参加イベント・出典など）を入れる。
 * 何も入れずにやめた行は書かない、を保つため、既定値は追加したときではなく最初に入力したときに入れる。
 * すでに値がある行と、空でない列は変えない。
 */
export function applyDefaults(doc: Doc, key: number, defaults: Partial<Record<string, string>>): Doc {
  const circle = doc.circles.find((c) => c.key === key);
  if (!circle || isDataRow(circle.values, circle.extra)) return doc;
  let next = doc;
  for (const [col, value] of Object.entries(defaults)) {
    if (value && !circle.values[col]?.trim()) next = updateCircle(next, key, col, value);
  }
  return next;
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

// --- info.eventSlots（イベント名 → 色の枠）---

export type SlotRow = { name: string; slot: Json };

/**
 * 画面で編集している eventSlots の行を、event.json に書くオブジェクトにする。
 * 名前が空・重複・数字だけ（JavaScript ではキーの順が並べ替わる）のときは書かずに理由を返す。
 */
export function slotsToObject(rows: SlotRow[]): { ok: true; value: JsonObject } | { ok: false; message: string } {
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) return { ok: false, message: 'イベント名が空の行があります。入力するか、その行を削除してください' };
    if (/^\d+$/.test(name)) return { ok: false, message: `イベント名「${name}」は数字だけなので使えません（キーの順が変わるため）` };
    if (seen.has(name)) return { ok: false, message: `イベント名「${name}」が重複しています` };
    seen.add(name);
  }
  return { ok: true, value: Object.fromEntries(rows.map((r) => [r.name.trim(), r.slot])) };
}

const isObject = (v: Json | undefined): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);

/** 数字だけのイベント名（JavaScript ではキーの順が並べ替わるので、eventSlots をこの画面では書き換えない） */
function digitSlotNames(slots: JsonObject): string[] {
  return Object.keys(slots).filter((k) => /^\d+$/.test(k));
}

/** eventSlots を読み取り専用にする理由（なければ null） */
export function slotsLockReason(event: JsonObject): string | null {
  const slots = infoOf(event).eventSlots;
  if (slots === undefined) return null;
  if (!isObject(slots)) return 'eventSlots がオブジェクト（{ "イベント名": 枠 }）ではないので、ここでは編集しません';
  const digits = digitSlotNames(slots);
  if (digits.length) {
    return `数字だけのイベント名（${digits.join('・')}）があるので、ここでは編集しません（このエディタで書き戻すと、キーの順が変わることがあるため）。` +
      'eventSlots は event.json を直接編集してください';
  }
  return null;
}
const optString = (v: Json | undefined) => v === undefined || typeof v === 'string';

export type EditableField = 'storeId' | 'title' | 'name' | 'date' | 'venue' | 'hours' | 'links' | 'hashtags' | 'eventSlots' | 'contact';

/**
 * event.json のうち、画面で編集できる形になっているもの（false の欄は読み取り専用にする）。
 * 想定と違う形の値（文字列のはずが数値、links の要素が文字列など）を、画面で編集して空欄や {} に変えてしまわないため。
 */
export function editableFields(event: JsonObject): Record<EditableField, boolean> {
  const info = infoOf(event);
  const { links, hashtags, contact } = info;
  // info がオブジェクトでなければ、info の欄はどれも編集しない（書き換えると info の中身が消える）
  const infoOk = event.info === undefined || isObject(event.info);
  const fields = {
    name: optString(info.name),
    date: optString(info.date),
    venue: optString(info.venue),
    hours: optString(info.hours),
    links: links === undefined || (Array.isArray(links) && links.every((l) => isObject(l) && optString(l.label) && optString(l.url))),
    hashtags: hashtags === undefined || (Array.isArray(hashtags) && hashtags.every((t) => typeof t === 'string')),
    eventSlots: info.eventSlots === undefined || (isObject(info.eventSlots) && !digitSlotNames(info.eventSlots).length),
    contact: contact === undefined || (isObject(contact) && optString(contact.label) && optString(contact.url)),
  };
  return {
    storeId: optString(event.storeId),
    title: optString(event.title),
    ...(Object.fromEntries(Object.entries(fields).map(([k, ok]) => [k, ok && infoOk])) as typeof fields),
  };
}
