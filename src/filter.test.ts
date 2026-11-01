import { describe, expect, it } from 'vitest';
import type { Circle, Filters, Mine } from './types';
import { allEvents, allTags, matches, safeUrl, sortCircles } from './filter';
import { fromExport, mergeMine, parseMine, toExport } from './useMine';

const circle = (over: Partial<Circle>): Circle => ({
  id: 'x', space: '', event: '', adult: false, name: '', kana: '', penNames: [], tags: [], links: {}, menus: [], notes: '', source: '',
  ...over,
});
const none: Filters = { q: '', event: '', tag: '', pick: '', menu: '', sort: 'space' };
const noMine: Mine = { stars: {}, bought: {}, tags: {}, memos: {} };

const a2 = circle({ id: 'a-2', space: 'A-2', name: '甲', kana: 'こう', tags: ['ジャンル1'],
  menus: [{ url: 'https://x.com/a/status/1', note: '', checkedAt: '' }] });
const a10 = circle({ id: 'a-10', space: 'A-10', name: '乙', kana: 'おつ', penNames: ['作家B'], tags: ['ジャンル2', 'ジャンル1'] });
const bad = circle({ id: 'b-1', space: 'B-1', name: '丙', menus: [{ url: 'javascript:alert(1)', note: '', checkedAt: '' }] });

describe('safeUrl', () => {
  it('http(s) 以外は拒否する', () => {
    expect(safeUrl('https://x.com/a')).toBe('https://x.com/a');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
});

describe('sortCircles', () => {
  it('スペース番号を数値として並べる', () => {
    expect(sortCircles([a10, bad, a2], 'space').map((c) => c.id)).toEqual(['a-2', 'a-10', 'b-1']);
  });
  it('サークル名順は読み（kana）を優先する', () => {
    expect(sortCircles([a2, a10], 'name').map((c) => c.id)).toEqual(['a-10', 'a-2']);
  });
});

describe('matches', () => {
  it('ジャンルで絞り込む', () => {
    expect([a2, a10, bad].filter((c) => matches(c, { ...none, tag: 'ジャンル2' }, noMine))).toEqual([a10]);
  });
  it('不正なURLはお品書きとして数えない', () => {
    expect([a2, a10, bad].filter((c) => matches(c, { ...none, menu: 'yes' }, noMine))).toEqual([a2]);
  });
  it('★・タグで絞り込む', () => {
    const mine: Mine = { stars: { 'a-10': true }, bought: {}, tags: { 'b-1': ['新刊'] }, memos: {} };
    const all = [a2, a10, bad];
    expect(all.filter((c) => matches(c, { ...none, pick: 'star' }, mine))).toEqual([a10]);
    expect(all.filter((c) => matches(c, { ...none, pick: 'picked' }, mine))).toEqual([a10, bad]);
    expect(all.filter((c) => matches(c, { ...none, pick: 'none' }, mine))).toEqual([a2]);
    expect(all.filter((c) => matches(c, { ...none, pick: 'tag:新刊' }, mine))).toEqual([bad]);
  });
  it('購入済み・未購入で絞り込む', () => {
    // a-10: ★・購入済み / b-1: タグのみ（未購入） / a-2: 購入済みのみ
    const mine: Mine = { stars: { 'a-10': true }, bought: { 'a-10': true, 'a-2': true }, tags: { 'b-1': ['新刊'] }, memos: {} };
    const all = [a2, a10, bad];
    expect(all.filter((c) => matches(c, { ...none, pick: 'bought' }, mine))).toEqual([a2, a10]);
    expect(all.filter((c) => matches(c, { ...none, pick: 'todo' }, mine))).toEqual([bad]);
    expect(all.filter((c) => matches(c, { ...none, pick: 'picked' }, mine))).toEqual(all);
  });
  it('作家名と自分のメモも検索対象にする（複数語はAND）', () => {
    const mine: Mine = { stars: {}, bought: {}, tags: { 'a-10': ['友人'] }, memos: { 'a-2': '新刊 2冊' } };
    expect([a2, a10].filter((c) => matches(c, { ...none, q: '作家b' }, mine))).toEqual([a10]);
    expect([a2, a10].filter((c) => matches(c, { ...none, q: '新刊 2冊' }, mine))).toEqual([a2]);
    expect([a2, a10].filter((c) => matches(c, { ...none, q: '友人' }, mine))).toEqual([a10]);
  });
});

describe('イベント', () => {
  const ev1 = circle({ id: 'e1', space: 'B-01', event: 'イベントB' });
  const ev2 = circle({ id: 'e2', space: 'A-01', event: 'イベントA' });
  it('イベントで絞り込む', () => {
    expect([ev1, ev2].filter((c) => matches(c, { ...none, event: 'イベントA' }, noMine))).toEqual([ev2]);
  });
  it('イベント名も検索対象にする', () => {
    expect([ev1, ev2].filter((c) => matches(c, { ...none, q: 'イベントb' }, noMine))).toEqual([ev1]);
  });
  it('イベント一覧はデータの出現順', () => {
    expect(allEvents([ev1, ev2, ev1])).toEqual(['イベントB', 'イベントA']);
  });
});

describe('allTags', () => {
  it('重複を除いて並べる', () => {
    expect(allTags([a2, a10])).toEqual(['ジャンル1', 'ジャンル2']);
  });
});

describe('parseMine', () => {
  it('不正な値を取り除く', () => {
    expect(parseMine({ stars: { a: true, b: 'x' }, tags: { a: [' 新刊 ', 1, '新刊', ''], b: 'x' }, memos: { a: 'x', b: 1 } }))
      .toEqual({ stars: { a: true }, bought: {}, tags: { a: ['新刊'] }, memos: { a: 'x' } });
    expect(parseMine(null)).toEqual({ stars: {}, bought: {}, tags: {}, memos: {} });
  });
  it('購入済みを読み込む', () => {
    expect(parseMine({ bought: { a: true, b: 1 } }).bought).toEqual({ a: true });
  });
  it('旧形式（絶対行く・気になる）を ★ と「気になる」タグに移す', () => {
    expect(parseMine({ marks: { a: 'must', b: 'maybe', c: 'bogus' }, memos: {} }))
      .toEqual({ stars: { a: true }, bought: {}, tags: { b: ['気になる'] }, memos: {} });
  });
});

describe('書き出し・読み込み', () => {
  const a: Mine = { stars: { x: true }, bought: { x: true }, tags: { x: ['新刊'] }, memos: { x: 'A' } };
  const b: Mine = { stars: { y: true }, bought: {}, tags: { x: ['友人'], y: ['気になる'] }, memos: { x: 'B', y: 'C' } };
  it('書き出した形式を読み込める（中身だけの古い形式も）', () => {
    expect(fromExport(JSON.parse(JSON.stringify(toExport(a))))).toEqual(a);
    expect(fromExport(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
  it('追加は★・購入済み・タグを足し合わせ、メモはつなぐ', () => {
    expect(mergeMine(a, b)).toEqual({
      stars: { x: true, y: true },
      bought: { x: true },
      tags: { x: ['新刊', '友人'], y: ['気になる'] },
      memos: { x: 'A\nB', y: 'C' },
    });
  });
});
