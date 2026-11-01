import { afterEach, describe, expect, it } from 'vitest';
// @ts-ignore scripts/ は型定義のない Node 用の JS
import { knownEvents, takeEvent } from './lib.mjs';

describe('takeEvent（イベントの指定）', () => {
  const saved = process.env.EVENT;
  afterEach(() => {
    if (saved === undefined) delete process.env.EVENT;
    else process.env.EVENT = saved;
  });

  it('events/ にサンプルがある', () => {
    expect(knownEvents()).toContain('example');
  });

  it('最初の引数がイベント名なら取り出す', () => {
    expect(takeEvent(['example', '--check'])).toMatchObject({ slug: 'example', rest: ['--check'] });
  });

  it('--event <slug> と --event=<slug> はどの位置でもよい', () => {
    expect(takeEvent(['--check', '--event', 'example'])).toMatchObject({ slug: 'example', rest: ['--check'] });
    expect(takeEvent(['--event=example', '--port', '1'])).toMatchObject({ slug: 'example', rest: ['--port', '1'] });
  });

  it('指定がなければ環境変数 EVENT、イベント名でない引数は残す', () => {
    process.env.EVENT = 'example';
    expect(takeEvent(['https://example.com/'])).toMatchObject({ slug: 'example', rest: ['https://example.com/'] });
    delete process.env.EVENT;
    expect(takeEvent(['--check']).slug).toBeUndefined();
  });
});
