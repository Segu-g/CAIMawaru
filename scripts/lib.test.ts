import { describe, expect, it } from 'vitest';
// @ts-ignore scripts/ は型定義のない Node 用の JS
import { knownEvents, takeEvent } from './lib.mjs';

// tools/tests/test_eventargs.py と同じ規則を確かめる
const known = ['example', 'other'];

describe('takeEvent（イベントの指定）', () => {
  it('events/ にサンプルがある', () => {
    expect(knownEvents()).toContain('example');
  });

  it('最初の引数がイベント名なら取り出す', () => {
    expect(takeEvent(['example', '--check'], known)).toMatchObject({ eventId: 'example', rest: ['--check'] });
  });

  it('--event <eventId> と --event=<eventId> はどの位置でもよい', () => {
    expect(takeEvent(['--check', '--event', 'example'], known)).toMatchObject({ eventId: 'example', rest: ['--check'] });
    expect(takeEvent(['--event=example', '--port', '1'], known)).toMatchObject({ eventId: 'example', rest: ['--port', '1'] });
  });

  it('両方で同じイベントなら可、違えばエラー', () => {
    expect(takeEvent(['example', '--event', 'example'], known)).toMatchObject({ eventId: 'example', rest: [] });
    expect(takeEvent(['other', '--event', 'example'], known).error).toMatch(/2つ/);
    expect(takeEvent(['--event'], known).error).toBeDefined();
  });

  it('環境変数は使わない。イベント名でない引数は残す', () => {
    process.env.EVENT = 'example';
    try {
      expect(takeEvent(['https://example.com/'], known)).toMatchObject({ eventId: undefined, rest: ['https://example.com/'] });
    } finally {
      delete process.env.EVENT;
    }
  });
});
