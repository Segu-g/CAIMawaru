// サークルの一覧（検索・絞り込み）と、選んだサークルの編集。
import { useMemo, useState } from 'react';
import CircleForm from './CircleForm';
import type { Doc } from './doc';
import { addCircle, type Dirty } from './edit';
import { circleId, isDataRow } from './model';
import type { Issue } from './validate';

type Props = {
  doc: Doc;
  issues: Issue[];
  selected: number | null;
  onSelect: (key: number | null) => void;
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
};

export default function CirclesTab({ doc, issues, selected, onSelect, edit }: Props) {
  const [q, setQ] = useState('');
  const [event, setEvent] = useState('');
  const [menu, setMenu] = useState<'' | 'yes' | 'no'>('');

  const rows = useMemo(() => doc.circles.filter((c) => isDataRow(c.values)), [doc.circles]);
  const events = useMemo(() => [...new Set(rows.map((c) => c.values.event.trim()))].sort(), [rows]);
  const menuCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of doc.menus) if (isDataRow(m.values)) n.set(m.values.id.trim(), (n.get(m.values.id.trim()) ?? 0) + 1);
    return n;
  }, [doc.menus]);
  const withIssue = useMemo(() => new Set(issues.filter((i) => i.where === 'circle' && i.level === 'error').map((i) => i.key)), [issues]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((c) => {
      const v = c.values;
      if (event && v.event.trim() !== event) return false;
      const n = menuCount.get(circleId(v)) ?? 0;
      if (menu === 'yes' && !n) return false;
      if (menu === 'no' && n) return false;
      const hay = [v.id, v.space, v.name, v.kana, v.penNames, v.event, v.tags, v.x, v.notes].join('\n').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q, event, menu, menuCount]);

  const current = selected === null ? undefined : doc.circles.find((c) => c.key === selected);

  const add = () => {
    // 絞り込み中のイベントがあれば、そのイベントで作る
    const res = addCircle(doc, { event });
    const row = res.doc.circles[res.doc.circles.length - 1];
    edit((d) => ({ ...d, circles: [...d.circles, row] }), 'circles');
    setQ('');
    setMenu('');
    onSelect(res.key);
  };

  return (
    <div className="ed-split">
      <section className="ed-list-pane" aria-label="サークルの一覧">
        <div className="ed-toolbar">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="検索（サークル名・スペース・id・作家名など）"
            aria-label="検索"
          />
          <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="参加イベント">
            <option value="">すべてのイベント</option>
            {events.map((ev) => (
              <option key={ev} value={ev}>{ev || '（未入力）'}</option>
            ))}
          </select>
          <select value={menu} onChange={(e) => setMenu(e.target.value as typeof menu)} aria-label="お品書き">
            <option value="">お品書き: すべて</option>
            <option value="yes">お品書きあり</option>
            <option value="no">お品書きなし</option>
          </select>
          <button type="button" onClick={add}>＋ サークルを追加</button>
        </div>
        <p className="meta">{shown.length} / {rows.length} 件（ファイルの順）</p>
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th>スペース</th>
                <th>サークル名</th>
                <th>参加イベント</th>
                <th>id</th>
                <th title="成人向け">成人</th>
                <th title="お品書きの数">お品書き</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const v = c.values;
                const id = circleId(v);
                return (
                  <tr
                    key={c.key}
                    aria-selected={c.key === selected}
                    className={withIssue.has(c.key) ? 'has-error' : undefined}
                    onClick={() => onSelect(c.key)}
                  >
                    <td className="nowrap">{v.space}</td>
                    <td>
                      <button type="button" className="ed-row-link" onClick={(e) => { e.stopPropagation(); onSelect(c.key); }}>
                        {v.name || '（名前なし）'}
                      </button>
                    </td>
                    <td>{v.event}</td>
                    <td className="nowrap ed-mono">{v.id ? id : <span className="ed-derived" title="スペース番号から作る id">{id}</span>}</td>
                    <td>{v.adult === '1' ? '成人' : v.adult && v.adult !== '0' ? v.adult : ''}</td>
                    <td className="num">{menuCount.get(id) || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="empty">該当するサークルはありません</p>}
        </div>
      </section>
      <section className="ed-detail-pane" aria-label="サークルの編集">
        {current ? (
          <CircleForm key={current.key} doc={doc} circle={current} issues={issues} edit={edit} onRemoved={() => onSelect(null)} />
        ) : (
          <p className="empty">一覧からサークルを選ぶと、ここで編集できます</p>
        )}
      </section>
    </div>
  );
}
