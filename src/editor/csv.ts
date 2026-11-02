// イベントデータの CSV（data/circles.csv・data/menus.csv）の読み書き。CLI（tools/caimawaru/）と同じ形で書く:
// - UTF-8（BOM なし）、行末 CRLF。「,」「"」CR・LF を含む値だけ「"」で囲み、中の「"」は「""」にする（Python の csv の QUOTE_MINIMAL）
// - 列名の行は、決まった列（CIRCLE_COLS・MENU_COLS）をこの順に、そのあとにファイルにあったほかの列を元の順に（値も残す）。
//   ほかの列は名前ではなく位置で扱うので、列名が空でも、同じ名前が2回あってもよい（列名の文字もそのまま書く）
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

/**
 * 1行。普通の行は、決まった列の値（列名 → 値。ファイルにない列は ''）と、ほかの列の値（位置の順）を持つ。
 * コメントの行（最初の値が「#」で始まる）は読んだ値の並びをそのまま持つ
 */
export type CsvRow = { values: Record<string, string>; extra: string[] } | { comment: string[] };

export type CsvTable = {
  /** ファイルの1行目（列名） */
  header: string[];
  /** ほかの列の列名（位置の順。空や重複もそのまま） */
  extraHeader: string[];
  rows: CsvRow[];
};

/**
 * CSV を読む。standard は決まった列（CIRCLE_COLS・MENU_COLS）。
 * 空の行（どの値も空か空白だけの行を含む）は捨て、コメントの行はその位置に残す。値が足りない行は空欄で埋める。
 * 次のときは、保存すると内容が失われる・取り違えるので CsvError にする:
 * 列名の行に決まった列が1つもない（空白だけの行など）、決まった列の名前が2回ある、列名より値が多い行（コメントの行を除く）がある。
 */
export function parseCsv(text: string, standard: readonly string[]): CsvTable {
  // 列名の行は、最初の（本当に）空でない行。空白だけの行を飛ばして次の行を列名にすることはしない
  const [first, ...rest] = scan(text).filter((r) => r.fields.length > 0);
  if (!first) return { header: [], extraHeader: [], rows: [] };
  const header = first.fields;
  if (!header.some((c) => standard.includes(c))) {
    throw new CsvError(`${first.line} 行目（列名）に決まった列（${standard.join('・')}）が1つもありません`);
  }
  const dup = header.find((c, i) => standard.includes(c) && header.indexOf(c) !== i);
  if (dup !== undefined) throw new CsvError(`${first.line} 行目（列名）の「${dup}」が重複しています`);
  const at = new Map(header.map((c, i) => [c, i] as const).filter(([c]) => standard.includes(c)));
  const extraAt = header.map((c, i) => (standard.includes(c) ? -1 : i)).filter((i) => i >= 0);
  // 列名より後ろの、どの値も空か空白だけの行（「,,,」）は空の行と同じく捨てる（Python の read_csv も読まない）
  const records = rest.filter((r) => r.fields.some((f) => f.trim()));
  const rows = records.map(({ fields, line }): CsvRow => {
    if (fields[0].startsWith('#')) return { comment: fields }; // 列名より値が多くても残す
    if (fields.length > header.length) {
      throw new CsvError(`${line} 行目の値が列名より多くあります（値 ${fields.length} 個・列名 ${header.length} 個）`);
    }
    return {
      values: Object.fromEntries(standard.map((c) => [c, at.has(c) ? (fields[at.get(c)!] ?? '') : ''])),
      extra: extraAt.map((i) => fields[i] ?? ''),
    };
  });
  return { header, extraHeader: extraAt.map((i) => header[i]), rows };
}

function quote(value: string): string {
  return /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 書く1行。決まった列の値（列名 → 値）とほかの列の値（位置の順）か、コメントの行 */
export type CsvOutRow = { values: Record<string, string | undefined>; extra?: readonly string[] } | { comment: readonly string[] };

/**
 * 列名の行と各行を CSV にする（UTF-8・BOM なし・行末 CRLF・必要なときだけ「"」で囲む。Python の csv と同じ書き方）。
 * 列は決まった列（standard）のあとに、ほかの列（extraHeader。位置の順）。足りない値は空欄。
 * コメントの行は読んだ値をそのまま（数も変えず、空欄で埋めずに）書く。
 */
export function formatCsv(standard: readonly string[], extraHeader: readonly string[], rows: readonly CsvOutRow[]): string {
  const line = (values: readonly (string | undefined)[]) => values.map((v) => quote(v ?? '')).join(',') + '\r\n';
  return line([...standard, ...extraHeader]) + rows.map((row) => {
    if ('comment' in row) return line(row.comment);
    return line([...standard.map((c) => row.values[c]), ...extraHeader.map((_, i) => row.extra?.[i])]);
  }).join('');
}
