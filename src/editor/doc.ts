// 読み込んだファイルの中身（テキスト）⇄ エディタで編集する形。ファイルの読み書き自体は folder.ts。
import { CsvError, formatCsv, outputColumns, parseCsv } from './csv';
import { lossyJson } from './jsonCheck';
import { CIRCLE_COLS, isDataRow, MENU_COLS, newRow, type JsonObject, type Row } from './model';

/**
 * event.json を書く形（Python の json.dumps(..., ensure_ascii=False, indent=2) + "\n" と同じ。キーの順は保つ）。
 * eol に CRLF を渡すと、行末を CRLF にする（読み込んだファイルが CRLF だったとき）。
 */
export function formatJson(value: unknown, eol: '\n' | '\r\n' = '\n'): string {
  const text = JSON.stringify(value, null, 2) + '\n';
  return eol === '\n' ? text : text.replace(/\n/g, '\r\n'); // 文字列の中の改行は \n とエスケープ済みなので、置き換わるのは行末だけ
}

export type Doc = {
  event: JsonObject;
  /** event.json の行末（読み込んだファイルに合わせる） */
  eventEol: '\n' | '\r\n';
  /**
   * event.json を書き戻すと値やキーの順が変わってしまう箇所（jsonCheck.ts）。あればイベント情報は読み取り専用にして、
   * event.json は書かない
   */
  eventLocked: string[];
  circles: Row[];
  /** circles.csv に書く列（決まった列 + ファイルにあったほかの列） */
  circleCols: string[];
  menus: Row[];
  menuCols: string[];
};

export type LoadNote = { file: string; message: string };

/** CSV を読んで編集用の行にする。読めない（保存すると内容が失われる）ときは例外にして開かない。 */
export function readTable(text: string, standard: readonly string[], file: string): { rows: Row[]; cols: string[] } {
  let table;
  try {
    table = parseCsv(text);
  } catch (e) {
    if (e instanceof CsvError) throw new Error(`${file}: ${e.message}。内容が失われるので開きません。直接編集で直してから開き直してください`);
    throw e;
  }
  const { header, rows } = table;
  if (header.length && !header.includes('id')) {
    throw new Error(`${file} の1行目に列名（id など）がありません。直接編集で直してから開き直してください`);
  }
  const cols = outputColumns(standard, header);
  return {
    cols,
    rows: rows.map((r) => ('comment' in r ? newRow({}, r.comment) : newRow(Object.fromEntries(cols.map((c) => [c, r.values[c] ?? '']))))),
  };
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

/** 行を CSV にする。コメントの行はそのまま、どの値も空の行（足したまま何も入れていない行など）は書かない */
export function serializeTable(cols: readonly string[], rows: Row[]): string {
  const out = rows.filter((r) => r.comment !== undefined || isDataRow(r.values));
  return formatCsv(cols, out.map((r) => (r.comment !== undefined ? { comment: r.comment } : { values: r.values })));
}

export function serializeCircles(doc: Pick<Doc, 'circles' | 'circleCols'>): string {
  return serializeTable(doc.circleCols, doc.circles);
}

export function serializeMenus(doc: Pick<Doc, 'menus' | 'menuCols'>): string {
  return serializeTable(doc.menuCols, doc.menus);
}

export function serializeEvent(doc: Pick<Doc, 'event' | 'eventEol'>): string {
  return formatJson(doc.event, doc.eventEol);
}

export type Texts = { event: string; circles: string | null; menus: string | null };

/** 3つのファイルの中身から編集用の形を作る（null はファイルがない）。読めないときは例外。 */
export function loadDoc(texts: Texts): { doc: Doc; notes: LoadNote[] } {
  const notes: LoadNote[] = [];
  const event = readEvent(texts.event);
  const circles = readTable(texts.circles ?? '', CIRCLE_COLS, 'data/circles.csv');
  const menus = readTable(texts.menus ?? '', MENU_COLS, 'data/menus.csv');
  const doc: Doc = {
    event,
    eventEol: texts.event.includes('\r\n') ? '\r\n' : '\n',
    eventLocked: lossyJson(texts.event),
    circles: circles.rows,
    circleCols: circles.cols,
    menus: menus.rows,
    menuCols: menus.cols,
  };
  // 編集しなくても書式だけ変わるファイルを知らせる（保存するのは編集したファイルだけ）
  const csvStyle = '保存すると、CLI と同じ書式（列の順・行末 CRLF・必要なときだけ「"」で囲む・空の行を除く）にそろえて書きます';
  const check = (file: string, text: string | null, out: string, message: string) => {
    if (text !== null && text.trim() && text !== out) notes.push({ file, message });
  };
  check('data/circles.csv', texts.circles, serializeCircles(doc), csvStyle);
  check('data/menus.csv', texts.menus, serializeMenus(doc), csvStyle);
  if (doc.eventLocked.length) {
    notes.push({ file: 'event.json', message: 'このエディタでは書き戻すと値やキーの順が変わってしまうので、イベント情報は読み取り専用で開きました（「イベント情報」タブ）。サークルとお品書きは編集できます' });
  } else {
    check('event.json', texts.event, serializeEvent(doc), '保存すると、CLI と同じ書式（字下げ2・末尾の改行）にそろえて書きます');
  }
  return { doc, notes };
}
