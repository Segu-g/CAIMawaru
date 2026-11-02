import { describe, expect, it } from 'vitest';
import { formatJson, loadDoc, serializeCircles, serializeEvent, serializeMenus } from './doc';
import { checkMenus } from './validate';
import { addMenu, removeCircle, renameMenus, setInfo, setTop, updateCircle, updateMenu } from './edit';
import { FakeDir } from './fakeFolder';
import { changedSince, findEventDirs, readAll, saveFiles, type Snapshots } from './folder';
import { circleId } from './model';

import eventJson from '../../events/example/event.json?raw';
import circlesCsv from '../../events/example/data/circles.csv?raw';
import menusCsv from '../../events/example/data/menus.csv?raw';
import layoutJson from '../../events/example/layout.json?raw';

// events/example のファイルの中身（そのまま）
const files: Record<string, string> = {
  'event.json': eventJson,
  'data/circles.csv': circlesCsv,
  'data/menus.csv': menusCsv,
  'layout.json': layoutJson,
};
const read = (p: string) => files[p];

/** events/example と同じ中身のメモリ上のフォルダ */
function exampleFolder() {
  return new FakeDir('example')
    .put('event.json', read('event.json'))
    .put('data/circles.csv', read('data/circles.csv'))
    .put('data/menus.csv', read('data/menus.csv'))
    .put('layout.json', read('layout.json'));
}

async function open(dir: FakeDir) {
  const snapshots = await readAll(dir);
  const { doc, notes } = loadDoc({
    event: snapshots['event.json'].text,
    circles: snapshots['data/circles.csv'].exists ? snapshots['data/circles.csv'].text : null,
    menus: snapshots['data/menus.csv'].exists ? snapshots['data/menus.csv'].text : null,
  });
  return { snapshots, doc, notes };
}

describe('読み込みと書き戻し', () => {
  it('編集しなければ、3つのファイルとも同じ内容に書ける（書式の注意も出ない）', async () => {
    const { doc, notes } = await open(exampleFolder());
    expect(notes).toEqual([]);
    expect(formatJson(doc.event)).toBe(read('event.json'));
    expect(serializeCircles(doc)).toBe(read('data/circles.csv'));
    expect(serializeMenus(doc)).toBe(read('data/menus.csv'));
  });

  it('編集して保存すると、編集したファイルだけを書き、layout.json は触らない', async () => {
    const dir = exampleFolder();
    const { snapshots, doc } = await open(dir);
    const circle = doc.circles.find((c) => c.values.id === 'a-02')!;
    let next = updateCircle(doc, circle.key, 'notes', '補足, "引用" と\n改行');
    next = addMenu(next, 'a-02', 'https://example.com/circle2/menu', '既刊', new Date(2030, 0, 2)).doc;
    const res = await saveFiles(dir, snapshots, {
      'data/circles.csv': serializeCircles(next),
      'data/menus.csv': serializeMenus(next),
    });
    expect(res.kind).toBe('saved');
    if (res.kind !== 'saved') return;
    expect(res.written).toEqual(['data/circles.csv', 'data/menus.csv']);
    expect(dir.read('event.json')).toBe(read('event.json'));
    expect(dir.read('layout.json')).toBe(read('layout.json'));
    expect(dir.read('data/menus.csv')).toBe(read('data/menus.csv') + 'a-02,https://example.com/circle2/menu,既刊,2030-01-02\r\n');
    expect(dir.read('data/circles.csv')).toContain('a-02,A-02,サンプル即売会,まどろみ書房,,作家2,,0,,,,https://example.com/circle2,"補足, ""引用"" と\n改行",');
    // 読み直すと同じ値になる
    const again = await open(dir);
    expect(again.doc.circles.find((c) => c.values.id === 'a-02')!.values.notes).toBe('補足, "引用" と\n改行');
    // 保存後の状態が新しい基準になる（続けて保存できる）
    expect(changedSince(res.snapshots, again.snapshots)).toEqual([]);
  });

  it('event.json は知らないキーと順番を残し、字下げ2・末尾の改行で書く', async () => {
    const dir = new FakeDir('ev').put('event.json', '{\n  "storeId": "ev",\n  "title": "t",\n  "custom": {"keep": [1, 2]},\n  "info": {"name": "n", "halls": [{"label": "第1", "url": "./"}]}\n}\n');
    const { doc } = await open(dir);
    let event = setTop(doc.event, 'title', '新しいタイトル');
    event = setInfo(event, 'venue', '');  // なかったキーを空欄にしても足さない
    event = setInfo(event, 'name', '');   // あったキーは空の値で残す
    event = setInfo(event, 'hashtags', ['タグ']);
    expect(formatJson(event)).toBe(
      '{\n  "storeId": "ev",\n  "title": "新しいタイトル",\n  "custom": {\n    "keep": [\n      1,\n      2\n    ]\n  },\n' +
        '  "info": {\n    "name": "",\n    "halls": [\n      {\n        "label": "第1",\n        "url": "./"\n      }\n    ],\n    "hashtags": [\n      "タグ"\n    ]\n  }\n}\n',
    );
  });

  it('JSON の書き方は Python の json.dumps(ensure_ascii=False, indent=2) と同じ', () => {
    // 期待値は Python 3.13 で同じ値を書いた結果
    const value = { a: '改行\n\t"\\ \u0001   /', b: [], c: {}, d: [1, { e: null, f: true }], g: -0.5 };
    expect(formatJson(value)).toBe(
      '{\n  "a": "改行\\n\\t\\"\\\\ \\u0001   /",\n  "b": [],\n  "c": {},\n  "d": [\n    1,\n    {\n      "e": null,\n      "f": true\n    }\n  ],\n  "g": -0.5\n}\n',
    );
  });

  it('menus.csv がなければ空として開き、保存するときに作る', async () => {
    const dir = new FakeDir('ev').put('event.json', '{"storeId": "ev", "title": "t"}').put('data/circles.csv', 'id,name\r\nx-1,サンプル\r\n');
    const { snapshots, doc, notes } = await open(dir);
    expect(doc.menus).toEqual([]);
    expect(doc.circles[0].values).toMatchObject({ id: 'x-1', name: 'サンプル', space: '' });
    expect(notes.map((n) => n.file)).toEqual(['data/circles.csv', 'event.json']); // 列の順・字下げがそろう
    const next = addMenu(doc, 'x-1', 'https://example.com/m', '', new Date(2030, 4, 5)).doc;
    const res = await saveFiles(dir, snapshots, { 'data/menus.csv': serializeMenus(next) });
    expect(res.kind).toBe('saved');
    expect(dir.read('data/menus.csv')).toBe('id,url,note,checkedAt\r\nx-1,https://example.com/m,,2030-05-05\r\n');
  });

  it('コメントの行は一覧に出さず、その位置に1つの値として書き戻す。空の値だけの行は捨てる', async () => {
    const text = 'id,url,note,checkedAt\r\n# 確認中,,,\r\na-01,https://example.com/m,,\r\n,,,\r\n';
    const { doc } = await open(exampleFolder().put('data/menus.csv', text));
    expect(doc.menus[0]).toMatchObject({ comment: ['# 確認中', '', '', ''], values: {} });
    expect(checkMenus(doc.menus, doc.circles)).toEqual([]);
    const next = addMenu(doc, 'a-02', 'https://example.com/n', '', new Date(2030, 0, 1)).doc;
    expect(serializeMenus(next)).toBe(
      'id,url,note,checkedAt\r\n# 確認中,,,\r\na-01,https://example.com/m,,\r\na-02,https://example.com/n,,2030-01-01\r\n',
    );
  });

  it('決まった列にない列は、決まった列のあとに値ごと残す', async () => {
    const { doc } = await open(exampleFolder().put('data/menus.csv', 'memo,url,id\r\nメモ,https://example.com/m,a-01\r\n'));
    expect(doc.menuCols).toEqual(['id', 'url', 'note', 'checkedAt', 'memo']);
    const next = addMenu(doc, 'a-02', 'https://example.com/n', '新刊', new Date(2030, 0, 1)).doc;
    expect(serializeMenus(next)).toBe(
      'id,url,note,checkedAt,memo\r\na-01,https://example.com/m,,,メモ\r\na-02,https://example.com/n,新刊,2030-01-01,\r\n',
    );
  });

  it('LF・BOM・空の行のファイルも開け、保存すると CLI の書式になる', async () => {
    const { doc, notes } = await open(exampleFolder().put('data/menus.csv', '﻿id,url,note,checkedAt\n\na-01,https://example.com/m,新刊,\n\n'));
    expect(notes.map((n) => n.file)).toEqual(['data/menus.csv']);
    expect(serializeMenus(doc)).toBe('id,url,note,checkedAt\r\na-01,https://example.com/m,新刊,\r\n');
  });

  it('event.json が CRLF なら CRLF のまま書く', async () => {
    const text = '{\r\n  "storeId": "ev",\r\n  "title": "改行\\nを含む"\r\n}\r\n';
    const { doc, notes } = await open(exampleFolder().put('event.json', text));
    expect(notes).toEqual([]);
    expect(serializeEvent(doc)).toBe(text);
    expect(serializeEvent({ ...doc, event: setTop(doc.event, 'title', 't') })).toBe('{\r\n  "storeId": "ev",\r\n  "title": "t"\r\n}\r\n');
  });

  it('内容が失われる CSV・JSON として読めない event.json は開かない', async () => {
    const opens = (path: string, text: string) => open(exampleFolder().put(path, text));
    await expect(opens('data/circles.csv', 'a-01,A-01\r\n')).rejects.toThrow('列名');
    await expect(opens('data/menus.csv', 'id,url,,checkedAt\r\n')).rejects.toThrow('3 番目の列名が空');
    await expect(opens('data/menus.csv', 'id,url,url\r\n')).rejects.toThrow('「url」が重複');
    await expect(opens('data/menus.csv', 'id,url\r\na-01,"https://example.com/m\r\n続き",余分\r\n')).rejects.toThrow('2 行目の値が列名より多く');
    await expect(opens('event.json', '{ "storeId": ')).rejects.toThrow('JSON');
  });
});

describe('ほかで変わったファイルは上書きしない', () => {
  it('読み込んだ後に CLI などがファイルを変えたら、何も書かずに変わったファイルを返す', async () => {
    const dir = exampleFolder();
    const { snapshots, doc } = await open(dir);
    const external = read('data/menus.csv') + 'a-02,https://example.com/other,,2030-01-03\r\n';
    dir.put('data/menus.csv', external);
    const next = updateCircle(doc, doc.circles[0].key, 'name', '変更');
    const res = await saveFiles(dir, snapshots, { 'data/circles.csv': serializeCircles(next) });
    expect(res).toEqual({ kind: 'conflict', changed: ['data/menus.csv'] });
    expect(dir.read('data/circles.csv')).toBe(read('data/circles.csv'));
    expect(dir.read('data/menus.csv')).toBe(external);
  });

  it('保存の直後にほかが書いた内容は「変わった」として残る（保存後の状態は書いた中身から作る）', async () => {
    const dir = exampleFolder();
    const { snapshots, doc } = await open(dir);
    const data = (await dir.getDirectoryHandle('data')) as FakeDir;
    const external = 'id,url,note,checkedAt\r\nc-01,https://example.com/cli,,2030-01-05\r\n';
    // close の直後（読み直す前）に CLI が menus.csv を書く
    data.afterClose = (name) => {
      if (name === 'menus.csv') data.put('menus.csv', external);
    };
    const next = addMenu(doc, 'a-02', 'https://example.com/n', '', new Date(2030, 0, 1)).doc;
    const res = await saveFiles(dir, snapshots, { 'data/menus.csv': serializeMenus(next) });
    expect(res.kind).toBe('saved');
    if (res.kind !== 'saved') return;
    expect(res.snapshots['data/menus.csv'].text).toBe(serializeMenus(next));
    data.afterClose = undefined;
    // 次の保存では CLI の変更を見つけて、上書きしない
    const again = await saveFiles(dir, res.snapshots, { 'data/menus.csv': serializeMenus(next) });
    expect(again).toEqual({ kind: 'conflict', changed: ['data/menus.csv'] });
    expect(dir.read('data/menus.csv')).toBe(external);
  });

  it('書き込み口を用意できないファイルがあれば、何も書かない', async () => {
    const dir = exampleFolder();
    const { snapshots, doc } = await open(dir);
    ((await dir.getDirectoryHandle('data')) as FakeDir).failOn.set('menus.csv', 'createWritable');
    const next = setTop(doc.event, 'title', '変更');
    const res = await saveFiles(dir, snapshots, {
      'event.json': formatJson(next),
      'data/menus.csv': serializeMenus(addMenu(doc, 'a-02', 'https://example.com/n').doc),
    });
    expect(res).toMatchObject({ kind: 'failed', failed: 'data/menus.csv', written: [] });
    expect(dir.read('event.json')).toBe(read('event.json'));
    expect(dir.read('data/menus.csv')).toBe(read('data/menus.csv'));
    if (res.kind === 'failed') expect(changedSince(res.snapshots, await readAll(dir))).toEqual([]);
  });

  it('2つ目のファイルの書き込みで失敗したら、書けたファイルだけを反映し、ずれた「変更あり」を残さない', async () => {
    const dir = exampleFolder();
    const { snapshots, doc } = await open(dir);
    ((await dir.getDirectoryHandle('data')) as FakeDir).failOn.set('menus.csv', 'write');
    const next = addMenu(updateCircle(doc, doc.circles[0].key, 'notes', '補足'), 'a-02', 'https://example.com/n').doc;
    const res = await saveFiles(dir, snapshots, { 'data/circles.csv': serializeCircles(next), 'data/menus.csv': serializeMenus(next) });
    expect(res).toMatchObject({ kind: 'failed', failed: 'data/menus.csv', written: ['data/circles.csv'] });
    if (res.kind !== 'failed') return;
    expect(dir.read('data/circles.csv')).toBe(serializeCircles(next));
    expect(dir.read('data/menus.csv')).toBe(read('data/menus.csv'));
    // 返された状態はフォルダと一致する（次の保存がいつまでも「ほかで変更」にならない）
    expect(changedSince(res.snapshots, await readAll(dir))).toEqual([]);
    ((await dir.getDirectoryHandle('data')) as FakeDir).failOn.clear();
    const retry = await saveFiles(dir, res.snapshots, { 'data/menus.csv': serializeMenus(next) });
    expect(retry).toMatchObject({ kind: 'saved', written: ['data/menus.csv'] });
    expect(dir.read('data/menus.csv')).toBe(serializeMenus(next));
  });

  it('ファイルが消えた・新しくできたのも「変わった」', async () => {
    const dir = new FakeDir('ev').put('event.json', '{}');
    const { snapshots } = await open(dir);
    dir.put('data/menus.csv', 'id,url,note,checkedAt\r\n');
    expect(changedSince(snapshots, await readAll(dir))).toEqual(['data/menus.csv']);
  });

  it('更新日時だけ変わって中身が同じなら上書きしてよい', async () => {
    const dir = exampleFolder();
    const { snapshots } = await open(dir);
    dir.touch('data/circles.csv');
    const now = await readAll(dir);
    expect(now['data/circles.csv'].lastModified).not.toBe(snapshots['data/circles.csv'].lastModified);
    expect(changedSince(snapshots, now)).toEqual([]);
  });

  it('changedSince は大きさ・中身・有無を比べる（純粋な関数）', () => {
    const s = (text: string, exists = true) => ({ exists, text, lastModified: 1, size: new TextEncoder().encode(text).length });
    const base: Snapshots = {
      'event.json': { path: 'event.json', ...s('{}') },
      'data/circles.csv': { path: 'data/circles.csv', ...s('a') },
      'data/menus.csv': { path: 'data/menus.csv', ...s('', false) },
    };
    expect(changedSince(base, base)).toEqual([]);
    expect(changedSince(base, { ...base, 'data/circles.csv': { ...base['data/circles.csv'], text: 'b' } })).toEqual(['data/circles.csv']);
    expect(changedSince(base, { ...base, 'event.json': { ...base['event.json'], size: 3 } })).toEqual(['event.json']);
    expect(changedSince(base, { ...base, 'data/menus.csv': { ...base['data/menus.csv'], exists: true } })).toEqual(['data/menus.csv']);
  });
});

describe('サークルとお品書きの編集', () => {
  it('サークルを消すと、そのサークルのお品書きも消す', async () => {
    const { doc } = await open(exampleFolder());
    const circle = doc.circles.find((c) => c.values.id === 'a-01')!;
    const res = removeCircle(doc, circle.key);
    expect(res.removedMenus).toBe(1);
    expect(serializeMenus(res.doc)).toBe('id,url,note,checkedAt\r\nc-01,https://example.com/circle7/menu,,2030-01-01\r\n');
    expect(res.doc.circles.map((c) => c.values.id)).not.toContain('a-01');
  });

  it('id を変えたら、お品書きの id も付け替えられる', async () => {
    const { doc } = await open(exampleFolder());
    const circle = doc.circles.find((c) => c.values.id === 'c-01')!;
    const next = updateCircle(doc, circle.key, 'id', 'c-01x');
    const res = renameMenus(next, 'c-01', circleId(next.circles.find((c) => c.key === circle.key)!.values));
    expect(res.moved).toBe(1);
    expect(serializeMenus(res.doc)).toContain('c-01x,https://example.com/circle7/menu');
  });

  it('お品書きの URL を変えると、確認した日を今日にする', async () => {
    const { doc } = await open(exampleFolder());
    const next = updateMenu(doc, doc.menus[0].key, 'url', 'https://example.com/new', new Date(2030, 11, 31));
    expect(next.menus[0].values).toMatchObject({ url: 'https://example.com/new', checkedAt: '2030-12-31' });
    expect(updateMenu(doc, doc.menus[0].key, 'note', '既刊').menus[0].values.checkedAt).toBe('2030-01-01');
  });
});

describe('フォルダの選び方', () => {
  it('イベントのフォルダならそのまま、リポジトリや events/ なら中のイベントを候補にする', async () => {
    expect((await findEventDirs(exampleFolder())).isEvent).toBe(true);
    const repo = new FakeDir('repo').put('events/b/event.json', '{}').put('events/a/event.json', '{}').put('events/c/memo.txt', '').put('README.md', '');
    const found = await findEventDirs(repo);
    expect(found.isEvent).toBe(false);
    expect(found.candidates.map((c) => c.label)).toEqual(['events/a', 'events/b']);
    const events = await repo.getDirectoryHandle('events');
    expect((await findEventDirs(events)).candidates.map((c) => c.label)).toEqual(['a', 'b']);
  });
});
