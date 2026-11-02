// 読み込んだファイルの中身（テキスト）⇄ エディタで編集する形。ファイルの読み書き自体は folder.ts。
import { CsvError, formatCsv, parseCsv } from './csv';
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
  /** circles.csv の、決まった列にない列の列名（位置の順。決まった列のあとに書く） */
  circleExtras: string[];
  /** circles.csv の見出しより前にあったコメントの行（見出しの前にそのまま書く） */
  circleLead: string[][];
  menus: Row[];
  menuExtras: string[];
  menuLead: string[][];
};

export type LoadNote = { file: string; message: string };

/**
 * CSV を読んで編集用の行にする。CSV として読めない（「"」が閉じていない）ときだけ例外にして開かない。
 * 読み方の知らせ（決まった列の重複・見出しより長い行・決まった列がない）は notes に足す。
 */
export function readTable(
  text: string,
  standard: readonly string[],
  file: string,
  what: string,
  notes: LoadNote[],
): { rows: Row[]; extras: string[]; lead: string[][] } {
  let table;
  try {
    table = parseCsv(text, standard);
  } catch (e) {
    if (e instanceof CsvError) throw new Error(`${file}: ${e.message}。CSV として読めないので開きません。直接編集で直してから開き直してください`);
    throw e;
  }
  const { header, extraHeader, lead, rows } = table;
  if (header.length && table.noStandard) {
    notes.push({ file, message: `${what}の列（${standard.join('・')}）が見つかりません。見出しの列はすべて、ほかの列としてそのまま残します（決まった列は空として扱います）` });
  }
  for (const message of table.notes) notes.push({ file, message });
  return {
    extras: extraHeader,
    lead,
    rows: rows.map((r) => ('comment' in r ? newRow({}, r.comment) : newRow(r.values, undefined, r.extra))),
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
export function serializeTable(standard: readonly string[], extras: readonly string[], rows: Row[], lead: readonly string[][] = []): string {
  const out = rows.filter((r) => r.comment !== undefined || isDataRow(r.values, r.extra));
  return formatCsv(standard, extras, out.map((r) => (r.comment !== undefined ? { comment: r.comment } : { values: r.values, extra: r.extra })), lead);
}

export function serializeCircles(doc: Pick<Doc, 'circles' | 'circleExtras' | 'circleLead'>): string {
  return serializeTable(CIRCLE_COLS, doc.circleExtras, doc.circles, doc.circleLead);
}

export function serializeMenus(doc: Pick<Doc, 'menus' | 'menuExtras' | 'menuLead'>): string {
  return serializeTable(MENU_COLS, doc.menuExtras, doc.menus, doc.menuLead);
}

export function serializeEvent(doc: Pick<Doc, 'event' | 'eventEol'>): string {
  return formatJson(doc.event, doc.eventEol);
}

export type Texts = { event: string; circles: string | null; menus: string | null };

/** 3つのファイルの中身から編集用の形を作る（null はファイルがない）。読めないときは例外。 */
export function loadDoc(texts: Texts): { doc: Doc; notes: LoadNote[] } {
  const notes: LoadNote[] = [];
  const event = readEvent(texts.event);
  const circles = readTable(texts.circles ?? '', CIRCLE_COLS, 'data/circles.csv', 'サークル', notes);
  const menus = readTable(texts.menus ?? '', MENU_COLS, 'data/menus.csv', 'お品書き', notes);
  const doc: Doc = {
    event,
    eventEol: texts.event.includes('\r\n') ? '\r\n' : '\n',
    eventLocked: lossyJson(texts.event),
    circles: circles.rows,
    circleExtras: circles.extras,
    circleLead: circles.lead,
    menus: menus.rows,
    menuExtras: menus.extras,
    menuLead: menus.lead,
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
