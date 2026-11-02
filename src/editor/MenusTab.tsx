// すべてのお品書き（menus.csv）。どのサークルのものかを付け替えたり、宙に浮いたもの（サークルがない id）を直したりする。
import { useMemo, useState } from 'react';
import type { Doc } from './doc';
import type { Dirty } from './edit';
import CirclePicker from './CirclePicker';
import { checkMenuUrl } from './menuMatch';
import MenuRow from './MenuRow';
import { circleId, isDataRow } from './model';

type Props = {
  doc: Doc;
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
  onOpenCircle: (key: number) => void;
  onHunt: () => void;
};

type Only = '' | 'orphans' | 'warnings';

export default function MenusTab({ doc, edit, onOpenCircle, onHunt }: Props) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<Only>('');

  const circles = useMemo(() => {
    const byId = new Map<string, { key: number; label: string }>();
    for (const c of doc.circles) {
      if (!isDataRow(c.values, c.extra)) continue;
      const id = circleId(c.values);
      if (id && !byId.has(id)) byId.set(id, { key: c.key, label: `${c.values.space} ${c.values.name}`.trim() });
    }
    return byId;
  }, [doc.circles]);

  const rows = doc.menus.filter((m) => isDataRow(m.values, m.extra));
  const orphans = rows.filter((m) => !circles.has(m.values.id.trim()));
  // 投稿者がサークルの X と違う・同じ URL がほかにもある（登録はできるが確かめたいもの）
  const warnings = useMemo(() => {
    const w = new Map<number, string[]>();
    for (const m of doc.menus) {
      if (!isDataRow(m.values, m.extra)) continue;
      const c = circles.get(m.values.id.trim());
      if (!c) continue;
      const res = checkMenuUrl(doc, c.key, m.values.url, m.key);
      const list = [...res.warnings, ...(res.error && res.sameMenu ? ['同じサークルに同じ URL がもう1件あります'] : [])];
      if (list.length) w.set(m.key, list);
    }
    return w;
  }, [doc, circles]);
  const shown = rows.filter((m) => {
    if (only === 'orphans' && circles.has(m.values.id.trim())) return false;
    if (only === 'warnings' && !warnings.has(m.key)) return false;
    const w = q.trim().toLowerCase();
    if (!w) return true;
    const c = circles.get(m.values.id.trim());
    return [m.values.id, m.values.url, m.values.note, c?.label ?? ''].join('\n').toLowerCase().includes(w);
  });

  const setId = (key: number, id: string) =>
    edit((d) => ({ ...d, menus: d.menus.map((m) => (m.key === key ? { ...m, values: { ...m.values, id } } : m)) }), 'menus');

  return (
    <section className="ed-menus-tab">
      <div className="ed-toolbar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="検索（URL・説明・サークル）" aria-label="検索" />
        <select value={only} onChange={(e) => setOnly(e.target.value as Only)} aria-label="絞り込み">
          <option value="">すべて</option>
          <option value="orphans">宙に浮いたもの（{orphans.length}）</option>
          <option value="warnings">確かめたいもの（{warnings.size}）</option>
        </select>
        <button type="button" onClick={onHunt}>お品書き探しで登録する</button>
      </div>
      <p className="meta">
        {shown.length} / {rows.length} 件（ファイルの順）。登録は「お品書き探し」タブから。サークルを付け替えるときは左の欄で検索して選びます。
      </p>
      {orphans.length > 0 && (
        <div className="ed-box warn">
          circles.csv にない id のお品書きが {orphans.length} 件あります。正しいサークルを選ぶか、削除してください（このままだと uv run caimawaru data がエラーにします）。
        </div>
      )}
      <div className="ed-menus">
        {shown.map((m) => {
          const id = m.values.id.trim();
          const c = circles.get(id);
          return (
            <MenuRow
              key={m.key}
              menu={m}
              edit={edit}
              warnings={warnings.get(m.key)}
              lead={
                <span className="ed-menu-circle">
                  <CirclePicker circles={doc.circles} value={id} onChange={(next) => setId(m.key, next)} label="サークル（id）"
                    missing={`${id || '（id なし）'}（circles.csv にない）`} />
                  {c && <button type="button" onClick={() => onOpenCircle(c.key)}>サークル</button>}
                </span>
              }
            />
          );
        })}
      </div>
      {shown.length === 0 && <p className="empty">該当するお品書きはありません</p>}
    </section>
  );
}
