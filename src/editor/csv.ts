// イベントデータの CSV（data/circles.csv・data/menus.csv）の読み書き。CLI（tools/caimawaru/）と同じ形で書く:
// - UTF-8（BOM なし）、行末 CRLF。「,」「"」CR・LF を含む値だけ「"」で囲み、中の「"」は「""」にする（Python の csv の QUOTE_MINIMAL）
// - 列名の行は、決まった列（CIRCLE_COLS・MENU_COLS）をこの順に、そのあとにファイルにあったほかの列を元の順に（値も残す）。
//   ほかの列は名前ではなく位置で扱うので、列名が空でも、同じ名前が2回あってもよい（列名の文字もそのまま書く）
// - 行はファイルの順（足した行は最後）。足りない値は空欄。空の行と、どの値も空か空白だけの行は捨てる
// - コメントの行（最初の値が「#」で始まる）はその位置に残し、読んだ値をすべてそのまま書く（値の数も変えない。列名より多くてもよい）
// - 読み込みは Python の csv.reader（strict=True）と同じ（囲みの中の改行・「,」は値に入る。囲みの外の CRLF・LF・CR はどれも行の終わり。BOM は除く）。
//   閉じていない「"」・閉じた「"」の後ろの文字は CSV として読めないので CsvError

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
          // 閉じた「"」のすぐ後ろに「,」・行末以外があると、どこまでが値か決まらないので読まない（Python の csv の strict=True と同じ）
          throw new CsvError(`${startLine} 行目からの行で、「"」で囲んだ値の閉じる「"」の後ろに文字があります（「"ab"c」のような形）`);
        }
        break;
    }
    if (newline) line++;
  }
  // 「"」が閉じないままファイルが終わったときは、どこまでが値か分からないので読まない
  if (state === 'quoted') throw new CsvError(`${startLine} 行目からの行で、「"」で囲んだ値がファイルの終わりまで閉じていません`);
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

/** CSV として読めない（「"」が閉じていないなど） */
export class CsvError extends Error {}

/**
 * 1行。普通の行は、決まった列の値（列名 → 値。ファイルにない列は ''）と、ほかの列の値（位置の順）を持つ。
 * コメントの行（最初の値が「#」で始まる）は読んだ値の並びをそのまま持つ
 */
export type CsvRow = { values: Record<string, string>; extra: string[] } | { comment: string[] };

export type CsvTable = {
  /** ファイルの見出し（列名）の行。見出しがなければ [] */
  header: string[];
  /** 決まった列のあとに書く、ほかの列の列名（位置の順。空や重複もそのまま） */
  extraHeader: string[];
  /** 見出しの行より前にあったコメントの行（見出しの前にそのまま書く） */
  lead: string[][];
  rows: CsvRow[];
  /** 見出しに決まった列が1つもない（すべてほかの列として扱う） */
  noStandard: boolean;
  /** 読み方の知らせ（決まった列の重複・見出しより長い行など）。読めないわけではない */
  notes: string[];
};

/**
 * CSV を読む。standard は決まった列（CIRCLE_COLS・MENU_COLS）。
 * そのまま書き戻して内容が失われたり変わったりしないかぎり、どんな形でも読む（読めないのは CSV として壊れているときだけ）:
 * - 空の行と、どの値も空か空白だけの行は、見出しの前でも後でも捨てる
 * - コメントの行（最初の値が「#」で始まる）はその位置に残す（見出しより前のものは見出しの前に）
 * - 決まった列の名前が2回あれば、最初のものを決まった列にし、後のものはほかの列として位置で扱う
 * - 見出しより値が多い行は、最初の値に「#」を付けてコメントの行にする（値はすべて残す。見出しは変えない）
 * - 値が足りない行は空欄で埋める
 */
export function parseCsv(text: string, standard: readonly string[]): CsvTable {
  const notes: string[] = [];
  const lead: string[][] = [];
  // 空の行と、どの値も空か空白だけの行（「,,,」）は捨てる（Python の read_csv も読まない）
  const records = scan(text).filter((r) => r.fields.some((f) => f.trim()));
  let h = 0;
  while (h < records.length && records[h].fields[0].startsWith('#')) lead.push(records[h++].fields);
  const first = records[h];
  if (!first) return { header: [], extraHeader: [], lead, rows: [], noStandard: false, notes };
  const header = first.fields;
  // 決まった列は、同じ名前の最初の列。2つ目からはほかの列
  const at = new Map<string, number>();
  header.forEach((c, i) => {
    if (standard.includes(c) && !at.has(c)) at.set(c, i);
  });
  for (const c of at.keys()) {
    const n = header.filter((x) => x === c).length;
    if (n > 1) notes.push(`${first.line} 行目（見出し）に ${c} 列が ${n} つあります。最初の列を使い、ほかはそのまま残します`);
  }
  const extraAt = header.map((_, i) => i).filter((i) => ![...at.values()].includes(i));
  const extraHeader = extraAt.map((i) => header[i]);
  const data = records.slice(h + 1);
  const rows = data.map(({ fields, line }): CsvRow => {
    if (fields[0].startsWith('#')) return { comment: fields }; // 値の数が違ってもそのまま
    if (fields.length > header.length) {
      // 見出しより値が多い行は、どの列の値か決まらないので、最初の値に「#」を付けてコメントの行にする（値はすべて残す。「#」を外せば戻せる）
      notes.push(`${line} 行目は見出しより列が多いため、コメント行にしました（保存すると最初の値の前に「#」が付きます）`);
      return { comment: [`#${fields[0]}`, ...fields.slice(1)] };
    }
    return {
      values: Object.fromEntries(standard.map((c) => [c, at.has(c) ? (fields[at.get(c)!] ?? '') : ''])),
      extra: extraAt.map((i) => fields[i] ?? ''),
    };
  });
  return { header, extraHeader, lead, rows, noStandard: at.size === 0, notes };
}

function quote(value: string): string {
  return /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 書く1行。決まった列の値（列名 → 値）とほかの列の値（位置の順）か、コメントの行 */
export type CsvOutRow = { values: Record<string, string | undefined>; extra?: readonly string[] } | { comment: readonly string[] };

/**
 * 列名の行と各行を CSV にする（UTF-8・BOM なし・行末 CRLF・必要なときだけ「"」で囲む。Python の csv と同じ書き方）。
 * 列は決まった列（standard）のあとに、ほかの列（extraHeader。位置の順）。足りない値は空欄。
 * コメントの行は読んだ値をそのまま（数も変えず、空欄で埋めずに）書く。lead は見出しの前に書くコメントの行。
 */
export function formatCsv(
  standard: readonly string[],
  extraHeader: readonly string[],
  rows: readonly CsvOutRow[],
  lead: readonly (readonly string[])[] = [],
): string {
  const line = (values: readonly (string | undefined)[]) => values.map((v) => quote(v ?? '')).join(',') + '\r\n';
  return lead.map(line).join('') + line([...standard, ...extraHeader]) + rows.map((row) => {
    if ('comment' in row) return line(row.comment);
    return line([...standard.map((c) => row.values[c]), ...extraHeader.map((_, i) => row.extra?.[i])]);
  }).join('');
}
