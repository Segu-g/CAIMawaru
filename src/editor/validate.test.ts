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
      newRow({}, ['#コメント']), // コメントの行（csv.ts が見分ける）は確かめない
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
  it('x 列は照合できる X のアカウントの URL か（build.py・menu.py と同じ規則）', () => {
    const issues = checkCircles([
      circle({ id: 'a-01', name: 'ok', x: 'https://mobile.twitter.com/Example_User?lang=ja' }),
      circle({ id: 'a-02', name: 'ホーム', x: 'https://x.com/home' }),
      circle({ id: 'a-03', name: 'X以外', x: 'https://example.com/example_user' }),
    ]);
    expect(issues.map((i) => [i.level, i.message])).toEqual([
      ['warning', 'ホーム: x が X のアカウントの URL ではありません（https://x.com/<ID> の形にしてください）: https://x.com/home'],
      ['warning', 'X以外: x が X のアカウントの URL ではありません（https://x.com/<ID> の形にしてください）: https://example.com/example_user'],
    ]);
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
        menu({ id: 'a-01', url: 'https://example.com/m?ref=1' }), // X 以外はクエリも URL のうち（重複ではない）
        menu({ id: 'a-01', url: 'https://x.com/example_user/status/1' }),
        menu({ id: 'a-01', url: 'http://www.twitter.com/example_user/status/1?s=20' }),
        newRow({}, ['#あとで', '']),
      ],
      circles,
    );
    expect(issues.map((i) => [i.level, i.message])).toEqual([
      ['error', 'お品書き（zz）: circles.csv に id「zz」がありません'],
      ['error', 'お品書き（a-01）: URL が不正です: not a url'],
      ['warning', 'お品書き（a-01）: X の投稿ではないページです（プロフィール等を登録していませんか）: https://x.com/example_user'],
      ['warning', 'お品書き（a-01）: checkedAt は YYYY-MM-DD にしてください: 1/2'],
      ['warning', 'お品書き（a-01）: 同じ URL が重複しています: http://www.twitter.com/example_user/status/1?s=20'],
    ]);
  });
  it('X の投稿 URL は警告しない', () => {
    expect(checkMenus([menu({ id: 'a-01', url: 'https://x.com/example_user/status/123' })], circles)).toEqual([]);
    // caimawaru menu が受け付ける形（http・www.・mobile.・twitter.com）も投稿として扱う
    expect(checkMenus([menu({ id: 'a-01', url: 'http://mobile.twitter.com/example_user/status/123?s=20' })], circles)).toEqual([]);
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
