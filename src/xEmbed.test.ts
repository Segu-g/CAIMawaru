import { describe, expect, it } from 'vitest';
import { postIdOf } from './xEmbed';

describe('postIdOf', () => {
  it('Xの投稿URLから投稿IDを取り出す', () => {
    expect(postIdOf('https://x.com/example_user/status/1234567890123456789')).toBe('1234567890123456789');
    expect(postIdOf('https://twitter.com/a/status/1')).toBe('1');
  });
  it('投稿以外は対象外', () => {
    expect(postIdOf('https://x.com/example_user')).toBeNull();
    expect(postIdOf('https://pbs.twimg.com/media/abc?format=jpg')).toBeNull();
    expect(postIdOf('https://www.pixiv.net/en/artworks/12345678')).toBeNull();
  });
});
