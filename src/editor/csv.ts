// イベントデータの CSV（data/circles.csv・data/menus.csv）の読み書き。CLI（tools/caimawaru/）と同じ形で書く:
// - UTF-8（BOM なし）、行末 CRLF。「,」「"」CR・LF を含む値だけ「"」で囲み、中の「"」は「""」にする（Python の csv の QUOTE_MINIMAL）
// - 列名の行は、決まった列（CIRCLE_COLS・MENU_COLS）をこの順に、そのあとにファイルにあったほかの列を元の順に（値も残す）
// - 行はファイルの順（足した行は最後）。足りない値は空欄。空の行と、どの値も空か空白だけの行は捨てる
// - コメントの行（最初の値が「#」で始まる）はその位置に残し、読んだ値をすべてそのまま書く（値の数も変えない。列名より多くてもよい）
// - 読み込みは Python の csv.reader と同じ（囲みの中の改行・「,」は値に入る。囲みの外の CRLF・LF・CR はどれも行の終わり。BOM は除く）

type Scanned = { fields: string[]; line: number };

/** CSV を値の配列の配列にする（Python の csv.reader と同じ。空の行は [] になる）。 */
export function parseRecords(text: string): string[][] {
  return scan(text).map((r) => r.fields);
}

/** 各レコードと、それが始まる行番号（1 から。エラーの表示用） */
function scan(text: string): Scanned[] {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const records: Scanned[] = [];
  let record: string[] = [];
  let field = '';
  let line = 1;
  let startLine = 1;
  // start: 行の始め / field: 値の始め / plain: 囲みのない値 / quoted: 「"」の中 / quote: 「"」の中で「"」を読んだ直後
  let state: 'start' | 'field' | 'plain' | 'quoted' | 'quote' = 'start';
  const endRecord = () => {
    records.push({ fields: record, line: startLine });
    record = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const eol = c === '\r' || c === '\n';
    const crlf = c === '\r' && src[i + 1] === '\n';
    // 行の数え方: CRLF は1行。囲みの外の CRLF は「\n」を読み飛ばすので、ここで数える
    let newline = eol && !crlf;
    if (crlf && state !== 'quoted') {
      i++;
      newline = true;
    }
    if (state === 'start') startLine = line;
    if (state === 'start' && eol) {
      endRecord(); // 空の行
      if (newline) line++;
      continue;
    }
    switch (state) {
      case 'start':
      case 'field':
        if (eol) {
          record.push('');
          endRecord();
          state = 'start';
        } else if (c === '"') state = 'quoted';
        else if (c === ',') {
          record.push('');
          state = 'field';
        } else {
          field = c;
          state = 'plain';
        }
        break;
      case 'plain':
        if (eol) {
          record.push(field);
          field = '';
          endRecord();
          state = 'start';
        } else if (c === ',') {
          record.push(field);
          field = '';
          state = 'field';
        } else field += c;
        break;
      case 'quoted':
        if (c === '"') state = 'quote';
        else field += c;
        break;
      case 'quote':
        if (c === '"') {
          field += '"';
          state = 'quoted';
        } else if (c === ',') {
          record.push(field);
          field = '';
          state = 'field';
        } else if (eol) {
          record.push(field);
          field = '';
          endRecord();
          state = 'start';
        } else {
          // 閉じた「"」の後ろの文字は値に足す（Python の strict=False と同じ）
          field += c;
          state = 'plain';
        }
        break;
    }
    if (newline) line++;
  }
  // 最後の行に行末がないとき
  if (state === 'field') {
    record.push('');
    endRecord();
  } else if (state !== 'start') {
    record.push(field);
    endRecord();
  }
  return records;
}

/** 読めない（そのまま保存すると内容が失われる）CSV */
export class CsvError extends Error {}

/** 1行。普通の行は列名 → 値、コメントの行（最初の値が「#」で始まる）は読んだ値の並びをそのまま持つ */
export type CsvRow = { values: Record<string, string> } | { comment: string[] };

export type CsvTable = {
  /** ファイルの1行目（列名） */
  header: string[];
  rows: CsvRow[];
};

/**
 * CSV を列名つきの行にする。空の行（どの値も空か空白だけの行を含む）は捨て、コメントの行はその位置に残す。値が足りない行は空欄で埋める。
 * 列名に空のもの・重複があるとき、列名より値が多い行があるときは、保存すると内容が失われるので CsvError にする。
 */
export function parseCsv(text: string): CsvTable {
  // 列名の行は、最初の（本当に）空でない行。空白だけの行を飛ばして次の行を列名にすることはしない
  const [first, ...rest] = scan(text).filter((r) => r.fields.length > 0);
  if (!first) return { header: [], rows: [] };
  const header = first.fields;
  const empty = header.findIndex((c) => !c.trim());
  if (empty >= 0) throw new CsvError(`${first.line} 行目（列名）の ${empty + 1} 番目の列名が空です`);
  const dup = header.find((c, i) => header.indexOf(c) !== i);
  if (dup !== undefined) throw new CsvError(`${first.line} 行目（列名）の「${dup}」が重複しています`);
  // 列名より後ろの、どの値も空か空白だけの行（「,,,」）は空の行と同じく捨てる（Python の read_csv も読まない）
  const records = rest.filter((r) => r.fields.some((f) => f.trim()));
  const rows = records.map(({ fields, line }): CsvRow => {
    if (fields[0].startsWith('#')) return { comment: fields }; // 列名より値が多くても残す
    if (fields.length > header.length) {
      throw new CsvError(`${line} 行目の値が列名より多くあります（値 ${fields.length} 個・列名 ${header.length} 個）`);
    }
    return { values: Object.fromEntries(header.map((col, i) => [col, fields[i] ?? ''])) };
  });
  return { header, rows };
}

/** 書き出す列: 決まった列をこの順に、そのあとにファイルにあったほかの列を元の順に */
export function outputColumns(standard: readonly string[], header: readonly string[]): string[] {
  return [...standard, ...header.filter((c) => !standard.includes(c))];
}

function quote(value: string): string {
  return /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 書く1行。値（列名 → 値）か、コメントの行 */
export type CsvOutRow = { values: Record<string, string | undefined> } | { comment: readonly string[] };

/**
 * 列名の行と各行を CSV にする（UTF-8・BOM なし・行末 CRLF・必要なときだけ「"」で囲む。Python の csv と同じ書き方）。
 * 足りない値は空欄。コメントの行は読んだ値をそのまま（数も変えず、空欄で埋めずに）書く。
 */
export function formatCsv(columns: readonly string[], rows: readonly CsvOutRow[]): string {
  const line = (values: (string | undefined)[]) => values.map((v) => quote(v ?? '')).join(',') + '\r\n';
  return line([...columns]) + rows.map((row) => ('comment' in row ? line([...row.comment]) : line(columns.map((c) => row.values[c])))).join('');
}
