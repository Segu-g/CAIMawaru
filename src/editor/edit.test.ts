import { describe, expect, it } from 'vitest';
import { loadDoc, serializeCircles, serializeMenus } from './doc';
import { addCircle, addMenu, changeCircleId, editableFields, removeCircle, sameIdCircles, slotsToObject, updateCircle, updateMenu } from './edit';

const circlesCsv =
  'id,space,event,name,kana,penNames,tags,adult,x,pixiv,booth,web,notes,source\r\n' +
  'a-01,A-01,サンプル即売会,星屑通信,,,,,,,,,,\r\n' +
  'dup,B-01,サンプル即売会,重複その1,,,,,,,,,,\r\n' +
  'dup,B-02,サンプル即売会,重複その2,,,,,,,,,,\r\n';
const menusCsv = 'id,url,note,checkedAt\r\na-01,https://example.com/a,,2030-01-01\r\ndup,https://example.com/d,,2030-01-01\r\n';
const open = () => loadDoc({ event: '{"storeId": "ev", "title": "t"}', circles: circlesCsv, menus: menusCsv }).doc;
const byName = (doc: ReturnType<typeof open>, name: string) => doc.circles.find((c) => c.values.name === name)!;

describe('値がない行は書かない', () => {
  it('「サークルを追加」したまま何も入れていない行は circles.csv に書かない', () => {
    const doc = open();
    const added = addCircle(doc).doc;
    expect(serializeCircles(added)).toBe(circlesCsv);
    // 参加イベントだけ入れた行は書く
    const withEvent = addCircle(doc, { event: 'サンプル即売会' }).doc;
    expect(serializeCircles(withEvent)).toBe(circlesCsv + ',,サンプル即売会,,,,,,,,,,,\r\n');
  });

  it('お品書きの値を全部消した行は menus.csv に書かない', () => {
    let doc = open();
    const key = doc.menus[0].key;
    for (const col of ['id', 'url', 'note', 'checkedAt']) doc = updateMenu(doc, key, col, '');
    // URL を消すと checkedAt が今日になるので、最後に checkedAt も消している
    expect(serializeMenus(doc)).toBe('id,url,note,checkedAt\r\ndup,https://example.com/d,,2030-01-01\r\n');
    const added = addMenu(open(), '', '', '').doc;
    expect(serializeMenus(added)).toContain('\r\n,,,'); // checkedAt が入っているので書く
  });
});

describe('id の変更と重複', () => {
  it('id を変えるとお品書きを付け替え、menus.csv を書き換えるファイルに入れる', () => {
    const doc = open();
    const res = changeCircleId(doc, byName(doc, '星屑通信').key, 'id', 'a-01x');
    expect(res.moved).toBe(1);
    expect(res.dirty).toEqual(['circles', 'menus']);
    expect(serializeMenus(res.doc)).toContain('a-01x,https://example.com/a');
  });

  it('お品書きがなければ circles.csv だけ', () => {
    const doc = addCircle(open(), { id: 'new', name: '新規' }).doc;
    const res = changeCircleId(doc, byName(doc, '新規').key, 'id', 'new2');
    expect(res).toMatchObject({ moved: 0, dirty: ['circles'] });
  });

  it('重複している id は付け替えない（お品書きはもう一方のサークルに残る）', () => {
    const doc = open();
    const one = byName(doc, '重複その1');
    expect(sameIdCircles(doc, one).map((c) => c.values.name)).toEqual(['重複その2']);
    const res = changeCircleId(doc, one.key, 'id', 'dup-1');
    expect(res).toMatchObject({ moved: 0, dirty: ['circles'] });
    expect(serializeMenus(res.doc)).toContain('dup,https://example.com/d');
    expect(sameIdCircles(res.doc, byName(res.doc, '重複その2'))).toEqual([]);
  });

  it('重複している id のサークルを消しても、お品書きは消さない', () => {
    const doc = open();
    const res = removeCircle(doc, byName(doc, '重複その1').key);
    expect(res.removedMenus).toBe(0);
    expect(res.doc.menus).toEqual(doc.menus);
  });

  it('スペース番号から作る id が変わるときも同じ', () => {
    const base = open();
    const fresh = updateCircle(base, byName(base, '星屑通信').key, 'id', ''); // id は空（スペース番号 A-01 から a-01）
    const res = changeCircleId(fresh, byName(fresh, '星屑通信').key, 'space', 'A-09');
    expect(res.moved).toBe(1);
    expect(serializeMenus(res.doc)).toContain('a-09,https://example.com/a');
  });
});

describe('eventSlots の行', () => {
  it('空・重複・数字だけの名前は書かない', () => {
    expect(slotsToObject([{ name: '併設', slot: 1 }, { name: '併設オンリー', slot: 2 }])).toEqual({ ok: true, value: { 併設: 1, 併設オンリー: 2 } });
    expect(slotsToObject([{ name: 'サンプル即売会', slot: 1 }, { name: '', slot: 2 }])).toMatchObject({ ok: false, message: expect.stringContaining('空') });
    expect(slotsToObject([{ name: '併設', slot: 1 }, { name: ' 併設 ', slot: 2 }])).toMatchObject({ ok: false, message: expect.stringContaining('重複') });
    expect(slotsToObject([{ name: '2030', slot: 1 }])).toMatchObject({ ok: false, message: expect.stringContaining('数字だけ') });
  });

  it('入力中（「併設」まで打ったところ）でも、ほかの行を上書きしない', () => {
    const rows = [{ name: '併設オンリー', slot: 2 }, { name: '併設', slot: 3 }];
    expect(slotsToObject(rows)).toEqual({ ok: true, value: { 併設オンリー: 2, 併設: 3 } });
    expect(slotsToObject([...rows, { name: '', slot: 4 }]).ok).toBe(false); // 「＋ イベントを追加」直後
  });
});

describe('画面で編集できる形', () => {
  it('想定と違う形の値の欄は編集しない', () => {
    const ok = editableFields({
      storeId: 'ev',
      title: 1,
      info: { name: 'n', links: [{ label: 'a', url: 'https://example.com/' }, 'https://example.com/b'], hashtags: ['a', 2], eventSlots: [], contact: 'x' },
    });
    expect(ok).toMatchObject({ storeId: true, title: false, name: true, links: false, hashtags: false, eventSlots: false, contact: false, date: true });
    expect(Object.values(editableFields({ info: 'x' })).filter((v) => v)).toHaveLength(2); // storeId・title だけ
    expect(Object.values(editableFields({})).every((v) => v)).toBe(true);
  });
});
