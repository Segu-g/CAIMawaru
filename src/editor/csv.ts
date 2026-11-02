// イベントデータの CSV（data/circles.csv・data/menus.csv）の読み書き。
// Python の tools/caimawaru/project.py（read_rows・write_csv。標準ライブラリ csv の excel 方言）と同じ結果になるようにする。
// - 書き出し: 列名の行 → 各行。区切りは「,」、行末は CRLF、BOM なし。「,」「"」「CR」「LF」を含む値だけ「"」で囲み、
//   中の「"」は「""」にする。columns にない列は書かない（Python の extrasaction="ignore"）
// - 読み込み: 「"」で囲んだ値の中の改行・「,」はそのまま値に入る。囲みの外の CRLF・LF・CR はどれも行の終わり。
//   空の行は無視する（csv.DictReader）。値の前後の空白は残す（書き戻す前提の read_rows と同じ）

/** CSV を値の配列の配列にする（Python の csv.reader と同じ。空の行は [] になる）。 */
export function parseRecords(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  // start: 行の始め / field: 値の始め / plain: 囲みのない値 / quoted: 「"」の中 / quote: 「"」の中で「"」を読んだ直後
  let state: 'start' | 'field' | 'plain' | 'quoted' | 'quote' = 'start';
  const endRecord = () => {
    records.push(record);
    record = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const eol = c === '\r' || c === '\n';
    if (eol && c === '\r' && src[i + 1] === '\n' && state !== 'quoted') i++; // CRLF は1つの行末
    if (state === 'start' && eol) {
      endRecord(); // 空の行
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

export type CsvTable = {
  /** ファイルの1行目（列名）。書き出すときは決まった列（CIRCLE_COLS・MENU_COLS）を使う */
  header: string[];
  /** 各行。列名 → 値（足りない列は ''）。列名より多い値は捨てる（Python も書き戻さない） */
  rows: Record<string, string>[];
};

/** CSV を列名つきの行にする（Python の csv.DictReader と同じく、空の行は飛ばす）。 */
export function parseCsv(text: string): CsvTable {
  const [header = [], ...records] = parseRecords(text);
  const rows = records
    .filter((r) => r.length > 0)
    .map((r) => {
      const row: Record<string, string> = {};
      // 同じ列名が2回あれば後ろの値（DictReader と同じ）
      header.forEach((col, i) => {
        if (col) row[col] = r[i] ?? '';
      });
      return row;
    });
  return { header, rows };
}

function quote(value: string): string {
  return /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 列名の行と各行を CSV にする（Python の project.write_csv と同じバイト列になる）。 */
export function formatCsv(columns: readonly string[], rows: readonly Record<string, string | undefined>[]): string {
  const line = (values: (string | undefined)[]) => values.map((v) => quote(v ?? '')).join(',') + '\r\n';
  return line([...columns]) + rows.map((row) => line(columns.map((c) => row[c]))).join('');
}
