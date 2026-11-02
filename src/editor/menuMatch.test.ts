import { describe, expect, it } from 'vitest';
import { loadDoc, serializeCircles, serializeMenus } from './doc';
import { addCircle, addMenu, applyDefaults, moveKeepingId, replaceMenu, spaceUsers, swapSpaces } from './edit';
import { checkMenuUrl, circleHay, findCircles, normalizeUrl, profileHandle, searchCircles, xHandleOf, xSearchUrl } from './menuMatch';
import { loadMarks, parseMarks, saveMarks, setMark } from './workMarks';

// 架空のサークルとアカウント
const circlesCsv =
  'id,space,event,name,kana,penNames,tags,adult,x,pixiv,booth,web,notes,source\r\n' +
  'a-01,A-01,サンプル即売会,星屑通信,ほしくず,,,,https://x.com/hoshikuzu_ex,,,,,\r\n' +
  'a-02,A-02,サンプル即売会,まどろみ書房,,,,,https://twitter.com/Madoromi_Ex/,,,,,\r\n' +
  ',"A-03,A-04",サンプル即売会,青い鳥工房,,,,,,,,,,\r\n' +
  ',A-10,サンプル即売会,星の砂,,,,,,,,,,\r\n';
const menusCsv = 'id,url,note,checkedAt\r\na-01,https://x.com/hoshikuzu_ex/status/100,新刊,2030-01-01\r\n';
const open = () => loadDoc({ event: '{"storeId": "ev", "title": "t"}', circles: circlesCsv, menus: menusCsv }).doc;
const byName = (doc: ReturnType<typeof open>, name: string) => doc.circles.find((c) => c.values.name === name)!;

describe('URL の正規化（menu.py の normalize_url と同じ）', () => {
  it('X の投稿は https://x.com/<ID>/status/<番号> にそろえ、追跡用パラメータを落とす', () => {
    expect(normalizeUrl(' https://twitter.com/Madoromi_Ex/status/123?s=20&t=abc ')).toEqual({ url: 'https://x.com/Madoromi_Ex/status/123', handle: 'Madoromi_Ex' });
    expect(normalizeUrl('https://mobile.x.com/a_b/status/9/photo/1').url).toBe('https://x.com/a_b/status/9');
    expect(normalizeUrl('https://example.booth.pm/items/1?x=1')).toEqual({ url: 'https://example.booth.pm/items/1?x=1', handle: null });
  });

  it('プロフィールの URL からアカウントを取り出す（検索などのページは除く）', () => {
    expect(profileHandle('https://x.com/Hoshikuzu_Ex')).toBe('hoshikuzu_ex');
    expect(profileHandle('https://twitter.com/hoshikuzu_ex/?lang=ja')).toBe('hoshikuzu_ex');
    expect(profileHandle('https://x.com/search?q=a')).toBeNull();
    expect(profileHandle('https://x.com/home')).toBeNull();
    expect(profileHandle('https://x.com/a/status/1')).toBeNull();
    expect(xHandleOf(byName(open(), 'まどろみ書房').values)).toBe('madoromi_ex');
    expect(xSearchUrl(' 星屑 通信 ')).toBe('https://x.com/search?q=%E6%98%9F%E5%B1%91%20%E9%80%9A%E4%BF%A1&f=user');
  });
});

describe('サークルの指定（menu.py の find_circles と同じ）', () => {
  const doc = open();
  const names = (q: string) => findCircles(doc.circles, q).map((c) => c.values.name);
  it('id・スペース（複数スペースのどれか）・@X の完全一致を優先する', () => {
    expect(names('A-01')).toEqual(['星屑通信']);
    expect(names('a-04')).toEqual(['青い鳥工房']);
    expect(names('A-03,A-04')).toEqual(['青い鳥工房']);
    expect(names('@MADOROMI_EX')).toEqual(['まどろみ書房']);
  });
  it('なければ名前・読みの部分一致。空や「@」だけは何にも当たらない', () => {
    expect(names('星')).toEqual(['星屑通信', '星の砂']);
    expect(names('ほしくず')).toEqual(['星屑通信']);
    expect(names('@')).toEqual([]);
    expect(names('  ')).toEqual([]);
  });
  it('一覧の検索は部分一致で、完全一致を先頭に並べる', () => {
    const shown = searchCircles(doc.circles, 'a-1', circleHay).map((c) => c.values.name);
    expect(shown).toEqual(['星の砂']);
    // 「A-01」は A-01 だけでなく A-010 のようなものにも部分一致するが、完全一致が先頭
    const d2 = loadDoc({ event: '{}', circles: circlesCsv.replace(',A-10,', ',A-010,'), menus: '' }).doc;
    expect(searchCircles(d2.circles, 'A-01', circleHay).map((c) => c.values.space)).toEqual(['A-01', 'A-010']);
    expect(searchCircles(d2.circles, '@madoromi_ex', circleHay).map((c) => c.values.name)).toEqual(['まどろみ書房']);
  });
});

describe('登録する URL の確認', () => {
  it('このサークルの X の投稿なら警告なし', () => {
    const doc = open();
    const r = checkMenuUrl(doc, byName(doc, 'まどろみ書房').key, 'https://twitter.com/madoromi_ex/status/5?s=20');
    expect(r).toEqual({ url: 'https://x.com/madoromi_ex/status/5', handle: 'madoromi_ex', warnings: [] });
  });
  it('投稿者がサークルの X と違えば、どのサークルの X かも知らせる', () => {
    const doc = open();
    const r = checkMenuUrl(doc, byName(doc, 'まどろみ書房').key, 'https://x.com/hoshikuzu_ex/status/7');
    expect(r.error).toBeUndefined();
    expect(r.warnings).toEqual(['@hoshikuzu_ex の投稿です（このサークルの X は @madoromi_ex）。@hoshikuzu_ex は A-01 星屑通信 の X です']);
  });
  it('同じサークルに同じ投稿（正規化して同じ）があれば登録しない。ほかのサークルにあれば警告', () => {
    const doc = open();
    const same = checkMenuUrl(doc, byName(doc, '星屑通信').key, 'https://twitter.com/hoshikuzu_ex/status/100?s=20');
    expect(same.error).toBe('このサークルに登録済みです');
    expect(same.sameMenu?.values.url).toBe('https://x.com/hoshikuzu_ex/status/100');
    // 差し替えるお品書き自身とは重複にしない
    expect(checkMenuUrl(doc, byName(doc, '星屑通信').key, 'https://x.com/hoshikuzu_ex/status/100', doc.menus[0].key).error).toBeUndefined();
    const other = checkMenuUrl(doc, byName(doc, '星の砂').key, 'https://x.com/hoshikuzu_ex/status/100');
    expect(other.warnings).toEqual(['同じ URL がほかのサークル（A-01 星屑通信）に登録されています']);
  });
  it('URL でないもの・X のプロフィール・投稿でない X のページ', () => {
    const doc = open();
    const key = byName(doc, '星の砂').key;
    expect(checkMenuUrl(doc, key, 'お品書き').error).toBe('http(s) の URL ではありません');
    expect(checkMenuUrl(doc, key, '').error).toBe('URL を貼り付けてください');
    const prof = checkMenuUrl(doc, key, 'https://x.com/hoshinosuna_ex');
    expect(prof.profile).toBe('hoshinosuna_ex');
    expect(prof.error).toContain('プロフィール');
    expect(checkMenuUrl(doc, key, 'https://x.com/i/lists/1').warnings).toEqual(['X の投稿ではないページです']);
    // X のないサークルには投稿者の警告を出さない
    expect(checkMenuUrl(doc, key, 'https://x.com/someone_ex/status/1').warnings).toEqual([]);
  });
});

describe('お品書きの差し替え', () => {
  it('URL と確認した日を変え、説明は渡したときだけ変える', () => {
    const doc = open();
    const key = doc.menus[0].key;
    const now = new Date(2030, 1, 3);
    expect(serializeMenus(replaceMenu(doc, key, 'https://x.com/hoshikuzu_ex/status/200', undefined, now)))
      .toBe('id,url,note,checkedAt\r\na-01,https://x.com/hoshikuzu_ex/status/200,新刊,2030-02-03\r\n');
    expect(serializeMenus(replaceMenu(doc, key, 'https://x.com/hoshikuzu_ex/status/200', '既刊', now)))
      .toBe('id,url,note,checkedAt\r\na-01,https://x.com/hoshikuzu_ex/status/200,既刊,2030-02-03\r\n');
    expect(serializeMenus(addMenu(doc, 'a-02', 'https://x.com/madoromi_ex/status/5', '', now).doc))
      .toContain('a-02,https://x.com/madoromi_ex/status/5,,2030-02-03\r\n');
  });
});

describe('配置換え', () => {
  it('同じスペースを使うほかのサークル（複数スペースのどれかが重なるものも）', () => {
    const doc = open();
    const key = byName(doc, '星の砂').key;
    expect(spaceUsers(doc, key, 'a-04').map((c) => c.values.name)).toEqual(['青い鳥工房']);
    expect(spaceUsers(doc, key, 'A-10')).toEqual([]);
    expect(spaceUsers(doc, key, '')).toEqual([]);
  });
  it('id を変えずに移動する（id 列が空なら今の id を書く）', () => {
    const doc = open();
    const moved = moveKeepingId(doc, byName(doc, '星の砂').key, 'A-11');
    expect(serializeCircles(moved)).toContain('\r\na-10,A-11,サンプル即売会,星の砂,');
    const explicit = moveKeepingId(doc, byName(doc, '星屑通信').key, 'A-12');
    expect(serializeCircles(explicit)).toContain('\r\na-01,A-12,サンプル即売会,星屑通信,');
  });
  it('入れ替えは両方のスペースを交換し、id は変えない', () => {
    const doc = open();
    const swapped = swapSpaces(doc, byName(doc, '星の砂').key, byName(doc, '青い鳥工房').key);
    const text = serializeCircles(swapped);
    expect(text).toContain('\r\na-10,"A-03,A-04",サンプル即売会,星の砂,');
    expect(text).toContain('\r\na-03-a-04,A-10,サンプル即売会,青い鳥工房,');
    expect(serializeMenus(swapped)).toBe(menusCsv);
  });
});

describe('新しいサークルの既定値', () => {
  it('何も入れていない行にだけ、空の列に入れる', () => {
    const doc = open();
    const { doc: added, key } = addCircle(doc);
    const filled = applyDefaults(added, key, { event: '併設オンリー', source: '架空の公式サークル一覧', name: '' });
    expect(filled.circles.at(-1)!.values).toMatchObject({ event: '併設オンリー', source: '架空の公式サークル一覧', name: '' });
    // すでに値のある行は変えない
    expect(applyDefaults(doc, byName(doc, '星の砂').key, { source: 'x' })).toBe(doc);
  });
});

describe('作業用の印（localStorage）', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  it('読み書きし、印もメモもなくなった id は消す', () => {
    const s = mem();
    let marks = setMark({}, 'a-01', { later: true });
    marks = setMark(marks, 'a-02', { memo: '告知待ち' });
    expect(saveMarks(s, 'ev', marks)).toBe(true);
    expect(loadMarks(s, 'ev')).toEqual({ 'a-01': { later: true }, 'a-02': { memo: '告知待ち' } });
    expect(loadMarks(s, 'other')).toEqual({});
    marks = setMark(setMark(marks, 'a-01', { later: false }), 'a-02', { memo: '  ' });
    expect(marks).toEqual({});
    saveMarks(s, 'ev', marks);
    expect(s.m.size).toBe(0);
  });
  it('読めない値・形の違う値は無視する', () => {
    expect(parseMarks('{')).toEqual({});
    expect(parseMarks('[1]')).toEqual({});
    expect(parseMarks('{"a":{"later":"yes","memo":3},"b":{"later":true},"c":null}')).toEqual({ b: { later: true } });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    expect(loadMarks(broken, 'ev')).toEqual({});
    expect(saveMarks(broken, 'ev', { a: { later: true } })).toBe(false);
  });
});
