// エディタが扱うイベントデータの形と、Python 側（tools/caimawaru/）と同じ規則の小さな関数。

// 列の並び（tools/caimawaru/project.py の CIRCLE_COLS・MENU_COLS と同じ。保存するとこの順に書く）
export const CIRCLE_COLS = ['id', 'space', 'event', 'name', 'kana', 'penNames', 'tags', 'adult',
  'x', 'pixiv', 'booth', 'web', 'notes', 'source'] as const;
export const MENU_COLS = ['id', 'url', 'note', 'checkedAt'] as const;
export const LINK_KEYS = ['x', 'pixiv', 'booth', 'web'] as const;

export type CircleCol = (typeof CIRCLE_COLS)[number];
export type MenuCol = (typeof MENU_COLS)[number];

/** 表の1行。key は画面の中だけで使う番号（ファイルには書かない） */
export type Row = { key: number; values: Record<string, string> };

let nextKey = 1;
export function newRow(values: Record<string, string>): Row {
  return { key: nextKey++, values };
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
 * Python の read_csv が読む行か。空の行と「#」で始まる行（コメント）は検証・生成で無視されるので、
 * エディタでも一覧に出さず、そのまま書き戻す。
 */
export function isDataRow(values: Record<string, string>): boolean {
  if (!Object.values(values).some((v) => v.trim())) return false;
  return !((values.id || values.space || '').startsWith('#'));
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
