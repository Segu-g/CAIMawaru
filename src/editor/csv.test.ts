import { describe, expect, it } from 'vitest';
import { CsvError, formatCsv, outputColumns, parseCsv, parseRecords, type CsvRow } from './csv';
import { CIRCLE_COLS, MENU_COLS } from './model';
// ファイルの中身をそのまま（改行も変えずに）読む
import circlesCsv from '../../events/example/data/circles.csv?raw';
import menusCsv from '../../events/example/data/menus.csv?raw';

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));
const values = (v: Record<string, string>): CsvRow => ({ values: v });

/** 読んで、決まった列（+ ほかの列）で書き戻す（エディタが保存するのと同じ） */
function roundTrip(text: string, standard: readonly string[] = MENU_COLS): string {
  const { header, rows } = parseCsv(text);
  return formatCsv(outputColumns(standard, header), rows);
}

describe('events/example の CSV を読んで書き戻すと同じバイト列になる', () => {
  it.each([
    ['circles.csv', circlesCsv, CIRCLE_COLS],
    ['menus.csv', menusCsv, MENU_COLS],
  ] as const)('%s', (_, original, cols) => {
    expect(original).toContain('\r\n');
    const { header, rows } = parseCsv(original);
    expect(header).toEqual(cols);
    expect(rows.length).toBeGreaterThan(0);
    expect(bytes(roundTrip(original, cols))).toEqual(bytes(original));
  });
});

describe('Python の csv.DictWriter（project.write_csv）と同じ書き方', () => {
  // 期待値は tools/caimawaru/project.py の write_csv（Python 3.13 の csv）で同じ行を書いた結果
  const rows = [
    { id: 'a-01', url: 'https://example.com/a?x=1,2', note: '新刊 "総集編"', checkedAt: '2030-01-01' },
    { id: 'a-02', url: 'https://example.com/b', note: '1行目\n2行目', checkedAt: '' },
    { id: 'a-03', url: 'https://example.com/c', note: ' 前後の空白 ', checkedAt: '' },
    { id: 'a-04', url: 'https://example.com/d', note: 'CRLF\r\nを含む', checkedAt: '' },
    { id: 'a-05', url: '', note: '"', checkedAt: ',' },
  ];
  const python =
    'id,url,note,checkedAt\r\na-01,"https://example.com/a?x=1,2","新刊 ""総集編""",2030-01-01\r\n' +
    'a-02,https://example.com/b,"1行目\n2行目",\r\na-03,https://example.com/c, 前後の空白 ,\r\n' +
    'a-04,https://example.com/d,"CRLF\r\nを含む",\r\na-05,,"""",","\r\n';

  it('「,」「"」改行を含む値・日本語・前後の空白', () => {
    expect(formatCsv(MENU_COLS, rows.map(values))).toBe(python);
  });

  it('書いたものを読むと元の値に戻り、もう一度書くと同じになる', () => {
    expect(parseCsv(python).rows).toEqual(rows.map(values));
    expect(roundTrip(python)).toBe(python);
  });

  it('CR だけの値も「"」で囲む。足りない値は空欄', () => {
    expect(formatCsv(['id', 'v'], [values({ id: '1', v: 'a\rb' }), values({ id: '2' })])).toBe('id,v\r\n1,"a\rb"\r\n2,\r\n');
  });

  it('行がなければ列名の行だけ', () => {
    expect(formatCsv(MENU_COLS, [])).toBe('id,url,note,checkedAt\r\n');
  });
});

describe('CLI と同じ形（列の順・空の行・コメントの行・ほかの列）', () => {
  it('空の行は捨てる（先頭・途中・末尾）', () => {
    expect(roundTrip('\r\n\r\nid,url,note,checkedAt\r\n\r\na-01,https://example.com/m,,\r\n\r\n\r\n')).toBe(
      'id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\n',
    );
  });

  it('どの値も空か空白だけの行（「,,,」「, ,」）は空の行と同じく捨てる', () => {
    expect(roundTrip(',,,\r\nid,url,note,checkedAt\r\n,,,\r\na-01,https://example.com/m,,\r\n, ,\t,\r\n"",""\r\na-02,,,\r\n')).toBe(
      'id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\na-02,,,\r\n',
    );
  });

  it('id が空で space が「#」で始まる行はコメントではない（最初の値だけで見分ける）', () => {
    const text = 'id,space,name\r\n,#A-01,サンプル\r\n';
    expect(parseCsv(text).rows).toEqual([values({ id: '', space: '#A-01', name: 'サンプル' })]);
    expect(roundTrip(text, ['id', 'space', 'name'])).toBe(text);
  });

  it('LF・CR の行末は CRLF にする', () => {
    expect(roundTrip('id,url,note,checkedAt\na-01,https://example.com/m,新刊,\ra-02,,,\n')).toBe(
      'id,url,note,checkedAt\r\na-01,https://example.com/m,新刊,\r\na-02,,,\r\n',
    );
  });

  it('BOM は除いて書かない', () => {
    const out = roundTrip('﻿id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\n');
    expect(out).toBe('id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\n');
    expect(bytes(out).slice(0, 3)).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it('コメントの行はその位置に、読んだ値をすべてそのまま書く（数を変えず、空欄で埋めない）', () => {
    const text = 'id,url,note,checkedAt\r\n# 確認中,,,\r\na-01,https://example.com/m,,\r\n#末尾\r\n#2つ, 前後の空白 \r\n';
    const { rows } = parseCsv(text);
    expect(rows).toEqual([
      { comment: ['# 確認中', '', '', ''] },
      values({ id: 'a-01', url: 'https://example.com/m', note: '', checkedAt: '' }),
      { comment: ['#末尾'] },
      { comment: ['#2つ', ' 前後の空白 '] },
    ]);
    expect(roundTrip(text)).toBe(text);
  });

  it('サークルの行をまるごとコメントにしたものは、値も数もそのまま残す', () => {
    const text =
      'id,space,event,name,kana,penNames,tags,adult,x,pixiv,booth,web,notes,source\r\n' +
      '#a-02,A-02,サンプル即売会,まどろみ書房,,作家2,,0,,,,https://example.com/circle2,,架空の公式サークル一覧\r\n' +
      'a-03-a-04,"A-03,A-04",サンプル即売会,青い鳥工房,,作家3,,0,,,,https://example.com/circle3,,架空の公式サークル一覧\r\n';
    const { rows } = parseCsv(text);
    expect(rows[0]).toEqual({
      comment: ['#a-02', 'A-02', 'サンプル即売会', 'まどろみ書房', '', '作家2', '', '0', '', '', '', 'https://example.com/circle2', '', '架空の公式サークル一覧'],
    });
    expect(roundTrip(text, CIRCLE_COLS)).toBe(text);
  });

  it('「,」「"」改行を含むコメントの行は必要な値だけ「"」で囲む', () => {
    const text = 'id,url,note,checkedAt\r\n"#あとで, 見る","say ""hi""","複数\n行",x\r\n';
    expect(parseCsv(text).rows).toEqual([{ comment: ['#あとで, 見る', 'say "hi"', '複数\n行', 'x'] }]);
    expect(roundTrip(text)).toBe(text);
    // 余計な囲みは外れる（Python の csv と同じ書き方にそろう）
    expect(roundTrip('id,url\r\n"#メモ","a"\r\n', ['id', 'url'])).toBe('id,url\r\n#メモ,a\r\n');
  });

  it('列名より値が多いコメントの行は読めて、そのまま書く', () => {
    const text = 'id,url\r\n#メモ,a,b,c\r\na-01,https://example.com/m\r\n';
    expect(parseCsv(text).rows[0]).toEqual({ comment: ['#メモ', 'a', 'b', 'c'] });
    expect(roundTrip(text, ['id', 'url'])).toBe(text);
  });

  it('「#」が最初の値でなければコメントではない', () => {
    expect(parseCsv('id,url\r\n a#,#x\r\n').rows).toEqual([values({ id: ' a#', url: '#x' })]);
  });

  it('列名は決まった列の順に並べ、ほかの列は元の順でそのあとに（値も残す）', () => {
    const text = 'memo,url,id,extra2\r\nメモ,https://example.com/m,a-01,"x,y"\r\n';
    expect(outputColumns(MENU_COLS, parseCsv(text).header)).toEqual(['id', 'url', 'note', 'checkedAt', 'memo', 'extra2']);
    expect(roundTrip(text)).toBe('id,url,note,checkedAt,memo,extra2\r\na-01,https://example.com/m,,,メモ,"x,y"\r\n');
  });

  it('値が足りない行は空欄で埋める', () => {
    expect(roundTrip('id,url,note,checkedAt\r\na-01\r\n')).toBe('id,url,note,checkedAt\r\na-01,,,\r\n');
  });

  it('列名が空・重複、列名より値が多い行は読まない（内容が失われるため）', () => {
    expect(() => parseCsv('id,,note\r\n')).toThrow(CsvError);
    expect(() => parseCsv('id,url,\r\n')).toThrow('3 番目の列名が空');
    expect(() => parseCsv('id,url,id\r\n')).toThrow('「id」が重複');
    expect(() => parseCsv('id,url\r\na-01,u\r\na-02,"複数\n行",余分\r\n')).toThrow('3 行目の値が列名より多く');
  });
});

describe('Python の csv.reader と同じ読み方', () => {
  it('行末は CRLF・LF・CR のどれでもよく、空の行は飛ばす', () => {
    expect(parseCsv('id,v\n\n1,x\r\n2,y\r3,z').rows).toEqual([values({ id: '1', v: 'x' }), values({ id: '2', v: 'y' }), values({ id: '3', v: 'z' })]);
  });

  it('BOM を除く', () => {
    expect(parseCsv('﻿id,v\r\n1,2\r\n').header).toEqual(['id', 'v']);
  });

  it('囲みの中の改行は値に入る（CRLF もそのまま）', () => {
    expect(parseRecords('a,"x\r\ny"\r\n')).toEqual([['a', 'x\r\ny']]);
  });

  it('囲みのない値の中の「"」はそのまま、閉じた「"」の後ろの文字は値に足す', () => {
    expect(parseRecords('1,ab"c\r\n1,"ab"c\r\n')).toEqual([['1', 'ab"c'], ['1', 'abc']]);
  });

  it('最後の値が空・閉じていない「"」', () => {
    expect(parseRecords('a,')).toEqual([['a', '']]);
    expect(parseRecords('a,"b')).toEqual([['a', 'b']]);
  });

  it('値の前後の空白は残す（書き戻す前提）', () => {
    expect(parseRecords(' a , b ')).toEqual([[' a ', ' b ']]);
  });
});
