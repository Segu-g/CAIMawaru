import { describe, expect, it } from 'vitest';
import { xShareUrl } from './share';

describe('xShareUrl', () => {
  it('本文・URL・ハッシュタグを付けた投稿画面のURLを作る', () => {
    const u = new URL(xShareUrl('サンプル即売会 サークルリスト', 'https://example.com/a/', ['#サンプル即売会', 'サンプル']));
    expect(u.origin + u.pathname).toBe('https://x.com/intent/post');
    expect(u.searchParams.get('text')).toBe('サンプル即売会 サークルリスト');
    expect(u.searchParams.get('url')).toBe('https://example.com/a/');
    expect(u.searchParams.get('hashtags')).toBe('サンプル即売会,サンプル');
  });
  it('ハッシュタグがなければ付けない', () => {
    expect(new URL(xShareUrl('t', 'https://example.com/')).searchParams.has('hashtags')).toBe(false);
  });
});
