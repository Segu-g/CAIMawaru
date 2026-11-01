import { describe, expect, it } from 'vitest';
import { slotColorCss } from './slotColors';

describe('slotColorCss', () => {
  it('指定がなければ何も出さない', () => {
    expect(slotColorCss(undefined)).toBe('');
    expect(slotColorCss({})).toBe('');
  });

  it('ライトとダーク（自動・明示）に当てる。ダーク未指定ならライトの色', () => {
    const css = slotColorCss({ '1': { light: '#111111', ink: '#ffffff' }, '2': { light: '#222222', dark: '#333333' } });
    expect(css).toContain(':root { --ev-1: #111111; --ev-1-ink: #ffffff; --ev-2: #222222; }');
    expect(css.match(/--ev-2: #333333;/g)).toHaveLength(2);
    expect(css.match(/--ev-1: #111111;/g)).toHaveLength(3);
  });

  it('1〜5 以外の枠は無視する（style.css の枠は5つ）', () => {
    expect(slotColorCss({ x: { light: 'red' }, '6': { light: 'red' } })).toBe('');
  });
});
