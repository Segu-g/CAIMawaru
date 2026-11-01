import { useEffect, useState } from 'react';

export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'circlelist:theme';

function load(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

// 実際に表示されているのがダークか（X の埋め込みの配色合わせに使う）
export function isDarkNow(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

// 表示テーマ（自動 / ライト / ダーク）。<html data-theme> に反映し、この端末に保存する
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(load);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // 保存できなくても表示の切り替えはできる
    }
    // スマホのアドレスバー等の色を背景色に合わせる
    const bg = getComputedStyle(document.body).backgroundColor;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [theme]);

  return { theme, setTheme };
}
