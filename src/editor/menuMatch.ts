// お品書きの URL とサークルの照らし合わせ（CLI の tools/caimawaru/menu.py と同じ規則）。
// X のページは読まない。URL の文字列だけで判断する。
import type { Doc } from './doc';
import { circleId, isDataRow, isHttpUrl, type Row } from './model';

const X_POST = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i;
const X_PROFILE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i;
const X_PAGE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i;
// プロフィールの URL に見えても、アカウントではない X のページ
const NOT_ACCOUNTS = new Set(['home', 'search', 'explore', 'i', 'intent', 'share', 'hashtag', 'messages', 'notifications', 'settings', 'compose', 'login', 'signup', 'tos', 'privacy']);

/**
 * X の投稿 URL を https://x.com/<ID>/status/<番号> にそろえ、追跡用パラメータ（?s=20 など）を落とす（menu.py の normalize_url と同じ）。
 * handle は投稿したアカウントの ID（X の投稿でなければ null）。
 */
export function normalizeUrl(raw: string): { url: string; handle: string | null } {
  const url = raw.trim();
  const m = X_POST.exec(url);
  return m ? { url: `https://x.com/${m[1]}/status/${m[2]}`, handle: m[1] } : { url, handle: null };
}

/** X のプロフィールの URL なら、そのアカウントの ID（小文字）。投稿・検索などのページは null */
export function profileHandle(url: string): string | null {
  const m = X_PROFILE.exec(url.trim());
  return m && !NOT_ACCOUNTS.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

/** サークルの x 列のアカウントの ID（小文字。menu.py の x_handle と同じく、プロフィールの URL のときだけ） */
export function xHandleOf(values: Record<string, string>): string | null {
  return profileHandle(values.x ?? '');
}

/** アカウントの ID（@ なし）→ プロフィールの URL（x 列に書く形） */
export function profileUrl(handle: string): string {
  return `https://x.com/${handle}`;
}

/** サークル名で X のアカウントを探す検索ページ（人が新しいタブで開くだけ。このページは読まない） */
export function xSearchUrl(name: string): string {
  return `https://x.com/search?q=${encodeURIComponent(name.trim())}&f=user`;
}

const dataCircles = (doc: Doc) => doc.circles.filter((c) => c.comment === undefined && isDataRow(c.values, c.extra));

/**
 * 検索語に当たるサークル（menu.py の find_circles と同じ）。id・スペース（複数スペースのどれか）・@X の ID の完全一致を優先し、
 * なければサークル名・読みの部分一致。
 */
export function findCircles(circles: Row[], query: string): Row[] {
  const q = query.trim();
  const ql = q.toLowerCase().replace(/^@/, '');
  if (!ql) return [];
  const rows = circles.filter((c) => c.comment === undefined && isDataRow(c.values, c.extra));
  const exact = rows.filter((c) => {
    const v = c.values;
    return circleId(v) === ql || v.space.trim().toLowerCase() === ql
      || v.space.split(',').some((s) => s.trim().toLowerCase() === ql) || xHandleOf(v) === ql;
  });
  if (exact.length) return exact;
  return rows.filter((c) => c.values.name.includes(q) || (c.values.kana ?? '').includes(q));
}

/**
 * 一覧の絞り込み用の検索（空白で区切った語をすべて含む）。完全一致（findCircles の規則）が先頭に来るよう並べる。
 */
export function searchCircles(circles: Row[], query: string, hay: (c: Row) => string): Row[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return circles;
  const hit = circles.filter((c) => {
    const h = hay(c).toLowerCase();
    return words.every((w) => h.includes(w.replace(/^@/, '')));
  });
  const exact = new Set(words.length === 1 ? findCircles(circles, query).map((c) => c.key) : []);
  return [...hit.filter((c) => exact.has(c.key)), ...hit.filter((c) => !exact.has(c.key))];
}

/** 一覧の検索で見る値（スペース・名前・読み・作家名・id・@X の ID など） */
export function circleHay(c: Row): string {
  const v = c.values;
  return [circleId(v), v.space, v.name, v.kana, v.penNames, v.event, v.tags, v.x, xHandleOf(v) ?? '', v.notes].join('\n');
}

export type UrlCheck = {
  /** 登録する形（X の投稿は正規化したもの） */
  url: string;
  /** 投稿したアカウント（X の投稿のとき） */
  handle: string | null;
  /** 登録できない理由（URL でない・このサークルに登録済み） */
  error?: string;
  /** 登録はできるが知らせること */
  warnings: string[];
  /** このサークルにすでにある同じ URL のお品書き */
  sameMenu?: Row;
  /** X のプロフィールの URL（お品書きではなく、サークルの X として登録できる） */
  profile?: string;
};

const sameUrl = (a: string, b: string) => normalizeUrl(a).url === normalizeUrl(b).url;
const label = (c: Row) => `${c.values.space} ${c.values.name}`.trim();

/**
 * サークル（circleKey）に登録しようとしている URL を確かめる。
 * replacing は差し替えるお品書きの key（そのお品書き自身との重複は数えない）。
 */
export function checkMenuUrl(doc: Doc, circleKey: number, raw: string, replacing?: number): UrlCheck {
  const { url, handle } = normalizeUrl(raw);
  const warnings: string[] = [];
  const circle = doc.circles.find((c) => c.key === circleKey);
  if (!url) return { url, handle, error: 'URL を貼り付けてください', warnings };
  if (!isHttpUrl(url)) return { url, handle, error: 'http(s) の URL ではありません', warnings };
  const profile = profileHandle(url);
  if (profile) {
    return { url, handle, profile, warnings, error: 'X のプロフィールの URL です。お品書きは投稿の URL（…/status/…）を貼ってください' };
  }
  if (!handle && X_PAGE.test(url)) warnings.push('X の投稿ではないページです');
  const id = circle ? circleId(circle.values) : '';
  const menus = doc.menus.filter((m) => isDataRow(m.values, m.extra) && m.key !== replacing);
  const sameMenu = menus.find((m) => m.values.id.trim() === id && sameUrl(m.values.url, url));
  if (sameMenu) return { url, handle, error: 'このサークルに登録済みです', warnings, sameMenu };
  const elsewhere = menus.filter((m) => m.values.id.trim() !== id && sameUrl(m.values.url, url)).map((m) => m.values.id.trim());
  if (elsewhere.length) {
    const names = [...new Set(elsewhere)].map((oid) => {
      const c = dataCircles(doc).find((r) => circleId(r.values) === oid);
      return c ? label(c) : oid;
    });
    warnings.push(`同じ URL がほかのサークル（${names.join('・')}）に登録されています`);
  }
  if (handle && circle) {
    const own = xHandleOf(circle.values);
    if (own && own !== handle.toLowerCase()) {
      const owner = dataCircles(doc).find((c) => xHandleOf(c.values) === handle.toLowerCase());
      warnings.push(`@${handle} の投稿です（このサークルの X は @${own}）` + (owner ? `。@${handle} は ${label(owner)} の X です` : ''));
    }
  }
  return { url, handle, warnings };
}
