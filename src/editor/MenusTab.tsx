// すべてのお品書き（menus.csv）。どのサークルのものかを付け替えたり、宙に浮いたもの（サークルがない id）を直したりする。
import { useMemo, useState } from 'react';
import type { Doc } from './doc';
import type { Dirty } from './edit';
import MenuRow from './MenuRow';
import { circleId, isDataRow } from './model';

type Props = {
  doc: Doc;
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
  onOpenCircle: (key: number) => void;
};

export default function MenusTab({ doc, edit, onOpenCircle }: Props) {
  const [q, setQ] = useState('');
  const [orphansOnly, setOrphansOnly] = useState(false);

  const circles = useMemo(() => {
    const byId = new Map<string, { key: number; label: string }>();
    for (const c of doc.circles) {
      if (!isDataRow(c.values, c.extra)) continue;
      const id = circleId(c.values);
      if (id && !byId.has(id)) byId.set(id, { key: c.key, label: `${c.values.space} ${c.values.name}`.trim() });
    }
    return byId;
  }, [doc.circles]);
  const options = useMemo(() => [...circles.entries()], [circles]);

  const rows = doc.menus.filter((m) => isDataRow(m.values, m.extra));
  const orphans = rows.filter((m) => !circles.has(m.values.id.trim()));
  const shown = rows.filter((m) => {
    if (orphansOnly && circles.has(m.values.id.trim())) return false;
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
        <label className="ed-check">
          <input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} />
          宙に浮いたものだけ（{orphans.length}）
        </label>
      </div>
      <p className="meta">
        {shown.length} / {rows.length} 件。お品書きの追加はサークルの編集画面から。サークルを付け替えるときは左の欄で選びます。
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
              lead={
                <span className="ed-menu-circle">
                  <select value={id} onChange={(e) => setId(m.key, e.target.value)} aria-label="サークル（id）" className={c ? undefined : 'invalid'}>
                    {!c && <option value={id}>{id || '（id なし）'}（circles.csv にない）</option>}
                    {options.map(([cid, o]) => (
                      <option key={cid} value={cid}>{o.label}（{cid}）</option>
                    ))}
                  </select>
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
