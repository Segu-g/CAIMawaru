// X の投稿画面（Web Intent）を開くURL。X のスクリプトは読み込まず、リンクを開くだけ
export function xShareUrl(text: string, url: string, hashtags: string[] = []): string {
  const params = new URLSearchParams({ text, url });
  const tags = hashtags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  if (tags.length) params.set('hashtags', tags.join(','));
  return `https://x.com/intent/post?${params.toString()}`;
}

// 共有するのはページそのもの（?や# の後ろは付けない）
export function pageUrl(): string {
  return `${location.origin}${location.pathname}`;
}
