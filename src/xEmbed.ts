// X 公式の埋め込み（X for Websites）。利用者がボタンを押したときだけ読み込む。

type Twttr = {
  widgets: {
    createTweet: (id: string, el: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLElement | undefined>;
  };
};

declare global {
  interface Window {
    twttr?: Twttr & { ready?: (cb: (t: Twttr) => void) => void };
  }
}

const WIDGETS_URL = 'https://platform.twitter.com/widgets.js';
let loading: Promise<Twttr> | undefined;

export function loadWidgets(): Promise<Twttr> {
  if (loading) return loading;
  loading = new Promise<Twttr>((resolve, reject) => {
    if (window.twttr?.widgets) {
      resolve(window.twttr);
      return;
    }
    const s = document.createElement('script');
    s.src = WIDGETS_URL;
    s.async = true;
    s.charset = 'utf-8';
    s.onload = () => (window.twttr?.widgets ? resolve(window.twttr) : reject(new Error('widgets unavailable')));
    s.onerror = () => reject(new Error('widgets load failed'));
    document.head.append(s);
  });
  // 失敗したら次回また読み込みを試せるようにする
  loading.catch(() => { loading = undefined; });
  return loading;
}

const POST = /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d+)/;

export function postIdOf(url: string): string | null {
  return url.match(POST)?.[1] ?? null;
}
