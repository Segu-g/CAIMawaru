import { describe, expect, it } from 'vitest';
import { CsvError, formatCsv, parseCsv, parseRecords, type CsvRow } from './csv';
import { CIRCLE_COLS, MENU_COLS } from './model';
// ファイルの中身をそのまま（改行も変えずに）読む
import circlesCsv from '../../events/example/data/circles.csv?raw';
import menusCsv from '../../events/example/data/menus.csv?raw';

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));
const values = (v: Record<string, string>, extra: string[] = []): CsvRow => ({ values: v, extra });
const parse = (text: string, standard: readonly string[] = MENU_COLS) => parseCsv(text, standard);

/** 読んで、決まった列（+ ほかの列）で書き戻す（エディタが保存するのと同じ） */
function roundTrip(text: string, standard: readonly string[] = MENU_COLS): string {
  const { extraHeader, rows, lead } = parse(text, standard);
  return formatCsv(standard, extraHeader, rows, lead);
}

describe('events/example の CSV を読んで書き戻すと同じバイト列になる', () => {
  it.each([
    ['circles.csv', circlesCsv, CIRCLE_COLS],
    ['menus.csv', menusCsv, MENU_COLS],
  ] as const)('%s', (_, original, cols) => {
    expect(original).toContain('\r\n');
    const { header, rows } = parse(original, cols);
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
    expect(formatCsv(MENU_COLS, [], rows.map((v) => values(v)))).toBe(python);
  });

  it('書いたものを読むと元の値に戻り、もう一度書くと同じになる', () => {
    expect(parse(python).rows).toEqual(rows.map((v) => values(v)));
    expect(roundTrip(python)).toBe(python);
  });

  it('CR だけの値も「"」で囲む。足りない値は空欄', () => {
    expect(formatCsv(['id', 'v'], [], [values({ id: '1', v: 'a\rb' }), values({ id: '2' })])).toBe('id,v\r\n1,"a\rb"\r\n2,\r\n');
  });

  it('行がなければ列名の行だけ', () => {
    expect(formatCsv(MENU_COLS, [], [])).toBe('id,url,note,checkedAt\r\n');
  });
});

describe('CLI と同じ形（列の順・空の行・コメントの行・ほかの列）', () => {
  it('空の行は捨てる（先頭・途中・末尾）', () => {
    expect(roundTrip('\r\n\r\nid,url,note,checkedAt\r\n\r\na-01,https://example.com/m,,\r\n\r\n\r\n')).toBe(
      'id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\n',
    );
  });

  it('列名より後ろの、どの値も空か空白だけの行（「,,,」「, ,」）は空の行と同じく捨てる', () => {
    expect(roundTrip('\r\nid,url,note,checkedAt\r\n,,,\r\na-01,https://example.com/m,,\r\n, ,\t,\r\n"",""\r\na-02,,,\r\n')).toBe(
      'id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\na-02,,,\r\n',
    );
  });

  it('見出しの前の、空の行・どの値も空か空白だけの行は飛ばす', () => {
    expect(roundTrip(',,,\r\n\r\n, ,\t\r\n \r\nid,url,note,checkedAt\r\na-01,u,,\r\n')).toBe('id,url,note,checkedAt\r\na-01,u,,\r\n');
  });

  it('見出しの前の「#」の行は、コメントの行として見出しの前にそのまま書く', () => {
    const text = '# メモ,"a,b"\r\n\r\n#2\r\nid,url,note,checkedAt\r\na-01,u,,\r\n';
    const t = parse(text);
    expect(t.lead).toEqual([['# メモ', 'a,b'], ['#2']]);
    expect(t.header).toEqual(['id', 'url', 'note', 'checkedAt']);
    expect(roundTrip(text)).toBe('# メモ,"a,b"\r\n#2\r\nid,url,note,checkedAt\r\na-01,u,,\r\n');
    expect(roundTrip('#だけ\r\n')).toBe('#だけ\r\nid,url,note,checkedAt\r\n');
  });

  it('id 列のない見出し・決まった列が1つもない見出しも読む（決まった列がなければ、すべてほかの列）', () => {
    const noId = 'space,name\r\nA-01,サンプル\r\n';
    expect(parse(noId, CIRCLE_COLS).rows[0]).toMatchObject({ values: { id: '', space: 'A-01', name: 'サンプル' } });
    expect(parse(noId, CIRCLE_COLS).noStandard).toBe(false);
    const none = 'a-01,A-01\r\na-02,A-02\r\n';
    const t = parse(none);
    expect(t.noStandard).toBe(true);
    expect(t.extraHeader).toEqual(['a-01', 'A-01']);
    expect(t.rows).toEqual([values({ id: '', url: '', note: '', checkedAt: '' }, ['a-02', 'A-02'])]);
    expect(roundTrip(none)).toBe('id,url,note,checkedAt,a-01,A-01\r\n,,,,a-02,A-02\r\n');
  });

  it('id が空で space が「#」で始まる行はコメントではない（最初の値だけで見分ける）', () => {
    const text = 'id,space,name\r\n,#A-01,サンプル\r\n';
    expect(parse(text, ['id', 'space', 'name']).rows).toEqual([values({ id: '', space: '#A-01', name: 'サンプル' })]);
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
    const { rows } = parse(text);
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
    const { rows } = parse(text);
    expect(rows[0]).toEqual({
      comment: ['#a-02', 'A-02', 'サンプル即売会', 'まどろみ書房', '', '作家2', '', '0', '', '', '', 'https://example.com/circle2', '', '架空の公式サークル一覧'],
    });
    expect(roundTrip(text, CIRCLE_COLS)).toBe(text);
  });

  it('「,」「"」改行を含むコメントの行は必要な値だけ「"」で囲む', () => {
    const text = 'id,url,note,checkedAt\r\n"#あとで, 見る","say ""hi""","複数\n行",x\r\n';
    expect(parse(text).rows).toEqual([{ comment: ['#あとで, 見る', 'say "hi"', '複数\n行', 'x'] }]);
    expect(roundTrip(text)).toBe(text);
    // 余計な囲みは外れる（Python の csv と同じ書き方にそろう）
    expect(roundTrip('id,url\r\n"#メモ","a"\r\n', ['id', 'url'])).toBe('id,url\r\n#メモ,a\r\n');
  });

  it('列名より値が多いコメントの行は読めて、そのまま書く', () => {
    const text = 'id,url\r\n#メモ,a,b,c\r\na-01,https://example.com/m\r\n';
    expect(parse(text).rows[0]).toEqual({ comment: ['#メモ', 'a', 'b', 'c'] });
    expect(roundTrip(text, ['id', 'url'])).toBe(text);
  });

  it('「#」が最初の値でなければコメントではない', () => {
    expect(parse('id,url\r\n a#,#x\r\n', ['id', 'url']).rows).toEqual([values({ id: ' a#', url: '#x' })]);
  });

  it('列名は決まった列の順に並べ、ほかの列は元の順でそのあとに（値も残す）', () => {
    const text = 'memo,url,id,extra2\r\nメモ,https://example.com/m,a-01,"x,y"\r\n';
    expect(parse(text).extraHeader).toEqual(['memo', 'extra2']);
    expect(parse(text).rows).toEqual([values({ id: 'a-01', url: 'https://example.com/m', note: '', checkedAt: '' }, ['メモ', 'x,y'])]);
    expect(roundTrip(text)).toBe('id,url,note,checkedAt,memo,extra2\r\na-01,https://example.com/m,,,メモ,"x,y"\r\n');
  });

  it('値が足りない行は空欄で埋める', () => {
    expect(roundTrip('id,url,note,checkedAt\r\na-01\r\n')).toBe('id,url,note,checkedAt\r\na-01,,,\r\n');
  });

  it('ほかの列は位置で扱う: 末尾の「,」でできた名前のない列の値も残す', () => {
    const text = 'id,url,note,checkedAt,\r\na-01,https://example.com/m,,,名前のない列の値\r\na-02,,,,\r\n';
    expect(parse(text).extraHeader).toEqual(['']);
    expect(parse(text).rows[0]).toEqual(values({ id: 'a-01', url: 'https://example.com/m', note: '', checkedAt: '' }, ['名前のない列の値']));
    expect(roundTrip(text)).toBe(text);
  });

  it('名前のない列が2つ・同じ名前のほかの列が2つあっても、位置ごとに残す', () => {
    const text = 'id,,url,memo,,memo\r\na-01,x,https://example.com/m,m1,y,m2\r\n';
    const { extraHeader, rows } = parse(text);
    expect(extraHeader).toEqual(['', 'memo', '', 'memo']);
    expect(rows[0]).toEqual(values({ id: 'a-01', url: 'https://example.com/m', note: '', checkedAt: '' }, ['x', 'm1', 'y', 'm2']));
    expect(roundTrip(text)).toBe('id,url,note,checkedAt,,memo,,memo\r\na-01,https://example.com/m,,,x,m1,y,m2\r\n');
  });

  it('決まった列の名前が2回あれば、最初の列を使い、後の列はほかの列として値ごと残す', () => {
    const text = 'id,url,note,url\r\na-01,a,b,c\r\n';
    const t = parse(text);
    expect(t.notes).toEqual(['1 行目（見出し）に url 列が 2 つあります。最初の列を使い、ほかはそのまま残します']);
    expect(t.rows).toEqual([values({ id: 'a-01', url: 'a', note: 'b', checkedAt: '' }, ['c'])]);
    expect(roundTrip(text)).toBe('id,url,note,checkedAt,url\r\na-01,a,b,,c\r\n');
  });

  it('見出しより値が多い行は、最初の値に「#」を付けたコメントの行にする（値はすべて残し、見出しは変えない）', () => {
    const text = 'id,url\r\na-01,u\r\na-02,"複数\n行",余分\r\n,x,y,z\r\n';
    const t = parse(text, ['id', 'url']);
    expect(t.header).toEqual(['id', 'url']);
    expect(t.extraHeader).toEqual([]);
    expect(t.rows).toEqual([values({ id: 'a-01', url: 'u' }), { comment: ['#a-02', '複数\n行', '余分'] }, { comment: ['#', 'x', 'y', 'z'] }]);
    expect(t.notes).toEqual([
      '3 行目は見出しより列が多いため、コメント行にしました（保存すると最初の値の前に「#」が付きます）',
      '5 行目は見出しより列が多いため、コメント行にしました（保存すると最初の値の前に「#」が付きます）',
    ]);
    expect(roundTrip(text, ['id', 'url'])).toBe('id,url\r\na-01,u\r\n#a-02,"複数\n行",余分\r\n#,x,y,z\r\n');
  });

  it('CSV として読めないのは、「"」が閉じないままファイルが終わるときだけ', () => {
    expect(() => parse('id,url\r\na-01,"https://example.com/m\r\n')).toThrow(CsvError);
    expect(() => parse('id,url\r\na-01,"https://example.com/m\r\n')).toThrow('2 行目からの行で');
  });
});

describe('Python の csv.reader と同じ読み方', () => {
  it('行末は CRLF・LF・CR のどれでもよく、空の行は飛ばす', () => {
    expect(parse('id,v\n\n1,x\r\n2,y\r3,z', ['id', 'v']).rows).toEqual([values({ id: '1', v: 'x' }), values({ id: '2', v: 'y' }), values({ id: '3', v: 'z' })]);
  });

  it('BOM を除く', () => {
    expect(parse('﻿id,v\r\n1,2\r\n', ['id', 'v']).header).toEqual(['id', 'v']);
  });

  it('囲みの中の改行は値に入る（CRLF もそのまま）', () => {
    expect(parseRecords('a,"x\r\ny"\r\n')).toEqual([['a', 'x\r\ny']]);
  });

  it('囲みのない値の中の「"」はそのまま、閉じた「"」の後ろの文字は値に足す', () => {
    expect(parseRecords('1,ab"c\r\n1,"ab"c\r\n')).toEqual([['1', 'ab"c'], ['1', 'abc']]);
  });

  it('最後の値が空・閉じていない「"」', () => {
    expect(parseRecords('a,')).toEqual([['a', '']]);
    expect(() => parseRecords('a,"b')).toThrow(CsvError);
  });

  it('値の前後の空白は残す（書き戻す前提）', () => {
    expect(parseRecords(' a , b ')).toEqual([[' a ', ' b ']]);
  });
});

// CLI のテスト（tools/tests/test_edit.py の test_canonical_form・test_bad_headers_are_refused）と同じ入力。
// どちらで保存しても同じバイト列になることを、両側で同じ入力・期待値で確かめる（docs/event-data.md の「CSV の書き方」）。
// 見出しの重複・見出しより長い行は、読まずに止めていた規則から「読んで残す」規則に変えた（CLI 側も同じ規則にそろえる）
describe('CLI のテストと同じ例（CSV の書き方）', () => {
  it.each([
    ['﻿id,url,note,checkedAt\na-01,https://example.com/m,,2030-01-01\n\n', 'id,url,note,checkedAt\r\na-01,https://example.com/m,,2030-01-01\r\n'],
    ['id,url,note,checkedAt\r\n# メモ, 続き\r\na-01,https://example.com/m\r\n', 'id,url,note,checkedAt\r\n# メモ, 続き\r\na-01,https://example.com/m,,\r\n'],
    ['id,url,note,checkedAt\r\n#a-01,https://example.com/m,"a,b",,"""x""",\r\n', 'id,url,note,checkedAt\r\n#a-01,https://example.com/m,"a,b",,"""x""",\r\n'],
    ['id,url,note,checkedAt\r\n"# a\nb",c\r\n', 'id,url,note,checkedAt\r\n"# a\nb",c\r\n'],
    ['id,url,note,checkedAt\r\na-01,https://example.com/m,"""新刊"", 既刊",2030-01-01\r\n', 'id,url,note,checkedAt\r\na-01,https://example.com/m,"""新刊"", 既刊",2030-01-01\r\n'],
    ['id,url,note,checkedAt\r\n,,,\r\n , ,\t,\r\na-01,https://example.com/m,,\r\n', 'id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\n'],
    ['id,url,note,checkedAt\r\n,#x,,\r\n', 'id,url,note,checkedAt\r\n,#x,,\r\n'],
    ['checkedAt,note,url,id,by\r\n2030-01-01,,https://example.com/m,a-01,人\r\n', 'id,url,note,checkedAt,by\r\na-01,https://example.com/m,,2030-01-01,人\r\n'],
  ])('%j', (text, expected) => {
    expect(roundTrip(text)).toBe(expected);
  });

  it.each([
    ['id,url,note,note', 'id,url,note,checkedAt,note\r\na-01,https://example.com/m,a,,b\r\n'],
    ['id,id,url,note,checkedAt,extra', 'id,url,note,checkedAt,id,extra\r\na-01,a,b,,https://example.com/m,\r\n'],
  ])('見出しの重複: %s は最初の列を使い、後の列を残す', (header, expected) => {
    expect(roundTrip(`${header}\r\na-01,https://example.com/m,a,b\r\n`)).toBe(expected);
  });

  it('値が見出しより多い行はコメントの行にする', () => {
    expect(roundTrip('id,url,note,checkedAt\r\na-01,https://example.com/m,a,b,extra\r\n')).toBe(
      'id,url,note,checkedAt\r\n#a-01,https://example.com/m,a,b,extra\r\n',
    );
  });
});
