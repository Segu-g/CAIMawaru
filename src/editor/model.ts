// エディタが扱うイベントデータの形と、Python 側（tools/caimawaru/）と同じ規則の小さな関数。

// 列の並び（tools/caimawaru/project.py の CIRCLE_COLS・MENU_COLS と同じ。保存するとこの順に書く）
export const CIRCLE_COLS = ['id', 'space', 'event', 'name', 'kana', 'penNames', 'tags', 'adult',
  'x', 'pixiv', 'booth', 'web', 'notes', 'source'] as const;
export const MENU_COLS = ['id', 'url', 'note', 'checkedAt'] as const;
export const LINK_KEYS = ['x', 'pixiv', 'booth', 'web'] as const;

export type CircleCol = (typeof CIRCLE_COLS)[number];
export type MenuCol = (typeof MENU_COLS)[number];

/**
 * 表の1行。key は画面の中だけで使う番号（ファイルには書かない）。
 * comment はコメントの行（最初の値が「#」で始まる行）の値の並びで、そのときの values は空。一覧には出さず、そのまま書き戻す。
 * extra は決まった列にない列の値（位置の順。画面では編集せず、そのまま書き戻す）
 */
export type Row = { key: number; values: Record<string, string>; comment?: string[]; extra?: string[] };

let nextKey = 1;
export function newRow(values: Record<string, string>, comment?: string[], extra?: string[]): Row {
  return { key: nextKey++, values, ...(comment !== undefined && { comment }), ...(extra !== undefined && { extra }) };
}

/** スペース番号から id を作る（project.py の make_id と同じ。「A-03,A-04」→「a-03-a-04」）。 */
export function makeId(space: string): string {
  return space.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** サークルの id。空欄ならスペース番号から作る（build.py と同じ。menus.csv はこの id を参照する） */
export function circleId(values: Record<string, string>): string {
  return (values.id ?? '').trim() || makeId((values.space ?? '').trim());
}

/**
 * サークル・お品書きとして扱う行か。コメントの行（最初の値が「#」で始まる行。csv.ts で見分け、values は空）は除く。
 * 空の値だけの行は読み込むときに捨てるが、画面で足して何も入れていない行もここで除く。
 */
export function isDataRow(values: Record<string, string>, extra: readonly string[] = []): boolean {
  return Object.values(values).some((v) => v.trim()) || extra.some((v) => v.trim());
}

/** http(s) の URL か（project.py の is_http_url と同じく、スキームとホストがあるか）。 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^/?#\s]/i.test(value);
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 今日の日付（YYYY-MM-DD、この端末の時刻）。お品書きの checkedAt に入れる */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 「;」区切りの値（penNames・tags）を分ける（build.py の split_list と同じ） */
export function splitList(value: string): string[] {
  return value.split(';').map((s) => s.trim()).filter(Boolean);
}

// event.json（不明なキーも含めてそのまま持ち、編集した値だけ差し替える）
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Link = { label: string; url: string };
