// 保存前の簡単な確認。正式な検証は Python の uv run caimawaru data <eventId>（tools/caimawaru/build.py）で、
// ここでは入力の間違いに早く気づくための、明らかなものだけを見る。
import { circleId, DATE, isDataRow, isHttpUrl, LINK_KEYS, type JsonObject, type Row } from './model';

export type Issue = {
  level: 'error' | 'warning';
  where: 'circle' | 'menu' | 'event';
  /** 行の key（サークル・お品書き）。画面でその行を開くのに使う */
  key?: number;
  message: string;
};

const POST_URL = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/;
const X_PAGE = /^https?:\/\/(?:www\.|mobile\.)?(x|twitter)\.com\//i;

function label(values: Record<string, string>): string {
  const s = values.space?.trim();
  const n = values.name?.trim();
  return [s, n].filter(Boolean).join(' ') || '（名前なし）';
}

export function checkCircles(circles: Row[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, Row>();
  const err = (r: Row, message: string) => issues.push({ level: 'error', where: 'circle', key: r.key, message: `${label(r.values)}: ${message}` });
  for (const r of circles) {
    const v = r.values;
    if (!isDataRow(v)) continue;
    const id = circleId(v);
    if (!id) {
      err(r, 'id もスペース番号もありません');
      continue;
    }
    const first = seen.get(id);
    if (first) err(r, `id「${id}」が重複しています（${label(first.values)} と同じ）`);
    else seen.set(id, r);
    if (!v.name.trim()) err(r, 'サークル名（name）が空です');
    for (const k of LINK_KEYS) {
      const url = v[k].trim();
      if (url && !isHttpUrl(url)) err(r, `${k} の URL が不正です: ${url}`);
    }
    if (!['', '0', '1'].includes(v.adult.trim())) err(r, `adult は 0 / 1 / 空欄のいずれかにしてください: ${v.adult}`);
  }
  return issues;
}

export function checkMenus(menus: Row[], circles: Row[]): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set(circles.filter((r) => isDataRow(r.values)).map((r) => circleId(r.values)));
  const seen = new Set<string>();
  const add = (level: Issue['level'], r: Row, message: string) => issues.push({ level, where: 'menu', key: r.key, message });
  for (const r of menus) {
    const v = r.values;
    if (!isDataRow(v)) continue;
    const id = v.id.trim();
    const url = v.url.trim();
    const where = `お品書き（${id || 'id なし'}）`;
    if (!ids.has(id)) add('error', r, `${where}: circles.csv に id「${id}」がありません`);
    if (!isHttpUrl(url)) add('error', r, `${where}: URL が不正です: ${url || '（空欄）'}`);
    else if (X_PAGE.test(url) && !POST_URL.test(url)) add('warning', r, `${where}: X の投稿ではないページです（プロフィール等を登録していませんか）: ${url}`);
    const checked = v.checkedAt.trim();
    if (checked && !DATE.test(checked)) add('warning', r, `${where}: checkedAt は YYYY-MM-DD にしてください: ${checked}`);
    const dup = `${id}\n${url.split('?')[0]}`;
    if (seen.has(dup)) add('warning', r, `${where}: 同じ URL が重複しています: ${url}`);
    seen.add(dup);
  }
  return issues;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function checkEvent(event: JsonObject): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], message: string) => issues.push({ level, where: 'event', message });
  for (const k of ['storeId', 'title']) if (!event[k]) add('error', `${k} がありません`);
  const info = obj(event.info) ?? {};
  for (const k of ['name', 'date', 'venue']) if (!info[k]) add('warning', `info.${k} が未入力です`);
  if (typeof info.date === 'string' && info.date && !DATE.test(info.date)) add('error', `info.date は YYYY-MM-DD にしてください: ${info.date}`);
  if (Array.isArray(info.links)) {
    for (const l of info.links) {
      const url = obj(l)?.url;
      if (typeof url !== 'string' || !isHttpUrl(url)) add('error', `info.links の URL が不正です: ${String(url ?? '（空欄）')}`);
    }
  }
  const contact = obj(info.contact);
  if (contact && (typeof contact.url !== 'string' || !isHttpUrl(contact.url))) add('error', `info.contact の URL が不正です: ${String(contact.url ?? '（空欄）')}`);
  for (const [name, n] of Object.entries(obj(info.eventSlots) ?? {})) {
    if (!(Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5)) add('error', `info.eventSlots の ${name} は 1〜5 にしてください: ${String(n)}`);
  }
  return issues;
}
