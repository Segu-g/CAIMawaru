import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Mine } from './types';
import { compareJa } from './filter';

export const STORE_ID = import.meta.env.VITE_STORE_ID;
const STORE_KEY = `circlelist:${STORE_ID}:v1`;
// まだ誰も使っていなくても候補に出すタグ
export const DEFAULT_TAGS = ['気になる', '新刊', 'グッズ'];

const empty = (): Mine => ({ stars: {}, bought: {}, tags: {}, memos: {} });

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').slice(0, 20);
}

// 保存データの読み込み。旧形式（marks: 絶対行く / 気になる）は ★ と「気になる」タグに移す
export function parseMine(value: unknown): Mine {
  if (typeof value !== 'object' || value === null) return empty();
  const v = value as Record<string, Record<string, unknown> | undefined>;
  const mine = empty();
  for (const [id, s] of Object.entries(v.stars ?? {})) {
    if (s === true) mine.stars[id] = true;
  }
  for (const [id, s] of Object.entries(v.bought ?? {})) {
    if (s === true) mine.bought[id] = true;
  }
  for (const [id, list] of Object.entries(v.tags ?? {})) {
    if (!Array.isArray(list)) continue;
    const tags = [...new Set(list.filter((t): t is string => typeof t === 'string').map(normalizeTag).filter(Boolean))];
    if (tags.length) mine.tags[id] = tags;
  }
  for (const [id, m] of Object.entries(v.marks ?? {})) {
    if (m === 'must') mine.stars[id] = true;
    if (m === 'maybe' && !mine.tags[id]?.includes('気になる')) mine.tags[id] = [...(mine.tags[id] ?? []), '気になる'];
  }
  for (const [id, m] of Object.entries(v.memos ?? {})) {
    if (typeof m === 'string' && m) mine.memos[id] = m;
  }
  return mine;
}

// 2つを合わせる（★・購入済み・タグは足し合わせ、メモは両方あれば改行でつなぐ）
export function mergeMine(a: Mine, b: Mine): Mine {
  const tags: Mine['tags'] = { ...a.tags };
  for (const [id, list] of Object.entries(b.tags)) tags[id] = [...new Set([...(tags[id] ?? []), ...list])];
  const memos: Mine['memos'] = { ...a.memos };
  for (const [id, m] of Object.entries(b.memos)) {
    memos[id] = memos[id] && memos[id] !== m ? `${memos[id]}\n${m}` : m;
  }
  return { stars: { ...a.stars, ...b.stars }, bought: { ...a.bought, ...b.bought }, tags, memos };
}

// 書き出しファイルの形。読み込みでは中身（mine）だけの古い形式も受け付ける
export const EXPORT_FORMAT = `circlelist-${STORE_ID}`;
export function toExport(mine: Mine) {
  return { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), mine };
}
export function fromExport(value: unknown): Mine {
  const v = value as { format?: string; mine?: unknown } | null;
  return parseMine(v && v.format === EXPORT_FORMAT ? v.mine : value);
}

function load(): Mine {
  try {
    return parseMine(JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'));
  } catch {
    return empty();
  }
}

// 閲覧者の ★・タグ・メモ。ブラウザ内（localStorage）のみに保存し、外部には送らない
export function useMine() {
  const [mine, setMine] = useState<Mine>(load);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(mine));
  }, [mine]);

  const toggleStar = useCallback((id: string) => {
    setMine((prev) => {
      const stars = { ...prev.stars };
      if (stars[id]) delete stars[id];
      else stars[id] = true;
      return { ...prev, stars };
    });
  }, []);

  const toggleBought = useCallback((id: string) => {
    setMine((prev) => {
      const bought = { ...prev.bought };
      if (bought[id]) delete bought[id];
      else bought[id] = true;
      return { ...prev, bought };
    });
  }, []);

  const toggleTag = useCallback((id: string, tag: string) => {
    const t = normalizeTag(tag);
    if (!t) return;
    setMine((prev) => {
      const tags = { ...prev.tags };
      const cur = tags[id] ?? [];
      const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
      if (next.length) tags[id] = next;
      else delete tags[id];
      return { ...prev, tags };
    });
  }, []);

  const setMemo = useCallback((id: string, text: string) => {
    setMine((prev) => {
      const memos = { ...prev.memos };
      if (text) memos[id] = text;
      else delete memos[id];
      return { ...prev, memos };
    });
  }, []);

  const replace = useCallback((value: Mine) => setMine(value), []);
  const merge = useCallback((value: Mine) => setMine((prev) => mergeMine(prev, value)), []);
  const reset = useCallback(() => setMine(empty()), []);

  // タグの候補: 既定のタグ + 自分で付けたタグ
  const allTags = useMemo(() => {
    const used = Object.values(mine.tags).flat();
    return [...new Set([...DEFAULT_TAGS, ...used.sort(compareJa)])];
  }, [mine.tags]);

  return { mine, allTags, toggleStar, toggleBought, toggleTag, setMemo, replace, merge, reset };
}
