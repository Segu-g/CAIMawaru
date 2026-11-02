// 読み込んだファイルの中身（テキスト）⇄ エディタで編集する形。ファイルの読み書き自体は folder.ts。
import { formatCsv, parseCsv } from './csv';
import { CIRCLE_COLS, MENU_COLS, newRow, type JsonObject, type Row } from './model';

/** event.json を書く形（Python の json.dumps(..., ensure_ascii=False, indent=2) + "\n" と同じ） */
export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export type Doc = {
  event: JsonObject;
  circles: Row[];
  menus: Row[];
};

export type LoadNote = { file: string; message: string };

/** CSV を読んで編集用の行にする。列名の行がおかしいときは例外（そのまま保存すると内容が消えるため開かない）。 */
export function readTable(text: string, columns: readonly string[], file: string, notes: LoadNote[]): Row[] {
  if (!text.trim()) return [];
  const { header, rows } = parseCsv(text);
  if (!header.includes('id')) {
    throw new Error(`${file} の1行目に列名（id など）がありません。直接編集で直してから開き直してください`);
  }
  const extra = header.filter((c) => c && !columns.includes(c));
  if (extra.length) {
    notes.push({ file, message: `決まった列にない ${extra.join('・')} 列は、保存すると消えます（CLI の取り込みと同じ）` });
  }
  return rows.map((values) => {
    const v: Record<string, string> = {};
    for (const c of columns) v[c] = values[c] ?? '';
    return newRow(v);
  });
}

/** event.json を読む。オブジェクトでなければ例外。 */
export function readEvent(text: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(`event.json を JSON として読めません（${(e as Error).message}）。直接編集で直してから開き直してください`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('event.json がオブジェクト（{ ... }）ではありません');
  }
  return value as JsonObject;
}

export function serializeCircles(rows: Row[]): string {
  return formatCsv(CIRCLE_COLS, rows.map((r) => r.values));
}

export function serializeMenus(rows: Row[]): string {
  return formatCsv(MENU_COLS, rows.map((r) => r.values));
}

export type Texts = { event: string; circles: string | null; menus: string | null };

/** 3つのファイルの中身から編集用の形を作る（null はファイルがない）。読めないときは例外。 */
export function loadDoc(texts: Texts): { doc: Doc; notes: LoadNote[] } {
  const notes: LoadNote[] = [];
  const event = readEvent(texts.event);
  const circles = readTable(texts.circles ?? '', CIRCLE_COLS, 'data/circles.csv', notes);
  const menus = readTable(texts.menus ?? '', MENU_COLS, 'data/menus.csv', notes);
  // 編集しなくても書式だけ変わるファイルを知らせる（保存するのは編集したファイルだけ）
  const csvStyle = '保存すると、CLI と同じ書式（列の順・行末 CRLF・必要なときだけ「"」で囲む）にそろえて書きます';
  const check = (file: string, text: string | null, out: string, message: string) => {
    if (text !== null && text.trim() && text.replace(/^\uFEFF/, '') !== out) notes.push({ file, message });
  };
  check('data/circles.csv', texts.circles, serializeCircles(circles), csvStyle);
  check('data/menus.csv', texts.menus, serializeMenus(menus), csvStyle);
  check('event.json', texts.event, formatJson(event), '保存すると、CLI と同じ書式（字下げ2・末尾の改行）にそろえて書きます');
  return { doc: { event, circles, menus }, notes };
}
