import type { Circle, Filters, Mine } from './types';

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
export const compareJa = collator.compare;

// データ内のURLは http(s) のみリンクにする
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// イベントの色の枠（1〜5）。枠のないイベントは 0（灰色）
export const MAX_SLOT = 5;
export function slotOf(event: string, slots: Record<string, number> | undefined): number {
  const s = slots?.[event];
  return s && s >= 1 && s <= MAX_SLOT ? s : 0;
}

// "A-01,A-02" のような複数スペースを分割する
export function spacesOf(c: Circle): string[] {
  return c.space.split(',').map((s) => s.trim()).filter(Boolean);
}

export function validMenus(c: Circle) {
  return c.menus.filter((m) => safeUrl(m.url));
}

// ★・タグ・購入済みのどれかが付いているか（マイリストに載せるか）
export const isPicked = (mine: Mine, id: string) => !!mine.stars[id] || !!mine.tags[id]?.length || !!mine.bought[id];
// まだ買いに行っていない目当てのサークル（★かタグありで未購入）
export const isTodo = (mine: Mine, id: string) => (!!mine.stars[id] || !!mine.tags[id]?.length) && !mine.bought[id];

export function matches(c: Circle, f: Filters, mine: Mine): boolean {
  if (f.event && c.event !== f.event) return false;
  if (f.tag && !c.tags.includes(f.tag)) return false;

  const picked = isPicked(mine, c.id);
  if (f.pick === 'star' && !mine.stars[c.id]) return false;
  if (f.pick === 'picked' && !picked) return false;
  if (f.pick === 'none' && picked) return false;
  if (f.pick === 'todo' && !isTodo(mine, c.id)) return false;
  if (f.pick === 'bought' && !mine.bought[c.id]) return false;
  if (f.pick.startsWith('tag:') && !mine.tags[c.id]?.includes(f.pick.slice(4))) return false;

  const hasMenu = validMenus(c).length > 0;
  if (f.menu === 'yes' && !hasMenu) return false;
  if (f.menu === 'no' && hasMenu) return false;

  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [c.space, c.event, c.name, c.kana, ...c.penNames, ...c.tags, c.notes, mine.memos[c.id], ...(mine.tags[c.id] ?? [])]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function sortCircles(list: Circle[], sort: Filters['sort']): Circle[] {
  return [...list].sort((a, b) =>
    sort === 'name'
      ? compareJa(a.kana || a.name, b.kana || b.name)
      : compareJa(a.space || '￿', b.space || '￿'),
  );
}

export function allTags(circles: Circle[]): string[] {
  return [...new Set(circles.flatMap((c) => c.tags))].sort(compareJa);
}

// 参加イベントはデータ上の出現順（＝配置順）で並べる
export function allEvents(circles: Circle[]): string[] {
  return [...new Set(circles.map((c) => c.event).filter(Boolean))];
}
