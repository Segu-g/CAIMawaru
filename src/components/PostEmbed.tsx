import { useEffect, useRef, useState } from 'react';
import { loadWidgets } from '../xEmbed';
import { isDarkNow } from '../useTheme';

// お品書き（Xの投稿）を1件表示する。表示されたときに初めて X のスクリプトを読み込む
export function PostEmbed({ id, url, note }: { id: string; url: string; note: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el) return;
    // 実行ごとに専用の入れ物を使う。createTweet は非同期なので、片付け後に届いた埋め込みは
    // 切り離した入れ物に入り、画面には出ない（同じ投稿が二重に表示されるのを防ぐ）
    const host = document.createElement('div');
    el.append(host);
    const dark = isDarkNow();
    loadWidgets()
      .then((t) => t.widgets.createTweet(id, host, {
        lang: 'ja',
        dnt: true, // 閲覧データを個人に合わせた広告等に使わないよう X に求める
        conversation: 'none',
        align: 'center',
        theme: dark ? 'dark' : 'light',
      }))
      // 削除・非公開の投稿は undefined が返る
      .then((node) => { if (!cancelled) setState(node ? 'done' : 'failed'); })
      .catch(() => { if (!cancelled) setState('failed'); });
    return () => {
      cancelled = true;
      host.remove();
    };
  }, [id]);

  return (
    <div className="post-embed">
      {note && <p className="meta">{note}</p>}
      {state === 'loading' && <p className="meta">読み込み中…</p>}
      {state === 'failed' && (
        <p className="meta">
          表示できませんでした（削除・非公開、または通信状況のため）。
          <a href={url} target="_blank" rel="noopener noreferrer">Xで開く</a>
        </p>
      )}
      <div ref={ref} />
    </div>
  );
}
