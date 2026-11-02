import { describe, expect, it } from 'vitest';
import { formatCsv, parseCsv, parseRecords } from './csv';
import { CIRCLE_COLS, MENU_COLS } from './model';

// ファイルの中身をそのまま（改行も変えずに）読む
import circlesCsv from '../../events/example/data/circles.csv?raw';
import menusCsv from '../../events/example/data/menus.csv?raw';

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));

describe('events/example の CSV を読んで書き戻すと同じバイト列になる', () => {
  it.each([
    ['circles.csv', circlesCsv, CIRCLE_COLS],
    ['menus.csv', menusCsv, MENU_COLS],
  ] as const)('%s', (_, original, cols) => {
    expect(original).toContain('\r\n');
    const { header, rows } = parseCsv(original);
    expect(header).toEqual(cols);
    expect(rows.length).toBeGreaterThan(0);
    expect(bytes(formatCsv(cols, rows))).toEqual(bytes(original));
  });
});

describe('Python の csv.DictWriter（project.write_csv）と同じ書き方', () => {
  // 期待値は tools/caimawaru/project.py の write_csv（Python 3.13 の csv）で同じ行を書いた結果
  const rows = [
    { id: 'a-01', url: 'https://example.com/a?x=1,2', note: '新刊 "総集編"', checkedAt: '2030-01-01' },
    { id: 'a-02', url: 'https://example.com/b', note: '1行目\n2行目', checkedAt: '' },
    { id: 'a-03', url: 'https://example.com/c', note: ' 前後の空白 ', checkedAt: '' },
    { id: '#メモ', url: '', note: '', checkedAt: '' },
    { id: 'a-04', url: 'https://example.com/d', note: 'CRLF\r\nを含む', checkedAt: '', extra: '捨てる' },
    { id: 'a-05', url: '', note: '"', checkedAt: ',' },
  ];
  const python =
    'id,url,note,checkedAt\r\na-01,"https://example.com/a?x=1,2","新刊 ""総集編""",2030-01-01\r\n' +
    'a-02,https://example.com/b,"1行目\n2行目",\r\na-03,https://example.com/c, 前後の空白 ,\r\n#メモ,,,\r\n' +
    'a-04,https://example.com/d,"CRLF\r\nを含む",\r\na-05,,"""",","\r\n';

  it('「,」「"」改行を含む値・日本語・余分な列', () => {
    expect(formatCsv(MENU_COLS, rows)).toBe(python);
  });

  it('書いたものを読むと元の値に戻る', () => {
    const { rows: back } = parseCsv(python);
    expect(back).toEqual(rows.map(({ id, url, note, checkedAt }) => ({ id, url, note, checkedAt })));
  });

  it('CR だけの値も「"」で囲む。足りない列は空欄', () => {
    expect(formatCsv(['id', 'v'], [{ id: '1', v: 'a\rb' }, { id: '2' }])).toBe('id,v\r\n1,"a\rb"\r\n2,\r\n');
  });

  it('行がなければ列名の行だけ', () => {
    expect(formatCsv(MENU_COLS, [])).toBe('id,url,note,checkedAt\r\n');
  });
});

describe('Python の csv.reader と同じ読み方', () => {
  it('行末は CRLF・LF・CR のどれでもよく、空の行は飛ばす', () => {
    expect(parseCsv('id,v\n\n1,x\r\n,\r2,y').rows).toEqual([
      { id: '1', v: 'x' },
      { id: '', v: '' },
      { id: '2', v: 'y' },
    ]);
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

  it('値が足りない行は空欄、多い値は捨てる', () => {
    expect(parseCsv('id,v\n1\n1,2,3\n').rows).toEqual([{ id: '1', v: '' }, { id: '1', v: '2' }]);
  });

  it('最後の値が空・閉じていない「"」', () => {
    expect(parseRecords('a,')).toEqual([['a', '']]);
    expect(parseRecords('a,"b')).toEqual([['a', 'b']]);
  });

  it('値の前後の空白は残す（書き戻す前提）', () => {
    expect(parseRecords(' a , b ')).toEqual([[' a ', ' b ']]);
  });
});
