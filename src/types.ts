import type { LayoutSpec } from './layout';

// public/data/circles.json の形（tools/build.py が生成）

export type EventInfo = {
  name: string;
  date: string;
  venue: string;
  hours: string;
  links: { label: string; url: string }[];
  // 同じサイト内のホールの切り替え（ヘッダーに常に表示。url は相対パスで同じタブで開く）
  halls?: { label: string; url: string; current?: boolean }[];
  hashtags: string[];
  // 配置図・カードの色分け（1〜5）。載っていないイベントは灰色の「同時開催」としてまとめる
  eventSlots?: Record<string, number>;
  // 枠ごとの色の上書き（既定は style.css の --ev-1〜5）
  slotColors?: Record<string, SlotColor>;
  // ページ作成者（修正・削除の依頼先）
  contact?: { label: string; url: string };
  updatedAt: string;
};

export type SlotColor = { light: string; dark?: string; ink?: string; darkInk?: string };

export type Menu = {
  url: string;
  note: string;
  checkedAt: string;
};

export type LinkKey = 'x' | 'pixiv' | 'booth' | 'web';

export type Circle = {
  id: string;
  space: string;
  event: string;
  name: string;
  kana: string;
  penNames: string[];
  tags: string[];
  adult: boolean;
  links: Partial<Record<LinkKey, string>>;
  menus: Menu[];
  notes: string;
  source: string;
};

export type CircleData = {
  event: EventInfo;
  circles: Circle[];
  layout?: LayoutSpec; // 配置図（events/<slug>/layout.json）
};

// 閲覧者個人の ★・タグ・メモ（localStorage にのみ保存）
export type Mine = {
  stars: Record<string, true>;
  bought: Record<string, true>; // 当日、買い物を済ませたサークル
  tags: Record<string, string[]>;
  memos: Record<string, string>;
};

// '' すべて / 'star' ★ / 'picked' ★・タグ・購入済みのどれか / 'none' どれもなし /
// 'todo' ★かタグありで未購入 / 'bought' 購入済み / 'tag:<名前>' そのタグ
export type Pick = '' | 'star' | 'picked' | 'none' | 'todo' | 'bought' | `tag:${string}`;

export type Filters = {
  q: string;
  event: string;
  tag: string;
  pick: Pick;
  menu: '' | 'yes' | 'no';
  sort: 'space' | 'name';
};
