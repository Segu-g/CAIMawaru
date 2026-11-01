import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore scripts/ は型定義のない Node 用の JS
import { knownEvents, requireEvent } from './lib.mjs';

const known = ['example', 'other'];

describe('requireEvent（pnpm dev / preview のイベントの指定）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('events/ にサンプルがある', () => {
    expect(knownEvents()).toContain('example');
  });

  it('最初の引数を eventId として取り出し、残りは Vite に渡す', () => {
    expect(requireEvent(['example', '--host'], 'pnpm dev <eventId>', known)).toEqual({ eventId: 'example', rest: ['--host'] });
  });

  it.each([[[]], [['--host']], [['nosuch']]])('指定がない・不明なイベントなら終了する: %j', (args) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => requireEvent(args, 'pnpm dev <eventId>', known)).toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
