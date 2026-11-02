import { describe, expect, it } from 'vitest';
import { circleId, CIRCLE_COLS, isDataRow, makeId, newRow, type Row } from './model';
import { checkCircles, checkEvent, checkMenus } from './validate';

const circle = (v: Record<string, string>): Row =>
  newRow({ ...Object.fromEntries(CIRCLE_COLS.map((c) => [c, ''])), ...v });
const menu = (v: Record<string, string>): Row => newRow({ id: '', url: '', note: '', checkedAt: '', ...v });
const messages = (issues: { message: string }[]) => issues.map((i) => i.message);

describe('id とデータ行（Python と同じ規則）', () => {
  it('id が空ならスペース番号から作る', () => {
    expect(makeId('A-03,A-04')).toBe('a-03-a-04');
    expect(makeId('壁-01')).toBe('01');
    expect(circleId({ id: ' ', space: ' B-05 ' })).toBe('b-05');
  });
  it('空の値だけの行（コメントの行も values は空）はデータではない。id が空で space が「#」で始まる行はデータ', () => {
    expect(isDataRow({ id: '', space: '', name: ' ' })).toBe(false);
    expect(isDataRow({})).toBe(false);
    expect(isDataRow({ id: '', space: '#A', name: 'x' })).toBe(true);
    expect(isDataRow({ id: 'a', space: '', name: 'x' })).toBe(true);
  });
});

describe('サークルの確認', () => {
  it('問題がなければ何も出さない', () => {
    expect(checkCircles([circle({ id: 'a-01', space: 'A-01', name: 'サンプル', adult: '1', web: 'https://example.com/' })])).toEqual([]);
  });
  it('必須・URL・adult・重複', () => {
    const issues = checkCircles([
      circle({ space: 'A-01', name: '' }),
      circle({ id: 'a-01', name: '同じid', x: 'example.com/x', adult: 'yes' }),
      circle({ name: 'idなし' }),
      newRow({}, '#コメント'), // コメントの行（csv.ts が見分ける）は確かめない
    ]);
    expect(messages(issues)).toEqual([
      'A-01: サークル名（name）が空です',
      '同じid: id「a-01」が重複しています（A-01 と同じ）',
      '同じid: x の URL が不正です: example.com/x',
      '同じid: adult は 0 / 1 / 空欄のいずれかにしてください: yes',
      'idなし: id もスペース番号もありません',
    ]);
    expect(issues.every((i) => i.level === 'error')).toBe(true);
  });
});

describe('お品書きの確認', () => {
  const circles = [circle({ id: 'a-01', name: 'サンプル' })];
  it('サークルがない id・URL の形・日付・X の投稿でないページ・重複', () => {
    const issues = checkMenus(
      [
        menu({ id: 'a-01', url: 'https://example.com/m', checkedAt: '2030-01-01' }),
        menu({ id: 'zz', url: 'https://example.com/m' }),
        menu({ id: 'a-01', url: 'not a url' }),
        menu({ id: 'a-01', url: 'https://x.com/example_user', checkedAt: '1/2' }),
        menu({ id: 'a-01', url: 'https://example.com/m?ref=1' }),
        newRow({}, '#あとで'),
      ],
      circles,
    );
    expect(issues.map((i) => [i.level, i.message])).toEqual([
      ['error', 'お品書き（zz）: circles.csv に id「zz」がありません'],
      ['error', 'お品書き（a-01）: URL が不正です: not a url'],
      ['warning', 'お品書き（a-01）: X の投稿ではないページです（プロフィール等を登録していませんか）: https://x.com/example_user'],
      ['warning', 'お品書き（a-01）: checkedAt は YYYY-MM-DD にしてください: 1/2'],
      ['warning', 'お品書き（a-01）: 同じ URL が重複しています: https://example.com/m?ref=1'],
    ]);
  });
  it('X の投稿 URL は警告しない', () => {
    expect(checkMenus([menu({ id: 'a-01', url: 'https://x.com/example_user/status/123' })], circles)).toEqual([]);
  });
});

describe('event.json の確認', () => {
  it('storeId・title は必須、info は形を見る', () => {
    const issues = checkEvent({
      title: '',
      info: {
        name: 'サンプル',
        date: '2030/1/1',
        links: [{ label: '公式', url: 'https://example.com/' }, { label: '壊れた', url: 'example' }],
        contact: { label: '連絡先', url: '' },
        eventSlots: { サンプル: 1, 併設: 6 },
      },
    });
    expect(issues.map((i) => [i.level, i.message])).toEqual([
      ['error', 'storeId がありません'],
      ['error', 'title がありません'],
      ['warning', 'info.venue が未入力です'],
      ['error', 'info.date は YYYY-MM-DD にしてください: 2030/1/1'],
      ['error', 'info.links の URL が不正です: example'],
      ['error', 'info.contact の URL が不正です: '],
      ['error', 'info.eventSlots の 併設 は 1〜5 にしてください: 6'],
    ]);
  });
});
