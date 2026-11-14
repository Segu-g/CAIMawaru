// 保存前の簡単な確認。正式な検証は Python の uv run caimawaru data <eventId>（tools/caimawaru/build.py）で、
// ここでは入力の間違いに早く気づくための、明らかなものだけを見る。
import { hasSpace, isXPage, normalizeUrl, xHandleOf } from './menuMatch';
import { circleId, DATE, isDataRow, isHttpUrl, LINK_KEYS, type JsonObject, type Row } from './model';

export type Issue = {
  level: 'error' | 'warning';
  where: 'circle' | 'menu' | 'event';
  /** 行の key（サークル・お品書き）。画面でその行を開くのに使う */
  key?: number;
  message: string;
};

function label(values: Record<string, string>): string {
  const s = values.space?.trim();
  const n = values.name?.trim();
  return [s, n].filter(Boolean).join(' ') || '（名前なし）';
}

/** id の出どころ（「id 列」「スペース エ-04 から作った id」）。重複などを知らせるときに添える（build.py の id_origin と同じ） */
export function idOrigin(values: Record<string, string>): string {
  return values.id?.trim() ? 'id 列' : `スペース ${values.space?.trim() ?? ''} から作った id`;
}

/** id 列に書いた id の、紛らわしい書き方（空白・「,」・大文字）の警告（build.py の check_id_text と同じ）。止めはしない */
export function idTextWarning(id: string, values: Record<string, string>): string | null {
  if (!values.id?.trim()) return null;
  const found = ([['空白', hasSpace(id)], ['「,」', id.includes(',')], ['大文字', id !== id.toLowerCase()]] as const)
    .filter(([, hit]) => hit).map(([name]) => name);
  if (!found.length) return null;
  return `id「${id}」に${found.join('・')}が入っています（そのままでも使えます。新しく付ける id は、空白・「,」を入れず小文字にしてください。公開後は変えません）`;
}

export function checkCircles(circles: Row[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, Row>();
  const seenLower = new Map<string, [string, Row]>();
  const err = (r: Row, message: string) => issues.push({ level: 'error', where: 'circle', key: r.key, message: `${label(r.values)}: ${message}` });
  const warn = (r: Row, message: string) => issues.push({ level: 'warning', where: 'circle', key: r.key, message: `${label(r.values)}: ${message}` });
  for (const r of circles) {
    const v = r.values;
    if (!isDataRow(v, r.extra)) continue;
    const id = circleId(v);
    if (!id) {
      const space = v.space?.trim();
      err(r, space ? `スペース番号「${space}」から id を作れません（文字か数字が要ります）。id 列に id を書いてください` : 'id もスペース番号もありません');
      continue;
    }
    const text = idTextWarning(id, v);
    if (text) warn(r, text);
    const first = seen.get(id);
    if (first) {
      issues.push({ level: 'error', where: 'circle', key: r.key,
        message: `${label(v)}（${idOrigin(v)}）: id「${id}」が ${label(first.values)}（${idOrigin(first.values)}）と重複しています。`
          + '★・タグ・メモとお品書きが2つのサークルで混ざるので、どちらかの id 列に別の id を書いてください' });
    } else {
      seen.set(id, r);
      const other = seenLower.get(id.toLowerCase());
      if (!other) seenLower.set(id.toLowerCase(), [id, r]);
      else if (other[0] !== id) warn(r, `id「${id}」は ${label(other[1].values)} の id「${other[0]}」と大文字・小文字だけが違います（別のサークルとして扱います）`);
    }
    if (!v.name.trim()) err(r, 'サークル名（name）が空です');
    for (const k of LINK_KEYS) {
      const url = v[k].trim();
      if (url && !isHttpUrl(url)) err(r, `${k} の URL が不正です: ${url}`);
    }
    // x 列はお品書きの照合に使う（build.py と同じく、照合できない URL は知らせる）
    const x = v.x.trim();
    if (x && isHttpUrl(x) && !xHandleOf(v)) {
      issues.push({ level: 'warning', where: 'circle', key: r.key, message: `${label(v)}: x が X のアカウントの URL ではありません（https://x.com/<ID> の形にしてください）: ${x}` });
    }
    if (!['', '0', '1'].includes(v.adult.trim())) err(r, `adult は 0 / 1 / 空欄のいずれかにしてください: ${v.adult}`);
  }
  return issues;
}

export function checkMenus(menus: Row[], circles: Row[]): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set(circles.filter((r) => isDataRow(r.values, r.extra)).map((r) => circleId(r.values)));
  const seen = new Set<string>();
  const add = (level: Issue['level'], r: Row, message: string) => issues.push({ level, where: 'menu', key: r.key, message });
  for (const r of menus) {
    const v = r.values;
    if (!isDataRow(v, r.extra)) continue;
    const id = v.id.trim();
    const url = v.url.trim();
    const where = `お品書き（${id || 'id なし'}）`;
    if (!ids.has(id)) add('error', r, `${where}: circles.csv に id「${id}」がありません`);
    if (!isHttpUrl(url)) add('error', r, `${where}: URL が不正です: ${url || '（空欄）'}`);
    else if (isXPage(url) && !normalizeUrl(url).handle) add('warning', r, `${where}: X の投稿ではないページです（プロフィール等を登録していませんか）: ${url}`);
    const checked = v.checkedAt.trim();
    if (checked && !DATE.test(checked)) add('warning', r, `${where}: checkedAt は YYYY-MM-DD にしてください: ${checked}`);
    const dup = `${id}\n${normalizeUrl(url).url}`;
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
