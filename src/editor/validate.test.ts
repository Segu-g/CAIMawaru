import { describe, expect, it } from 'vitest';
import { circleId, CIRCLE_COLS, isDataRow, makeId, newRow, type Row } from './model';
import { checkCircles, checkEvent, checkMenus } from './validate';
import makeIdJson from '../../tools/tests/fixtures/make_id.json?raw';

const circle = (v: Record<string, string>): Row =>
  newRow({ ...Object.fromEntries(CIRCLE_COLS.map((c) => [c, ''])), ...v });
const menu = (v: Record<string, string>): Row => newRow({ id: '', url: '', note: '', checkedAt: '', ...v });
const messages = (issues: { message: string }[]) => issues.map((i) => i.message);

describe('id とデータ行（Python と同じ規則）', () => {
  it('id が空ならスペース番号から作る。id 列の値は変えない', () => {
    expect(circleId({ id: ' ', space: ' B-05 ' })).toBe('b-05');
    expect(circleId({ id: ' A-01 ', space: 'B-05' })).toBe('A-01');
  });
  // tools/tests/test_import.py も同じ例を確かめる（CLI とエディタで同じ id になるように）
  it.each((JSON.parse(makeIdJson) as { makeId: [string, string][] }).makeId)('makeId(%j) → %j（tools/tests/fixtures/make_id.json）', (space, id) => {
    expect(makeId(space)).toBe(id);
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
      '同じid（id 列）: id「a-01」が A-01（スペース A-01 から作った id）と重複しています。★・タグ・メモとお品書きが2つのサークルで混ざるので、どちらかの id 列に別の id を書いてください',
      '同じid: x の URL が不正です: example.com/x',
      '同じid: adult は 0 / 1 / 空欄のいずれかにしてください: yes',
      'idなし: id もスペース番号もありません',
    ]);
    expect(issues.every((i) => i.level === 'error')).toBe(true);
  });
  it('スペース番号から作った id の重複・作れない id（build.py と同じ）', () => {
    const issues = checkCircles([
      circle({ space: 'A-01', name: '甲' }),
      circle({ space: 'Ａ－０１', name: '乙' }),
      circle({ space: '★', name: '丙' }),
    ]);
    expect(issues.map((i) => [i.level, i.message])).toEqual([
      ['error', 'Ａ－０１ 乙（スペース Ａ－０１ から作った id）: id「a-01」が A-01 甲（スペース A-01 から作った id）と重複しています。★・タグ・メモとお品書きが2つのサークルで混ざるので、どちらかの id 列に別の id を書いてください'],
      ['error', '★ 丙: スペース番号「★」から id を作れません（文字か数字が要ります）。id 列に id を書いてください'],
    ]);
  });
  it('id 列の空白・「,」・大文字と、大文字・小文字だけ違う id は警告だけ', () => {
    const issues = checkCircles([
      circle({ id: 'b-01', space: 'B-01', name: '甲' }),
      circle({ id: 'B-01', space: 'B-02', name: '乙' }),
      circle({ id: 'x 1,y', space: 'B-03', name: '丙' }),
      circle({ id: 'エ-04', space: 'エ-04', name: '丁' }),
    ]);
    expect(issues.map((i) => [i.level, i.message])).toEqual([
      ['warning', 'B-02 乙: id「B-01」に大文字が入っています（そのままでも使えます。新しく付ける id は、空白・「,」を入れず小文字にしてください。公開後は変えません）'],
      ['warning', 'B-02 乙: id「B-01」は B-01 甲 の id「b-01」と大文字・小文字だけが違います（別のサークルとして扱います）'],
      ['warning', 'B-03 丙: id「x 1,y」に空白・「,」が入っています（そのままでも使えます。新しく付ける id は、空白・「,」を入れず小文字にしてください。公開後は変えません）'],
    ]);
  });
  it.each(['\x1c', '\x85', '\ufeff', '\u3000', '\t'])('id の空白（%j）は build.py の check_id_text と同じ集合', (ch) => {
    const messages = checkCircles([circle({ id: `a${ch}1`, space: 'A-01', name: '甲' })]).map((i) => i.message);
    expect(messages.some((m) => m.includes('空白'))).toBe(true);
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
